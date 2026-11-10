import Metal
import QuartzCore
import simd

// The approved molten-glass simulation, ported pass for pass from the WebGL reference
// (modules/hyper-glass-field/reference/fluid-core.js + reference/glass6.html): stable fluids on a 128-wide
// half-float velocity grid with a 512-wide dye, curl 4, velocity dissipation 0.6, dye
// dissipation 0.03, pressure kept at 0.8 then 20 Jacobi iterations, 1/60 s per step.

struct GFParams {
  var texel: SIMD2<Float> = .zero
  var simTexel: SIMD2<Float> = .zero
  var dt: Float = 0
  var dissipation: Float = 0
  var curl: Float = 0
  var value: Float = 0
  var aspect: Float = 1
  var count: Int32 = 0
  var pad: SIMD2<Float> = .zero
}

struct GFSplat {
  var point: SIMD2<Float>
  var radius: Float
  var pad: Float = 0
  var color: SIMD4<Float>
}

struct GFDisplay {
  var dyeTexel: SIMD2<Float>
  var size: SIMD2<Float>
  var light: Int32
  /// Increase Contrast: draw the glass faintly (see `shade`).
  var quiet: Int32 = 0
  /// How strongly the glass is drawn (1 is the reference), and the least the warm wave gets.
  var gain: Float = 1
  var waveGain: Float = 1
}

struct GFMeter {
  var dyeTexel: SIMD2<Float>
  var cols: UInt32
  var rows: UInt32
  var light: Int32
  var pad0: Int32 = 0
  var pad1: SIMD2<Float> = .zero
}

/// The reference's tuning, kept literally.
enum GlassTuning {
  static let simWidth = 128
  static let dyeWidth = 512
  static let curl: Float = 4
  static let velocityDissipation: Float = 0.6
  static let dyeDissipation: Float = 0.03
  static let pressureKeep: Float = 0.8
  static let pressureIterations = 20
  static let dt: Float = 1.0 / 60.0

  // Warm-up before the first frame: the material starts settled and spread out.
  static let warmSteps = 480
  static let warmSeed: UInt32 = 31
  static let warmDyeDark: Float = 0.035
  static let warmDyeLight: Float = 0.045
  static let warmForce: Float = 260
  static let warmRadius: Float = 0.0045

  // Three broad wandering eddies, every step.
  static let eddyForce: Float = 9
  static let eddyRadius: Float = 0.02

  // The finger: a velocity splat along the drag.
  static let fingerForce: Float = 5200
  static let fingerRadius: Float = 0.0022

  // The warm wave.
  static let ember = SIMD3<Float>(1.0, 0.30, 0.16)
  static let waveDye: Float = 0.16
  static let waveForce: Float = 1250
  static let waveRadius: Float = 0.0045
  static let waveSideOffset = SIMD2<Float>(0.12, 0.02)
  static let waveSideForce = SIMD2<Float>(380, 420)
  static let waveSideRadius: Float = 0.004
  /// The reference splats the wave on every frame of its first 120 ms: 8 frames.
  static let waveSteps = 8

  // The keep-alive (not in the 10 s reference, which never ran long enough to need it): the
  // dye thins out and the display only draws where enough is left, so an untended field is
  // blank within about ten seconds. Whenever the meter reads under the target, one more
  // warm-up splat goes in at a seeded random spot, at most one every 8 steps. Tuned in
  // modules/hyper-glass-field/reference/glass7.html (`?keep=reg:0.4:0.3`) to hold the approved clip's level.
  static let keepSeed: UInt32 = 77
  static let keepTargetDark: Float = 0.4
  static let keepTargetLight: Float = 0.3
  static let keepCooldown = 8
  /// The meter reads the field every 10 steps, sampling 135 columns of every row of the
  /// tuning page's 540-px-wide canvas.
  static let meterEvery = 10
  static let meterCols = 135
  static let meterCanvasWidth = 540
}

/// The reference's seeded random (mulberry32), bit for bit.
struct Mulberry32 {
  var a: UInt32
  init(_ seed: UInt32) { a = seed }
  mutating func next() -> Float {
    a = a &+ 0x6D2B_79F5
    var t = (a ^ (a >> 15)) &* (1 | a)
    t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
    return Float(Double(t ^ (t >> 14)) / 4_294_967_296.0)
  }
}

/// Device, queue and the compiled passes, shared by every field.
final class GlassGPU {
  /// The compiled passes once ready (nil before, or when Metal is unavailable).
  private(set) static var ready: GlassGPU?
  private static var finished = false
  private static var started = false
  private static var waiters: [(GlassGPU?) -> Void] = []

  /// Builds the shaders off the main thread (about 0.1 s on a phone, ~2 s on the simulator)
  /// and calls back on the main thread. Main thread only.
  static func whenReady(_ callback: @escaping (GlassGPU?) -> Void) {
    if finished { callback(ready); return }
    waiters.append(callback)
    prepare()
  }

  /// Starts building the shaders, if not already started. Main thread only.
  static func prepare() {
    guard !started else { return }
    started = true
    DispatchQueue.global(qos: .userInitiated).async {
      let gpu = GlassGPU()
      DispatchQueue.main.async {
        ready = gpu
        finished = true
        let w = waiters
        waiters = []
        w.forEach { $0(gpu) }
      }
    }
  }

  let device: MTLDevice
  let queue: MTLCommandQueue
  let zero, splat, advect, divergence, curl, vorticity, pressure, gradient, clear, meter: MTLComputePipelineState
  let display: MTLRenderPipelineState
  let pixelFormat: MTLPixelFormat = .bgra8Unorm
  let compileMs: Double

  private init?() {
    let started = CACurrentMediaTime()
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
    queue.label = "hyPer glass"
    do {
      let options = MTLCompileOptions()
      options.fastMathEnabled = true
      let library = try device.makeLibrary(source: GlassShaders.source, options: options)
      func kernel(_ name: String) throws -> MTLComputePipelineState {
        guard let fn = library.makeFunction(name: name) else { throw NSError(domain: "HyperGlassField", code: 1, userInfo: [NSLocalizedDescriptionKey: "missing \(name)"]) }
        return try device.makeComputePipelineState(function: fn)
      }
      zero = try kernel("zero")
      splat = try kernel("splat")
      advect = try kernel("advect")
      divergence = try kernel("divergence")
      curl = try kernel("curlK")
      vorticity = try kernel("vorticity")
      pressure = try kernel("pressure")
      gradient = try kernel("gradient")
      clear = try kernel("clearK")
      meter = try kernel("meter")
      let rp = MTLRenderPipelineDescriptor()
      rp.label = "glass display"
      rp.vertexFunction = library.makeFunction(name: "fullscreen")
      rp.fragmentFunction = library.makeFunction(name: "shade")
      rp.colorAttachments[0].pixelFormat = pixelFormat
      display = try device.makeRenderPipelineState(descriptor: rp)
    } catch {
      // The compiler's warnings come first and the log cuts long lines: print the errors alone.
      let lines = "\(error)".components(separatedBy: "\n").filter { $0.contains("error") }
      NSLog("[glass] shader setup failed (%d error lines)", lines.count)
      lines.prefix(8).forEach { NSLog("[glass] %@", String($0.prefix(400))) }
      return nil
    }
    self.device = device
    self.queue = queue
    compileMs = (CACurrentMediaTime() - started) * 1000
  }
}

/// One field's simulation state.
final class GlassFluid {
  let gpu: GlassGPU
  let aspect: Float
  let simW: Int, simH: Int, dyeW: Int, dyeH: Int

  private var velocity: (read: MTLTexture, write: MTLTexture)
  private var dye: (read: MTLTexture, write: MTLTexture)
  private var pressureTex: (read: MTLTexture, write: MTLTexture)
  private let divergenceTex: MTLTexture
  private let curlTex: MTLTexture
  /// The meter's rows (two floats each), readable from the CPU. Nil only if the allocation failed.
  private let meterBuffer: MTLBuffer?
  let meterRows: Int
  var canMeter: Bool { meterBuffer != nil }

  var simTexel: SIMD2<Float> { SIMD2(1 / Float(simW), 1 / Float(simH)) }
  var dyeTexel: SIMD2<Float> { SIMD2(1 / Float(dyeW), 1 / Float(dyeH)) }

  /// The grid sizes the reference picks for a view of this aspect (width / height).
  static func gridSize(aspect: Float) -> (simW: Int, simH: Int, dyeW: Int, dyeH: Int) {
    let simW = GlassTuning.simWidth, dyeW = GlassTuning.dyeWidth
    return (simW, max(1, Int((Float(simW) / aspect).rounded())), dyeW, max(1, Int((Float(dyeW) / aspect).rounded())))
  }

  init?(gpu: GlassGPU, aspect: Float) {
    self.gpu = gpu
    self.aspect = aspect
    let g = GlassFluid.gridSize(aspect: aspect)
    simW = g.simW; simH = g.simH; dyeW = g.dyeW; dyeH = g.dyeH
    func tex(_ w: Int, _ h: Int, _ format: MTLPixelFormat, _ label: String) -> MTLTexture? {
      let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: w, height: h, mipmapped: false)
      d.usage = [.shaderRead, .shaderWrite]
      d.storageMode = .private
      let t = gpu.device.makeTexture(descriptor: d)
      t?.label = label
      return t
    }
    guard
      let v0 = tex(simW, simH, .rg16Float, "velocity A"), let v1 = tex(simW, simH, .rg16Float, "velocity B"),
      let d0 = tex(dyeW, dyeH, .rgba16Float, "dye A"), let d1 = tex(dyeW, dyeH, .rgba16Float, "dye B"),
      let p0 = tex(simW, simH, .r16Float, "pressure A"), let p1 = tex(simW, simH, .r16Float, "pressure B"),
      let dv = tex(simW, simH, .r16Float, "divergence"), let cu = tex(simW, simH, .r16Float, "curl")
    else { return nil }
    velocity = (v0, v1); dye = (d0, d1); pressureTex = (p0, p1); divergenceTex = dv; curlTex = cu
    meterRows = max(1, Int((Float(GlassTuning.meterCanvasWidth) / aspect).rounded()))
    meterBuffer = gpu.device.makeBuffer(length: meterRows * 2 * MemoryLayout<Float>.stride, options: .storageModeShared)
    meterBuffer?.label = "glass meter"
  }

  // MARK: encoding

  private func dispatch(_ enc: MTLComputeCommandEncoder, _ pso: MTLComputePipelineState, _ w: Int, _ h: Int) {
    enc.setComputePipelineState(pso)
    let tg = MTLSize(width: 16, height: 16, depth: 1)
    enc.dispatchThreadgroups(MTLSize(width: (w + 15) / 16, height: (h + 15) / 16, depth: 1), threadsPerThreadgroup: tg)
  }

  private func setParams(_ enc: MTLComputeCommandEncoder, _ p: GFParams) {
    var p = p
    enc.setBytes(&p, length: MemoryLayout<GFParams>.stride, index: 0)
  }

  /// Every texture starts at zero, as the reference's cleared FBOs do.
  func encodeClear(_ enc: MTLComputeCommandEncoder) {
    for t in [velocity.read, velocity.write, dye.read, dye.write, pressureTex.read, pressureTex.write, divergenceTex, curlTex] {
      enc.setTexture(t, index: 0)
      dispatch(enc, gpu.zero, t.width, t.height)
    }
  }

  /// Velocity splats (all of them) then dye splats (the ones with colour), summed per pass.
  func encodeSplats(_ enc: MTLComputeCommandEncoder, velocity vs: [GFSplat], dye ds: [GFSplat]) {
    let maxPerPass = 96  // setBytes stays under its 4 KB limit
    var i = 0
    while i < vs.count {
      let chunk = Array(vs[i ..< min(vs.count, i + maxPerPass)])
      setParams(enc, GFParams(texel: simTexel, aspect: aspect, count: Int32(chunk.count)))
      chunk.withUnsafeBytes { enc.setBytes($0.baseAddress!, length: $0.count, index: 1) }
      enc.setTexture(velocity.read, index: 0); enc.setTexture(velocity.write, index: 1)
      dispatch(enc, gpu.splat, simW, simH); velocity = (velocity.write, velocity.read)
      i += maxPerPass
    }
    i = 0
    while i < ds.count {
      let chunk = Array(ds[i ..< min(ds.count, i + maxPerPass)])
      setParams(enc, GFParams(texel: dyeTexel, aspect: aspect, count: Int32(chunk.count)))
      chunk.withUnsafeBytes { enc.setBytes($0.baseAddress!, length: $0.count, index: 1) }
      enc.setTexture(dye.read, index: 0); enc.setTexture(dye.write, index: 1)
      dispatch(enc, gpu.splat, dyeW, dyeH); dye = (dye.write, dye.read)
      i += maxPerPass
    }
  }

  /// One simulation step, in the reference's order.
  /// `velocityDissipation` and `pressureKeep` default to the reference's; the shared field
  /// passes its look's calm and a keep matched to its step length.
  func encodeStep(_ enc: MTLComputeCommandEncoder, dt: Float, velocityDissipation: Float = GlassTuning.velocityDissipation,
                  pressureKeep: Float = GlassTuning.pressureKeep) {
    let st = simTexel
    // curl
    setParams(enc, GFParams(texel: st))
    enc.setTexture(velocity.read, index: 0); enc.setTexture(curlTex, index: 1)
    dispatch(enc, gpu.curl, simW, simH)
    // vorticity
    setParams(enc, GFParams(texel: st, dt: dt, curl: GlassTuning.curl))
    enc.setTexture(velocity.read, index: 0); enc.setTexture(curlTex, index: 1); enc.setTexture(velocity.write, index: 2)
    dispatch(enc, gpu.vorticity, simW, simH); velocity = (velocity.write, velocity.read)
    // divergence
    setParams(enc, GFParams(texel: st))
    enc.setTexture(velocity.read, index: 0); enc.setTexture(divergenceTex, index: 1)
    dispatch(enc, gpu.divergence, simW, simH)
    // pressure: keep 0.8 of last step's, then Jacobi
    setParams(enc, GFParams(texel: st, value: pressureKeep))
    enc.setTexture(pressureTex.read, index: 0); enc.setTexture(pressureTex.write, index: 1)
    dispatch(enc, gpu.clear, simW, simH); pressureTex = (pressureTex.write, pressureTex.read)
    setParams(enc, GFParams(texel: st))
    enc.setTexture(divergenceTex, index: 1)
    for _ in 0 ..< GlassTuning.pressureIterations {
      enc.setTexture(pressureTex.read, index: 0); enc.setTexture(pressureTex.write, index: 2)
      dispatch(enc, gpu.pressure, simW, simH); pressureTex = (pressureTex.write, pressureTex.read)
    }
    // gradient subtract
    setParams(enc, GFParams(texel: st))
    enc.setTexture(pressureTex.read, index: 0); enc.setTexture(velocity.read, index: 1); enc.setTexture(velocity.write, index: 2)
    dispatch(enc, gpu.gradient, simW, simH); velocity = (velocity.write, velocity.read)
    // advect velocity
    setParams(enc, GFParams(texel: st, simTexel: st, dt: dt, dissipation: velocityDissipation))
    enc.setTexture(velocity.read, index: 0); enc.setTexture(velocity.read, index: 1); enc.setTexture(velocity.write, index: 2)
    dispatch(enc, gpu.advect, simW, simH); velocity = (velocity.write, velocity.read)
    // advect dye
    setParams(enc, GFParams(texel: dyeTexel, simTexel: st, dt: dt, dissipation: GlassTuning.dyeDissipation))
    enc.setTexture(velocity.read, index: 0); enc.setTexture(dye.read, index: 1); enc.setTexture(dye.write, index: 2)
    dispatch(enc, gpu.advect, dyeW, dyeH); dye = (dye.write, dye.read)
  }

  /// Multiplies the dye (light mode's warm-up used 0.045 where dark used 0.035; the dye is linear).
  func encodeScaleDye(_ enc: MTLComputeCommandEncoder, by value: Float) {
    setParams(enc, GFParams(texel: dyeTexel, value: value))
    enc.setTexture(dye.read, index: 0); enc.setTexture(dye.write, index: 1)
    dispatch(enc, gpu.clear, dyeW, dyeH); dye = (dye.write, dye.read)
  }

  /// The molten-glass display (glass6.html's SHADE) into a colour target.
  func encodeDisplay(_ cb: MTLCommandBuffer, target: MTLTexture, light: Bool, quiet: Bool = false, gain: Float = 1, waveGain: Float = 1) {
    let rp = MTLRenderPassDescriptor()
    rp.colorAttachments[0].texture = target
    rp.colorAttachments[0].loadAction = .dontCare
    rp.colorAttachments[0].storeAction = .store
    guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { return }
    enc.label = "glass display"
    enc.setRenderPipelineState(gpu.display)
    var d = GFDisplay(dyeTexel: dyeTexel, size: SIMD2(Float(target.width), Float(target.height)), light: light ? 1 : 0, quiet: quiet ? 1 : 0,
                      gain: gain, waveGain: waveGain)
    enc.setFragmentBytes(&d, length: MemoryLayout<GFDisplay>.stride, index: 0)
    enc.setFragmentTexture(dye.read, index: 0)
    enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    enc.endEncoding()
  }

  /// Measures how much glass is showing (see the `meter` kernel). False if there is no meter.
  func encodeMeter(_ enc: MTLComputeCommandEncoder, light: Bool) -> Bool {
    guard let meterBuffer else { return false }
    var m = GFMeter(dyeTexel: dyeTexel, cols: UInt32(GlassTuning.meterCols), rows: UInt32(meterRows), light: light ? 1 : 0)
    enc.setBytes(&m, length: MemoryLayout<GFMeter>.stride, index: 0)
    enc.setBuffer(meterBuffer, offset: 0, index: 1)
    enc.setTexture(dye.read, index: 0)
    dispatch(enc, gpu.meter, 1, meterRows)
    return true
  }

  /// The last finished measurement: the mean difference from the page colour (0…255) and the
  /// share of the field, in percent, that differs by more than 30. Any thread.
  func readMeter() -> (mean: Float, share: Float) {
    guard let meterBuffer else { return (0, 0) }
    let rows = meterBuffer.contents().bindMemory(to: Float.self, capacity: meterRows * 2)
    var sum = 0.0, hi = 0.0
    for j in 0 ..< meterRows { sum += Double(rows[2 * j]); hi += Double(rows[2 * j + 1]) }
    let n = Double(GlassTuning.meterCols * meterRows)
    return (Float(sum / n), Float(hi / n * 100))
  }

  // MARK: the reference's splats

  /// The reference's `splat(x, y, dx, dy, color, radius)`: a velocity splat, plus a dye splat when coloured.
  static func splats(x: Float, y: Float, dx: Float, dy: Float, color: SIMD3<Float>?, radius: Float,
                     into vs: inout [GFSplat], dye ds: inout [GFSplat]) {
    vs.append(GFSplat(point: SIMD2(x, y), radius: radius, color: SIMD4(dx, dy, 0, 0)))
    if let c = color { ds.append(GFSplat(point: SIMD2(x, y), radius: radius, color: SIMD4(c, 0))) }
  }

  /// The three broad eddies at time `ts` (seconds).
  static func eddies(ts: Double, scale s: Float = 1, into vs: inout [GFSplat]) {
    for e in 0 ..< 3 {
      let ef = Double(e)
      let x = Float(0.5 + 0.38 * sin(ts * (0.07 + ef * 0.03) + ef * 2.1))
      let y = Float(0.5 + 0.40 * sin(ts * (0.05 + ef * 0.02) + ef * 1.3))
      let a = Float(ts * (0.15 + ef * 0.05) + ef)
      vs.append(GFSplat(point: SIMD2(x, y), radius: GlassTuning.eddyRadius, color: SIMD4(cos(a) * GlassTuning.eddyForce * s, sin(a) * GlassTuning.eddyForce * s, 0, 0)))
    }
  }

  /// One frame of the warm wave at (x, y) (reference units: y up).
  /// `scale` is 1 for one of the reference's 60 Hz frames; a shorter step passes less.
  static func wave(x: Float, y: Float, scale s: Float = 1, into vs: inout [GFSplat], dye ds: inout [GFSplat]) {
    let k = GlassTuning.waveDye * s
    splats(x: x, y: y, dx: 0, dy: GlassTuning.waveForce * s, color: GlassTuning.ember * k, radius: GlassTuning.waveRadius, into: &vs, dye: &ds)
    let o = GlassTuning.waveSideOffset, f = GlassTuning.waveSideForce * s
    splats(x: x - o.x, y: y + o.y, dx: -f.x, dy: f.y, color: nil, radius: GlassTuning.waveSideRadius, into: &vs, dye: &ds)
    splats(x: x + o.x, y: y + o.y, dx: f.x, dy: f.y, color: nil, radius: GlassTuning.waveSideRadius, into: &vs, dye: &ds)
  }

  /// The reference's warm-up: 480 steps, seeded dye splats on the first 90 (every third).
  /// `amount` under 1 leaves out the later splats, for a look with less glass.
  func encodeWarmUp(_ enc: MTLComputeCommandEncoder, light: Bool, amount: Float = 1) {
    var r = Mulberry32(GlassTuning.warmSeed)
    let amt = light ? GlassTuning.warmDyeLight : GlassTuning.warmDyeDark
    let splatCount = Int((30 * amount).rounded())
    for i in 0 ..< GlassTuning.warmSteps {
      if i < 90 && i % 3 == 0 {
        let x = 0.1 + 0.8 * r.next(), y = 0.08 + 0.84 * r.next(), a = r.next() * Float.pi * 2
        if i / 3 >= splatCount { encodeStep(enc, dt: GlassTuning.dt); continue }
        var vs: [GFSplat] = [], ds: [GFSplat] = []
        GlassFluid.splats(x: x, y: y, dx: cos(a) * GlassTuning.warmForce, dy: sin(a) * GlassTuning.warmForce,
                          color: SIMD3(repeating: 1.2 * amt), radius: GlassTuning.warmRadius, into: &vs, dye: &ds)
        encodeSplats(enc, velocity: vs, dye: ds)
      }
      encodeStep(enc, dt: GlassTuning.dt)
    }
  }
}
