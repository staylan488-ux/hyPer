import Metal
import QuartzCore
import UIKit

/// How the glass behind the app looks and moves. 1 everywhere is the reference (glass6.html).
struct GlassLook: Equatable {
  /// How strongly the lines are drawn over the page, in dark and in light (light lines on
  /// black need more than grey lines on chalk to read as the same amount).
  var gain: Float
  var gainLight: Float
  /// How much glass the field holds (the keep-alive's level, and the warm-up's splats).
  var amount: Float
  /// The ambient eddies that keep it drifting.
  var drift: Float
  /// How hard a finger or a scroll pushes it.
  var touch: Float
  /// How quickly a push dies away (a multiple of the reference's velocity dissipation).
  var calm: Float

  static let named: [String: GlassLook] = [
    // No glass: the page alone. The field is kept, not stepped.
    "off": GlassLook(gain: 0, gainLight: 0, amount: 0.5, drift: 0, touch: 0, calm: 1),
    "faint": GlassLook(gain: 0.48, gainLight: 0.32, amount: 0.42, drift: 0.3, touch: 0.2, calm: 2.4),
    "soft": GlassLook(gain: 0.72, gainLight: 0.5, amount: 0.6, drift: 0.45, touch: 0.35, calm: 1.7),
    "full": GlassLook(gain: 1, gainLight: 1, amount: 1, drift: 1, touch: 1, calm: 1),
  ]
  /// The app's look: the owner's choice on the phone, 2026-11-09 ("Faint is the one. it looks
  /// so clean"), out of a test build that could switch between all four.
  static let defaultName = "faint"
  /// Debug builds only: `-hyperGlassLevel off|faint|soft|full` at launch, for comparisons.
  static let defaultsKey = "hyperGlassLevel"
  static var launchName: String {
    #if DEBUG
    if let asked = UserDefaults.standard.string(forKey: defaultsKey), named[asked] != nil { return asked }
    #endif
    return defaultName
  }
  /// The warm wave is the one loud moment: it is drawn at least this strongly in every look.
  static let waveGain: Float = 0.9
  /// Rest: with no touch, scroll, press or tab change for this long the glass eases to a stop
  /// (over `restEase` seconds) and the display link pauses, so an untended phone (a workout
  /// keeps the screen on for an hour) costs what a still page costs. Anything wakes it at
  /// once, easing back in over `wakeEase`.
  static let restAfter: Double = 15
  static let restEase: Double = 3
  static let wakeEase: Double = 0.35
}

/// The one molten-glass field behind the app. Every tab shows the same simulation, so a tab
/// change never resets or moves it, and a tab's first visit builds nothing.
///
/// It runs on its own thread, off a display link at the screen's full rate (120 Hz on a
/// ProMotion phone, 60 in Low Power Mode), one simulation step per frame with that frame's
/// length, so it keeps its pace while the main thread is busy laying out a page. It stops
/// while no field view is on screen, in the background, (after one frame) under Reduce
/// Motion or the "off" look, and whenever nobody has touched the app for a while
/// (`GlassLook.restAfter`): a display kept at 120 Hz is what costs battery, so the glass
/// only moves while someone is there to see it.
///
/// Threads: `lock` guards everything below it. The main thread only queues input and changes
/// settings; all simulation encoding happens on the render thread, except `drawNow`, which
/// draws the current field into a view that has just come on screen (still under the lock).
final class GlassWorld: NSObject {
  static let shared = GlassWorld()
  static let firstFrame = Notification.Name("HyperGlassWorldFirstFrame")

  private let lock = NSLock()
  private struct Target { let layer: CAMetalLayer }
  private var targets: [ObjectIdentifier: Target] = [:]
  private var gpu: GlassGPU?
  private var fluid: GlassFluid?
  private var wantedAspect: Float = 0
  private let look: GlassLook
  private let name: String
  private var builtAmount: Float = 1
  private var light = false
  private var builtLight = false
  private var quiet = UIAccessibility.isDarkerSystemColorsEnabled
  private var reduceMotion = false
  private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
  private var suspended = UIApplication.shared.applicationState == .background
  private var needsDraw = true
  private var shown = false

  private var simTime: Double = 0
  /// When the app last gave a sign of someone using it, and how fast the glass moves for it:
  /// `pace` eases from 1 to 0 once that is `restAfter` ago, and `resting` is true while the
  /// link is paused for it.
  private var lastActivity: CFTimeInterval = CACurrentMediaTime()
  private var pace: Float = 1
  private var resting = false
  private var lastTarget: CFTimeInterval = 0
  private var pendingVelocity: [GFSplat] = []
  private var pendingDye: [GFSplat] = []
  private var waves: [(x: Float, y: Float, left: Double)] = []
  private var lastFinger: SIMD2<Float>?

  // keep-alive (see HyperGlassFieldView's notes; here in seconds, not steps)
  private var keepRandom = Mulberry32(GlassTuning.keepSeed)
  private var keepCooldown: Double = 0
  private var meterTimer: Double = 0
  private var meterValue: Float?
  private var meterEpoch = 0

  // stats (`-hyperGlassStats YES`)
  private let stats = UserDefaults.standard.bool(forKey: "hyperGlassStats")
  private var statFrames = 0, statLate = 0
  private var statWorst: Double = 0, statGpu: Double = 0, statGpuMax: Double = 0, statCpu: Double = 0
  private var statStart: CFTimeInterval = 0

  private var link: CADisplayLink?
  private var thread: Thread?

  private override init() {
    name = GlassLook.launchName
    look = GlassLook.named[name]!
    builtAmount = look.amount
    super.init()
    let nc = NotificationCenter.default
    nc.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    nc.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    nc.addObserver(self, selector: #selector(powerChanged), name: .NSProcessInfoPowerStateDidChange, object: nil)
    nc.addObserver(self, selector: #selector(contrastChanged), name: UIAccessibility.darkerSystemColorsStatusDidChangeNotification, object: nil)
    GlassGPU.whenReady { [weak self] gpu in
      guard let self, let gpu else { return }
      self.lock.lock(); self.gpu = gpu; self.lock.unlock()
      self.updateLink()
    }
  }

  // MARK: settings (main thread)

  /// True once the field has been on screen: a view made later shows it at once, without a fade.
  var hasShownFrame: Bool { lock.lock(); defer { lock.unlock() }; return shown }

  func setLight(_ next: Bool) {
    lock.lock()
    let changed = next != light
    if changed { light = next; needsDraw = true; meterValue = nil; meterEpoch += 1 }
    lock.unlock()
    if changed { updateLink() }
  }

  func setReduceMotion(_ next: Bool) {
    lock.lock()
    let changed = next != reduceMotion
    if changed {
      reduceMotion = next; needsDraw = true
      if next { waves.removeAll(); pendingVelocity.removeAll(); pendingDye.removeAll(); lastFinger = nil }
    }
    lock.unlock()
    if changed { updateLink() }
  }

  @objc private func didEnterBackground() { lock.lock(); suspended = true; lock.unlock(); updateLink() }
  @objc private func willEnterForeground() {
    lock.lock(); suspended = false; needsDraw = true; active(); lock.unlock()
    updateLink()
  }

  /// Under the lock: someone is using the app. True if the glass was resting and the link
  /// needs starting (call `updateLink()` after unlocking).
  @discardableResult private func active() -> Bool {
    lastActivity = CACurrentMediaTime()
    let was = resting
    resting = false
    return was
  }
  @objc private func powerChanged() {
    DispatchQueue.main.async {
      self.lock.lock(); self.lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled; self.lock.unlock()
      self.updateLink()
    }
  }
  @objc private func contrastChanged() {
    lock.lock(); quiet = UIAccessibility.isDarkerSystemColorsEnabled; needsDraw = true; lock.unlock()
    updateLink()
  }

  // MARK: the views showing the field (main thread)

  func attach(_ id: ObjectIdentifier, layer: CAMetalLayer, aspect: Float) {
    lock.lock()
    targets[id] = Target(layer: layer)
    if wantedAspect == 0 || fluid == nil { wantedAspect = aspect }
    needsDraw = true
    active()  // a tab came on screen
    lock.unlock()
    startThreadIfNeeded()
    updateLink()
  }

  /// A view showing the field changed size (its layer dropped what it held): draw once more,
  /// even while nothing moves (Reduce Motion, or the "off" look).
  func requestDraw() {
    lock.lock(); needsDraw = true; lock.unlock()
    updateLink()
  }

  func detach(_ id: ObjectIdentifier) {
    lock.lock(); targets[id] = nil; lock.unlock()
    updateLink()
  }

  /// Draws the field as it is right now into a view that has just come on screen, inside the
  /// current Core Animation transaction, so the view never shows the frame it stopped on.
  /// False when there is no field yet (the view then waits for the first frame).
  func drawNow(into layer: CAMetalLayer) -> Bool {
    lock.lock()
    let ready = !suspended && fluid != nil && gpu != nil && shown
    lock.unlock()
    guard ready, layer.device != nil, layer.drawableSize.width > 1, let drawable = layer.nextDrawable() else { return false }
    lock.lock()
    guard let fluid, let gpu, let cb = gpu.queue.makeCommandBuffer() else { lock.unlock(); return false }
    cb.label = "glass first frame"
    fluid.encodeDisplay(cb, target: drawable.texture, light: light, quiet: quiet, gain: light ? look.gainLight : look.gain, waveGain: GlassLook.waveGain)
    lock.unlock()
    layer.presentsWithTransaction = true
    cb.commit()
    cb.waitUntilScheduled()
    drawable.present()
    return true
  }

  // MARK: input (main thread; x and y in 0…1 with y up, as the reference's)

  func finger(phase: Int, x: Float, y: Float) {
    lock.lock()
    let wake = active()
    defer { lock.unlock(); if wake { updateLink() } }
    guard !reduceMotion, look.touch > 0 else { lastFinger = nil; return }
    let p = SIMD2(x, y)
    if phase == 1, let last = lastFinger {
      let d = (p - last) * GlassTuning.fingerForce * look.touch
      if d != .zero { append(GFSplat(point: p, radius: GlassTuning.fingerRadius, color: SIMD4(d.x, d.y, 0, 0))) }
    }
    lastFinger = phase == 2 ? nil : p
  }

  /// A scroll's push, already in the reference's force units.
  func stir(fx: Float, fy: Float) {
    lock.lock()
    let wake = active()
    defer { lock.unlock(); if wake { updateLink() } }
    guard !reduceMotion, look.touch > 0 else { return }
    for x in [Float(0.2), 0.5, 0.8] {
      append(GFSplat(point: SIMD2(x, 0.5), radius: GlassTuning.stirRadius, color: SIMD4(fx * look.touch, fy * look.touch, 0, 0)))
    }
  }

  func wave(x: Float, y: Float) {
    lock.lock()
    let wake = active()
    defer { lock.unlock(); if wake { updateLink() } }
    guard !reduceMotion, look.gain > 0 else { return }
    waves.append((x, y, Double(GlassTuning.waveSteps) / 60))
  }

  func splat(x: Float, y: Float, dx: Float, dy: Float, color: SIMD3<Float>, radius: Float) {
    lock.lock()
    let wake = active()
    defer { lock.unlock(); if wake { updateLink() } }
    guard !reduceMotion else { return }
    var vs: [GFSplat] = [], ds: [GFSplat] = []
    GlassFluid.splats(x: x, y: y, dx: dx, dy: dy, color: color == .zero ? nil : color, radius: radius, into: &vs, dye: &ds)
    vs.forEach(append)
    pendingDye += ds
  }

  /// Under the lock.
  private func append(_ s: GFSplat) {
    if pendingVelocity.count < 256 { pendingVelocity.append(s) }
  }

  // MARK: the render thread

  private func startThreadIfNeeded() {
    guard thread == nil else { return }
    let made = DispatchSemaphore(value: 0)
    let t = Thread { [unowned self] in
      let l = CADisplayLink(target: self, selector: #selector(self.tick(_:)))
      l.isPaused = true
      l.add(to: .current, forMode: .default)
      self.link = l
      made.signal()
      RunLoop.current.run()
    }
    t.name = "hyPer glass"
    t.qualityOfService = .userInteractive
    thread = t
    t.start()
    made.wait()
  }

  /// Any thread: runs the link only while there is something to draw.
  private func updateLink() {
    lock.lock()
    let moving = !reduceMotion && look.gain > 0 && !resting
    let run = !suspended && gpu != nil && !targets.isEmpty && (moving || needsDraw)
    let top: Float = lowPower ? 60 : 120
    lock.unlock()
    guard let link else { return }
    if link.preferredFrameRateRange.maximum != top {
      link.preferredFrameRateRange = CAFrameRateRange(minimum: min(top, 80), maximum: top, preferred: top)
    }
    if link.isPaused == run {
      if run { lock.lock(); lastTarget = 0; lock.unlock() }
      link.isPaused = !run
    }
  }

  @objc private func tick(_ link: CADisplayLink) {
    let cpu0 = CACurrentMediaTime()
    lock.lock()
    guard !suspended, let gpu, !targets.isEmpty else { lock.unlock(); link.isPaused = true; return }
    let layers = targets.values.map { $0.layer }
    let build = fluid == nil ? (aspect: wantedAspect, light: light, amount: look.amount) : nil
    lock.unlock()

    // The first field: built and warmed up here, off the main thread, without holding the lock.
    if let build {
      guard build.aspect > 0, let f = GlassFluid(gpu: gpu, aspect: build.aspect),
            let cb = gpu.queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { link.isPaused = true; return }
      cb.label = "glass warm-up"
      f.encodeClear(enc)
      f.encodeWarmUp(enc, light: build.light, amount: build.amount)
      enc.endEncoding()
      cb.commit()
      lock.lock()
      fluid = f; builtLight = build.light; builtAmount = build.amount
      simTime = 0; lastTarget = 0; keepRandom = Mulberry32(GlassTuning.keepSeed); keepCooldown = 0; meterTimer = 0
      meterValue = nil; meterEpoch += 1; needsDraw = true
      lock.unlock()
    }

    let drawables = layers.compactMap { $0.device != nil ? $0.nextDrawable() : nil }
    guard !drawables.isEmpty else { return }

    lock.lock()
    guard !suspended, let fluid, let cb = gpu.queue.makeCommandBuffer() else { lock.unlock(); return }
    cb.label = "glass frame"
    let moving = !reduceMotion && look.gain > 0
    var dt = lastTarget == 0 ? link.duration : link.targetTimestamp - lastTarget
    lastTarget = link.targetTimestamp
    let late = dt > link.duration * 1.5
    let rawDt = dt
    dt = min(max(dt, 1.0 / 240), 1.0 / 30)
    // Rest: ease the pace down once nobody has used the app for a while, and back up at once.
    var stepping = moving
    var simDt = dt
    if moving {
      let wanted: Float = CACurrentMediaTime() - lastActivity > GlassLook.restAfter ? 0 : 1
      if wanted < pace { pace = max(0, pace - Float(dt / GlassLook.restEase)) }
      else if wanted > pace { pace = min(1, pace + Float(dt / GlassLook.wakeEase)) }
      let eased = pace * pace * (3 - 2 * pace)
      simDt = dt * Double(eased)
      stepping = eased > 0.0005
      let nowResting = wanted == 0 && pace == 0
      if nowResting && !resting, stats { NSLog("[glass] world resting") }
      resting = nowResting
    }
    let rescale = builtLight != light || builtAmount != look.amount
    var metered = false
    if (stepping || rescale), let enc = cb.makeComputeCommandEncoder() {
      if rescale {
        // The two appearances hold different amounts of dye, and so do the looks; the dye is
        // linear, so scaling it gives the other one's field at once.
        let lightRatio = (light ? GlassTuning.warmDyeLight : GlassTuning.warmDyeDark) / (builtLight ? GlassTuning.warmDyeLight : GlassTuning.warmDyeDark)
        let amountRatio = builtAmount > 0 && look.amount > 0 ? min(max(look.amount / builtAmount, 0.4), 2.5) : 1
        fluid.encodeScaleDye(enc, by: lightRatio * amountRatio)
        builtLight = light
        if look.amount > 0 { builtAmount = look.amount }
      }
      if stepping {
        let k = Float(simDt * 60)  // this step, measured in the reference's 60 Hz frames
        var vs: [GFSplat] = [], ds: [GFSplat] = []
        keepCooldown -= simDt
        let target = (light ? GlassTuning.keepTargetLight : GlassTuning.keepTargetDark) * look.amount
        if keepCooldown <= 0, let showing = meterValue, showing < target {
          keepCooldown = Double(GlassTuning.keepCooldown) / 60
          let amt = light ? GlassTuning.warmDyeLight : GlassTuning.warmDyeDark
          let x = 0.1 + 0.8 * keepRandom.next(), y = 0.08 + 0.84 * keepRandom.next(), a = keepRandom.next() * Float.pi * 2
          let force = GlassTuning.warmForce * (0.5 + 0.5 * look.drift)
          GlassFluid.splats(x: x, y: y, dx: cos(a) * force, dy: sin(a) * force, color: SIMD3(repeating: 1.2 * amt),
                            radius: GlassTuning.warmRadius, into: &vs, dye: &ds)
        }
        GlassFluid.eddies(ts: simTime, scale: k * look.drift, into: &vs)
        vs += pendingVelocity; ds += pendingDye
        pendingVelocity.removeAll(keepingCapacity: true); pendingDye.removeAll(keepingCapacity: true)
        if !waves.isEmpty {
          for i in waves.indices {
            GlassFluid.wave(x: waves[i].x, y: waves[i].y, scale: Float(min(dt, waves[i].left) * 60), into: &vs, dye: &ds)
            waves[i].left -= dt
          }
          waves.removeAll { $0.left <= 0 }
        }
        fluid.encodeSplats(enc, velocity: vs, dye: ds)
        fluid.encodeStep(enc, dt: Float(simDt), velocityDissipation: GlassTuning.velocityDissipation * look.calm,
                         pressureKeep: pow(GlassTuning.pressureKeep, k))
        simTime += simDt
        meterTimer -= simDt
        if meterTimer <= 0 {
          meterTimer = Double(GlassTuning.meterEvery) / 60
          metered = fluid.encodeMeter(enc, light: light)
        }
      }
      enc.endEncoding()
    }
    for d in drawables {
      fluid.encodeDisplay(cb, target: d.texture, light: light, quiet: quiet, gain: light ? look.gainLight : look.gain, waveGain: GlassLook.waveGain)
      cb.present(d)
    }
    needsDraw = false
    let pauseAfter = !moving || resting
    let first = !shown
    shown = true
    let epoch = meterEpoch
    let wantStats = stats
    if wantStats { statFrames += 1; if late { statLate += 1 }; statWorst = max(statWorst, rawDt) }
    lock.unlock()

    if metered || wantStats {
      cb.addCompletedHandler { [weak self] cb in
        guard let self else { return }
        let reading = metered ? fluid.readMeter() : nil
        self.lock.lock()
        if let reading, epoch == self.meterEpoch { self.meterValue = reading.mean }
        if wantStats {
          let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
          self.statGpu += ms; self.statGpuMax = max(self.statGpuMax, ms)
        }
        self.lock.unlock()
      }
    }
    cb.commit()
    if first { DispatchQueue.main.async { NotificationCenter.default.post(name: GlassWorld.firstFrame, object: nil) } }
    if pauseAfter { updateLink() }

    if wantStats {
      lock.lock()
      statCpu += (CACurrentMediaTime() - cpu0) * 1000
      let now = CACurrentMediaTime()
      if statStart == 0 { statStart = now }
      if now - statStart >= 2, statFrames > 0 {
        NSLog("[glass] world %@ %@: %.1f fps (link %.0f Hz), late frames %d, worst gap %.1f ms, gpu avg %.2f max %.2f ms, cpu %.2f ms, showing %.2f, views %d",
              name, light ? "light" : "dark", Double(statFrames) / (now - statStart), 1 / link.duration, statLate, statWorst * 1000,
              statGpu / Double(statFrames), statGpuMax, statCpu / Double(statFrames), meterValue ?? -1, targets.count)
        statFrames = 0; statLate = 0; statWorst = 0; statGpu = 0; statGpuMax = 0; statCpu = 0; statStart = now
      }
      lock.unlock()
    }
  }
}
