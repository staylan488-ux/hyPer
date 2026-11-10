import ExpoModulesCore
import Metal
import QuartzCore
import UIKit

/// The layer the field draws into.
final class GlassMetalView: UIView {
  override class var layerClass: AnyClass { CAMetalLayer.self }
  var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
}

/// The molten-glass field: the approved stable-fluids simulation behind the app, drawn as thin
/// edges of light (dark) or soft grey lines on chalk (light). It never takes a touch; the app
/// forwards touches, scrolls and waves through the module's functions.
///
/// In the app every field view shows the one shared simulation (`GlassWorld`), which runs on
/// its own thread at the screen's full rate; this view only lends it a layer while it is on
/// screen. What follows describes the private simulation a view keeps for the debug
/// comparisons (`demo`, a fixed `appearance`, snapshots), which follow the reference exactly.
///
/// Frame rate: 30 fps while it only drifts, 60 fps during a touch, a scroll and for 2.5 s after
/// a wave; at most 30 fps in Low Power Mode; stopped off screen, in the background or while
/// `paused`. Reduce Motion: the settled field is drawn once and holds still.
/// The simulation always advances in fixed 1/60 s steps of simulated time (two steps per frame
/// at 30 fps), so its motion is the same at every frame rate.
/// The keep-alive: the dye thins out as it drifts and would leave the page blank within about
/// ten seconds, so every 10 steps the field measures how much glass is showing and, while that
/// is under the approved level, adds one small splat of glass back (see `keepAlive`).
final class HyperGlassFieldView: ExpoView {
  // MARK: registry (the module's functions reach every field on screen)

  private static let all = NSHashTable<HyperGlassFieldView>.weakObjects()
  static var live: [HyperGlassFieldView] { all.allObjects.filter { $0.isLive } }
  /// Input from the app: every private field on screen, and the shared field once (through
  /// whichever view is showing it).
  static func reach(_ send: (HyperGlassFieldView) -> Void) {
    let views = live
    views.filter { !$0.usesShared }.forEach(send)
    if let v = views.first(where: { $0.usesShared }) { send(v) }
  }
  static var appearanceOverride: Bool? { didSet { all.allObjects.forEach { $0.appearanceChanged() } } }
  static var reduceMotionOverride: Bool? { didSet { all.allObjects.forEach { $0.motionSettingChanged() } } }

  // MARK: props

  var appearanceProp: String? { didSet { appearanceChanged() } }
  var reduceMotionProp: Bool? { didSet { motionSettingChanged() } }
  var paused = false { didSet { updateRunning() } }
  /// In the app: no debug prop set, so this view shows the shared field.
  var usesShared: Bool { demo == nil && appearanceProp == nil && snapshotSpec == nil }
  private var sharedAttached = false
  var debugStats = UserDefaults.standard.bool(forKey: "hyperGlassStats")
  /// Debug comparison, one step per frame: "reference" loops glass6.html's 10 s script as
  /// approved (no keep-alive); "keep" plays it once and runs on with the keep-alive; "fade" the
  /// same without it. "keep" and "fade" log the meter once a simulated second, to be read
  /// against glass7.html's (`?keep=reg:0.4:0.3` and `?keep=off`).
  var demo: String? { didSet { if demo != oldValue { resetDemo() } } }
  var demoFrameMs: Double = 16  // the reference recording's clock: rAF every 16 ms
  var demoDot = false { didSet { dot.isHidden = !demoDot } }
  /// Debug comparison: "dir|name|k1,k2,…" writes the frames at those demo frame indices as PNGs.
  var snapshotSpec: String? { didSet { parseSnapshots() } }

  // MARK: state

  private let metalView = GlassMetalView()
  private var gpu: GlassGPU?
  private var shownFirstFrame = false
  private var fluid: GlassFluid?
  private var link: CADisplayLink?
  private var light = false
  private var builtLight = false
  private var simTime: Double = 0
  private var accumulator: Double = 0
  private var lastTimestamp: CFTimeInterval = 0
  private var needsDraw = true
  private var activeUntil: CFTimeInterval = 0
  private var pendingVelocity: [GFSplat] = []
  private var pendingDye: [GFSplat] = []
  private var waves: [(x: Float, y: Float, stepsLeft: Int)] = []
  private var lastTouch: CGPoint?
  private var inBackground = UIApplication.shared.applicationState == .background
  private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled

  // keep-alive
  private var keepRandom = Mulberry32(GlassTuning.keepSeed)
  private var keepCooldown = 0
  private var keepSteps = 0
  private var keepSplats = 0  // since the last warm-up, for the logs
  private var meterValue: Float?  // nil until the field has been measured
  private var meterShare: Float = 0
  private var meterEpoch = 0  // a measurement taken before the field was rebuilt or recoloured is dropped

  // demo
  private var demoFrame = 0
  private var demoLast: (x: Double, y: Double)?
  private let dot = CALayer()
  private var snapshotDir: String?
  private var snapshotName = "glass"
  private var snapshotFrames: Set<Int> = []
  private var snapshotAll = false

  // stats
  private var statFrames = 0
  private var statSteps = 0
  private var statGpu: Double = 0
  private var statGpuMax: Double = 0
  private var statStart: CFTimeInterval = 0
  private var statCpu: Double = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    metalView.isUserInteractionEnabled = false
    addSubview(metalView)
    let ml = metalView.metalLayer
    ml.pixelFormat = .bgra8Unorm
    ml.framebufferOnly = true
    ml.isOpaque = true
    ml.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
    ml.presentsWithTransaction = false
    dot.isHidden = true
    dot.zPosition = 10
    layer.addSublayer(dot)
    light = resolveLight()
    applyGround()
    HyperGlassFieldView.all.add(self)
    // Until the field's first frame the page colour shows; then the glass fades in.
    metalView.alpha = 0
    GlassGPU.whenReady { [weak self] gpu in
      guard let self, let gpu else { return }
      self.gpu = gpu
      self.metalView.metalLayer.device = gpu.device
      self.setNeedsLayout()
    }

    let nc = NotificationCenter.default
    nc.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
    nc.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    nc.addObserver(self, selector: #selector(powerChanged), name: .NSProcessInfoPowerStateDidChange, object: nil)
    nc.addObserver(self, selector: #selector(systemMotionChanged), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
    nc.addObserver(self, selector: #selector(systemContrastChanged), name: UIAccessibility.darkerSystemColorsStatusDidChangeNotification, object: nil)
    nc.addObserver(self, selector: #selector(worldFirstFrame), name: GlassWorld.firstFrame, object: nil)
  }

  deinit {
    link?.invalidate()
    NotificationCenter.default.removeObserver(self)
    if sharedAttached { GlassWorld.shared.detach(ObjectIdentifier(self)) }
  }

  /// The shared field's first frame ever: the glass fades in over the page.
  @objc private func worldFirstFrame() {
    guard usesShared, metalView.alpha < 1 else { return }
    UIView.animate(withDuration: 0.35, delay: 0.05, options: [.curveEaseOut, .allowUserInteraction]) { self.metalView.alpha = 1 }
  }

  // MARK: lifecycle

  override func layoutSubviews() {
    super.layoutSubviews()
    metalView.frame = bounds
    guard bounds.width > 1, bounds.height > 1 else { return }
    // The shared field's lines come from a 512-wide dye texture: two pixels a point shows all
    // of it, at under half the fill of three.
    let screenScale = window?.screen.scale ?? UIScreen.main.scale
    let scale = usesShared ? min(screenScale, 2) : screenScale
    metalView.contentScaleFactor = scale
    let size = CGSize(width: (bounds.width * scale).rounded(), height: (bounds.height * scale).rounded())
    if metalView.metalLayer.drawableSize != size {
      metalView.metalLayer.drawableSize = size
      needsDraw = true
      if sharedAttached { GlassWorld.shared.requestDraw() }
    }
    let aspect = Float(bounds.width / bounds.height)
    let grid = GlassFluid.gridSize(aspect: aspect)
    if !usesShared, fluid == nil || fluid!.simH != grid.simH || fluid!.dyeH != grid.dyeH { rebuild(aspect: aspect) }
    updateRunning()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateRunning()
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    if previous?.userInterfaceStyle != traitCollection.userInterfaceStyle { appearanceChanged() }
  }

  @objc private func didEnterBackground() { inBackground = true; updateRunning() }
  @objc private func willEnterForeground() { inBackground = false; needsDraw = true; updateRunning() }
  @objc private func powerChanged() {
    DispatchQueue.main.async { self.lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled; self.updateFrameRate() }
  }
  @objc private func systemMotionChanged() { motionSettingChanged() }
  /// Increase Contrast turned on or off: the same field, drawn faintly or in full.
  @objc private func systemContrastChanged() { needsDraw = true; updateRunning() }

  /// On screen, in the foreground and not paused: the only time the field may run.
  var isLive: Bool { usesShared ? sharedAttached : window != nil && !isHidden && !paused && !inBackground && fluid != nil }

  private var reduceMotion: Bool {
    if demo != nil { return false }
    return reduceMotionProp ?? HyperGlassFieldView.reduceMotionOverride ?? UIAccessibility.isReduceMotionEnabled
  }

  private func resolveLight() -> Bool {
    if let a = appearanceProp { return a == "light" }
    if let o = HyperGlassFieldView.appearanceOverride { return o }
    return traitCollection.userInterfaceStyle == .light
  }

  private func applyGround() {
    // In the app the view has no colour of its own: the page behind it paints the ground and
    // follows the appearance by itself. A colour kept here could be left over from the other
    // appearance under the glass, where nobody sees it but iOS still reads it when it picks
    // the tab bar's light or dark glass (the bar went white on one tab until a relaunch).
    // A private (debug) field paints what shows before its first frame: the page itself.
    backgroundColor = usesShared ? .clear : light ? UIColor(red: 0.949, green: 0.945, blue: 0.929, alpha: 1) : .black
    dot.backgroundColor = UIColor(white: light ? 0 : 1, alpha: light ? 0.18 : 0.30).cgColor
    dot.borderColor = UIColor(white: light ? 0 : 1, alpha: light ? 0.30 : 0.55).cgColor
  }

  private func appearanceChanged() {
    let next = resolveLight()
    if usesShared {
      if next != light { light = next; applyGround() }
      if sharedAttached { GlassWorld.shared.setLight(next) }
      updateRunning()
      return
    }
    guard next != light else { return }
    light = next
    applyGround()
    // The two looks warm up with different amounts of dye (0.045 light, 0.035 dark); the dye is
    // linear, so scaling it gives exactly the other look's settled field.
    if let fluid, let gpu, let cb = gpu.queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() {
      let ratio = (next ? GlassTuning.warmDyeLight : GlassTuning.warmDyeDark) / (builtLight ? GlassTuning.warmDyeLight : GlassTuning.warmDyeDark)
      fluid.encodeScaleDye(enc, by: ratio)
      enc.endEncoding(); cb.commit()
      builtLight = next
    }
    // The other look reads differently on the meter: measure again before adding glass.
    meterValue = nil; meterEpoch += 1
    needsDraw = true
    updateRunning()
  }

  private func motionSettingChanged() {
    if usesShared {
      if sharedAttached { GlassWorld.shared.setReduceMotion(reduceMotion) }
      return
    }
    if reduceMotion { waves.removeAll(); pendingVelocity.removeAll(); pendingDye.removeAll() }
    needsDraw = true
    updateRunning()
  }

  private func rebuild(aspect: Float) {
    guard let gpu, let f = GlassFluid(gpu: gpu, aspect: aspect) else { return }
    fluid = f
    warmUp()
  }

  private func warmUp() {
    guard let fluid, let gpu, let cb = gpu.queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { return }
    let t0 = CACurrentMediaTime()
    cb.label = "glass warm-up"
    fluid.encodeClear(enc)
    fluid.encodeWarmUp(enc, light: light)
    enc.endEncoding()
    builtLight = light
    let encodeMs = (CACurrentMediaTime() - t0) * 1000
    if debugStats {
      let grid = "\(fluid.simW)x\(fluid.simH) dye \(fluid.dyeW)x\(fluid.dyeH)"
      cb.addCompletedHandler { cb in
        NSLog("[glass] warm-up %@: encode %.1f ms, gpu %.1f ms, shaders %.1f ms", grid, encodeMs, (cb.gpuEndTime - cb.gpuStartTime) * 1000, gpu.compileMs)
      }
    }
    cb.commit()
    simTime = 0
    accumulator = 0
    lastTimestamp = 0
    pendingVelocity.removeAll(); pendingDye.removeAll(); waves.removeAll()
    demoFrame = 0; demoLast = nil
    keepRandom = Mulberry32(GlassTuning.keepSeed)
    keepCooldown = 0; keepSteps = 0; keepSplats = 0
    meterValue = nil; meterShare = 0; meterEpoch += 1
    needsDraw = true
  }

  private func resetDemo() {
    demoFrame = 0
    demoLast = nil
    if fluid != nil { warmUp() }
    updateRunning()
  }

  // MARK: running

  private func updateRunning() {
    applyGround()
    if usesShared {
      if let l = link { l.invalidate(); link = nil }
      fluid = nil
      updateShared()
      return
    }
    if sharedAttached { sharedAttached = false; GlassWorld.shared.detach(ObjectIdentifier(self)); metalView.alpha = 0; shownFirstFrame = false }
    if fluid == nil { setNeedsLayout() }  // a view that just turned private builds its own field at the next layout
    let shouldRun = isLive && (needsDraw || !reduceMotion)
    if shouldRun {
      if link == nil {
        let l = CADisplayLink(target: WeakTarget(self), selector: #selector(WeakTarget.tick(_:)))
        l.add(to: .main, forMode: .common)
        link = l
        lastTimestamp = 0
      }
      updateFrameRate()
    } else if let l = link {
      l.invalidate()
      link = nil
    }
  }

  /// Lends the layer to the shared field while this view is on screen, and takes it back when
  /// it leaves. Coming on screen it first draws the field as it is right now, in the same
  /// transaction that shows the view, so a tab never opens on the frame it was left on.
  private func updateShared() {
    let world = GlassWorld.shared
    let id = ObjectIdentifier(self)
    let wanted = window != nil && !isHidden && !paused && bounds.width > 1 && bounds.height > 1
    guard wanted else {
      if sharedAttached { sharedAttached = false; world.detach(id) }
      return
    }
    light = resolveLight()
    world.setLight(light)
    world.setReduceMotion(reduceMotion)
    guard !sharedAttached else { return }
    sharedAttached = true
    metalView.alpha = world.hasShownFrame ? 1 : 0
    let layer = metalView.metalLayer
    let aspect = Float(bounds.width / bounds.height)
    if world.drawNow(into: layer) {
      // That frame went out with the transaction; the render thread takes over after it.
      DispatchQueue.main.async { [weak self] in
        layer.presentsWithTransaction = false
        guard let self, self.sharedAttached else { return }
        world.attach(id, layer: layer, aspect: aspect)
      }
    } else {
      world.attach(id, layer: layer, aspect: aspect)
    }
  }

  private func updateFrameRate() {
    guard let link else { return }
    let active = demo != nil || CACurrentMediaTime() < activeUntil
    let fps: Float = (active && !lowPower) ? 60 : 30
    if #available(iOS 15.0, *) {
      if link.preferredFrameRateRange.preferred != fps {
        link.preferredFrameRateRange = CAFrameRateRange(minimum: fps, maximum: fps, preferred: fps)
      }
    } else {
      link.preferredFramesPerSecond = Int(fps)
    }
  }

  private func markActive(_ seconds: Double) {
    activeUntil = max(activeUntil, CACurrentMediaTime() + seconds)
    updateRunning()
  }

  fileprivate func tick(_ link: CADisplayLink) {
    guard let fluid, let gpu, isLive else { updateRunning(); return }
    let cpu0 = CACurrentMediaTime()
    let reduce = reduceMotion
    var steps = 0
    var demoT: Double = 0
    if demo != nil {
      steps = 1
      demoT = Double(demoFrame) * demoFrameMs
    } else if !reduce {
      if lastTimestamp == 0 { lastTimestamp = link.timestamp - GlassTuning.dtDouble }
      accumulator += min(link.timestamp - lastTimestamp, 0.25)
      lastTimestamp = link.timestamp
      steps = Int(accumulator / GlassTuning.dtDouble)
      accumulator -= Double(steps) * GlassTuning.dtDouble
      if steps > 4 { steps = 4; accumulator = 0 }
    }
    updateFrameRate()
    if steps == 0 && !needsDraw { return }
    guard let drawable = metalView.metalLayer.nextDrawable(), let cb = gpu.queue.makeCommandBuffer() else { return }
    cb.label = "glass frame"
    let keep = fluid.canMeter && (demo == nil || demo == "keep")
    let measure = keep || (fluid.canMeter && demo == "fade")
    var metered = false
    if steps > 0, let enc = cb.makeComputeCommandEncoder() {
      for s in 0 ..< steps {
        var vs: [GFSplat] = [], ds: [GFSplat] = []
        if keep { keepAlive(into: &vs, dye: &ds) }
        if demo != nil {
          demoSplats(t: demoT, vs: &vs, ds: &ds)
        } else {
          if !reduce { GlassFluid.eddies(ts: simTime, into: &vs) }
          if s == 0 {
            vs += pendingVelocity; ds += pendingDye
            pendingVelocity.removeAll(); pendingDye.removeAll()
          }
          if !waves.isEmpty {
            for i in waves.indices { GlassFluid.wave(x: waves[i].x, y: waves[i].y, into: &vs, dye: &ds); waves[i].stepsLeft -= 1 }
            waves.removeAll { $0.stepsLeft <= 0 }
          }
        }
        fluid.encodeSplats(enc, velocity: vs, dye: ds)
        fluid.encodeStep(enc, dt: GlassTuning.dt)
        simTime += GlassTuning.dtDouble
        if measure {
          keepSteps += 1
          if keepSteps % GlassTuning.meterEvery == 0 { metered = fluid.encodeMeter(enc, light: light) }
        }
      }
      enc.endEncoding()
    }
    if metered && demo == nil {
      // Live: the reading comes back a frame or two later; a few steps' delay does not matter.
      let epoch = meterEpoch
      cb.addCompletedHandler { [weak self] _ in
        let reading = fluid.readMeter()
        DispatchQueue.main.async { self?.applyMeter(reading, epoch: epoch) }
      }
    }
    fluid.encodeDisplay(cb, target: drawable.texture, light: light, quiet: demo == nil && UIAccessibility.isDarkerSystemColorsEnabled)
    if demo != nil { snapshotIfWanted(cb, fluid: fluid, size: drawable.texture) }
    cb.present(drawable)
    let stats = debugStats
    if stats {
      statFrames += 1; statSteps += steps
      statCpu += (CACurrentMediaTime() - cpu0) * 1000
      cb.addCompletedHandler { [weak self] cb in
        let ms = (cb.gpuEndTime - cb.gpuStartTime) * 1000
        DispatchQueue.main.async { self?.recordGpu(ms) }
      }
    }
    if !shownFirstFrame {
      shownFirstFrame = true
      cb.addScheduledHandler { [weak self] _ in
        DispatchQueue.main.async {
          guard let self else { return }
          if self.demo != nil { self.metalView.alpha = 1; return }
          UIView.animate(withDuration: 0.35, delay: 0.05, options: [.curveEaseOut, .allowUserInteraction]) { self.metalView.alpha = 1 }
        }
      }
    }
    cb.commit()
    if demo != nil && (metered || (snapshotAll && snapshotDir != nil)) { cb.waitUntilCompleted() }
    if metered, let demo {
      // Demos read the meter before the next step, exactly as the tuning page does.
      applyMeter(fluid.readMeter(), epoch: meterEpoch)
      if keepSteps % 60 == 0 {
        NSLog("[glass] meter %@ %@ t=%d mean=%.2f share=%.2f%% splats=%d", demo, light ? "light" : "dark", keepSteps / 60,
              meterValue ?? 0, meterShare, keepSplats)
      }
    }
    needsDraw = false
    if demo != nil {
      demoFrame += 1
      if demo == "reference" && Double(demoFrame) * demoFrameMs >= 10_000 { resetDemo() }
    }
    // Reduce Motion: the settled field is drawn; nothing moves until something changes.
    if reduce && demo == nil { updateRunning() }
  }

  /// The keep-alive, once per step: while the last reading is under the level the approved
  /// clip holds, one more of the warm-up's splats goes in at a seeded random spot, at most one
  /// every 8 steps. Tuned in modules/hyper-glass-field/reference/glass7.html; `keepRandom` follows its sequence.
  private func keepAlive(into vs: inout [GFSplat], dye ds: inout [GFSplat]) {
    keepCooldown -= 1
    guard keepCooldown <= 0, let showing = meterValue,
          showing < (light ? GlassTuning.keepTargetLight : GlassTuning.keepTargetDark) else { return }
    keepCooldown = GlassTuning.keepCooldown
    keepSplats += 1
    let amt = light ? GlassTuning.warmDyeLight : GlassTuning.warmDyeDark
    let x = 0.1 + 0.8 * keepRandom.next(), y = 0.08 + 0.84 * keepRandom.next(), a = keepRandom.next() * Float.pi * 2
    GlassFluid.splats(x: x, y: y, dx: cos(a) * GlassTuning.warmForce, dy: sin(a) * GlassTuning.warmForce,
                      color: SIMD3(repeating: 1.2 * amt), radius: GlassTuning.warmRadius, into: &vs, dye: &ds)
  }

  private func applyMeter(_ reading: (mean: Float, share: Float), epoch: Int) {
    guard epoch == meterEpoch else { return }
    meterValue = reading.mean
    meterShare = reading.share
  }

  private func recordGpu(_ ms: Double) {
    statGpu += ms
    statGpuMax = max(statGpuMax, ms)
    let now = CACurrentMediaTime()
    if statStart == 0 { statStart = now }
    if now - statStart >= 2, statFrames > 0 {
      let fps = Double(statFrames) / (now - statStart)
      NSLog("[glass] %.0fx%.0f %@: %.1f fps, gpu avg %.2f ms max %.2f ms per frame, %.2f steps/frame, cpu encode %.2f ms, showing %.2f (%.2f%%), keep splats %d",
            bounds.width, bounds.height, light ? "light" : "dark", fps, statGpu / Double(statFrames), statGpuMax,
            Double(statSteps) / Double(statFrames), statCpu / Double(statFrames), meterValue ?? -1, meterShare, keepSplats)
      statFrames = 0; statSteps = 0; statGpu = 0; statGpuMax = 0; statCpu = 0; statStart = now
    }
  }

  // MARK: input from the app (window points)

  func touch(phase: Int, at windowPoint: CGPoint) {
    if usesShared {
      guard bounds.width > 0 else { return }
      let q = convert(windowPoint, from: nil)
      GlassWorld.shared.finger(phase: phase, x: Float(q.x / bounds.width), y: Float(1 - q.y / bounds.height))
      return
    }
    guard !reduceMotion, demo == nil, bounds.width > 0 else { return }
    let p = convert(windowPoint, from: nil)
    switch phase {
    case 0:
      lastTouch = p
      markActive(1)
    case 1:
      if let last = lastTouch {
        let w = bounds.width, h = bounds.height
        let dx = Float((p.x - last.x) / w) * GlassTuning.fingerForce
        let dy = -Float((p.y - last.y) / h) * GlassTuning.fingerForce
        if dx != 0 || dy != 0 {
          appendVelocity(GFSplat(point: SIMD2(Float(p.x / w), Float(1 - p.y / h)), radius: GlassTuning.fingerRadius, color: SIMD4(dx, dy, 0, 0)))
        }
      }
      lastTouch = p
      markActive(1)
    default:
      lastTouch = nil
      markActive(1)
    }
  }

  /// A scroll moved the page by (dx, dy) points: the glass behind is dragged along a little.
  func stir(dx: CGFloat, dy: CGFloat) {
    guard usesShared || !reduceMotion, demo == nil, bounds.width > 0 else { return }
    let k = GlassTuning.stirForce
    let fx = max(-GlassTuning.stirMax, min(GlassTuning.stirMax, -Float(dx / bounds.width) * k))
    let fy = max(-GlassTuning.stirMax, min(GlassTuning.stirMax, Float(dy / bounds.height) * k))
    guard fx != 0 || fy != 0 else { return }
    if usesShared { GlassWorld.shared.stir(fx: fx, fy: fy); return }
    for x in [Float(0.2), 0.5, 0.8] {
      appendVelocity(GFSplat(point: SIMD2(x, 0.5), radius: GlassTuning.stirRadius, color: SIMD4(fx, fy, 0, 0)))
    }
    markActive(1)
  }

  /// The warm wave from a press at a window point.
  func wave(at windowPoint: CGPoint) {
    guard usesShared || !reduceMotion, demo == nil, bounds.width > 0 else { return }
    let p = convert(windowPoint, from: nil)
    guard bounds.insetBy(dx: -40, dy: -40).contains(p) else { return }
    if usesShared { GlassWorld.shared.wave(x: Float(p.x / bounds.width), y: Float(1 - p.y / bounds.height)); return }
    waves.append((Float(p.x / bounds.width), Float(1 - p.y / bounds.height), GlassTuning.waveSteps))
    markActive(2.5)
  }

  /// A raw splat in the reference's units (x, y in 0…1 with y up; forces as the reference's).
  func splat(x: Float, y: Float, dx: Float, dy: Float, color: SIMD3<Float>, radius: Float) {
    if usesShared { GlassWorld.shared.splat(x: x, y: y, dx: dx, dy: dy, color: color, radius: radius); return }
    guard !reduceMotion, demo == nil else { return }
    var vs: [GFSplat] = [], ds: [GFSplat] = []
    GlassFluid.splats(x: x, y: y, dx: dx, dy: dy, color: color == .zero ? nil : color, radius: radius, into: &vs, dye: &ds)
    vs.forEach(appendVelocity)
    pendingDye += ds
    markActive(1)
  }

  private func appendVelocity(_ s: GFSplat) {
    if pendingVelocity.count < 256 { pendingVelocity.append(s) }
  }

  // MARK: the reference script (glass6.html), for side-by-side checks

  private static let refW = 270.0, refH = 587.0
  private static let refTap = (x: 135.0, y: 353.0)  // Train's Log set
  private static let fingerDown = 2500.0, fingerUp = 4300.0, pulse = 6000.0

  private func fingerAt(_ t: Double) -> (x: Double, y: Double, press: Bool)? {
    let d = HyperGlassFieldView.fingerDown, u = HyperGlassFieldView.fingerUp, tap = HyperGlassFieldView.refTap
    if t >= d - 150 && t <= u + 200 {
      let k = min(1, max(0, (t - d) / (u - d)))
      let e = k < 0.5 ? 2 * k * k : 1 - pow(-2 * k + 2, 2) / 2
      return (210 - 140 * e + 22 * sin(e * .pi * 2), 480 - 230 * e, t >= d && t <= u)
    }
    if abs(t - (HyperGlassFieldView.pulse + 60)) < 220 { return (tap.x, tap.y, t >= HyperGlassFieldView.pulse && t <= HyperGlassFieldView.pulse + 130) }
    return nil
  }

  private func demoSplats(t: Double, vs: inout [GFSplat], ds: inout [GFSplat]) {
    let W = HyperGlassFieldView.refW, H = HyperGlassFieldView.refH, tap = HyperGlassFieldView.refTap
    GlassFluid.eddies(ts: t / 1000, into: &vs)
    let fg = fingerAt(t)
    if let fg, fg.press, let last = demoLast, abs(t - HyperGlassFieldView.pulse) > 400 {
      GlassFluid.splats(x: Float(fg.x / W), y: Float(1 - fg.y / H), dx: Float((fg.x - last.x) / W * 5200), dy: Float(-(fg.y - last.y) / H * 5200),
                        color: nil, radius: GlassTuning.fingerRadius, into: &vs, dye: &ds)
    }
    demoLast = (fg?.press ?? false) ? (fg!.x, fg!.y) : nil
    if t >= HyperGlassFieldView.pulse && t < HyperGlassFieldView.pulse + 120 {
      GlassFluid.wave(x: Float(tap.x / W), y: Float(1 - tap.y / H), into: &vs, dye: &ds)
    }
    // The finger, drawn as the reference draws it (34 pt in a 270 × 587 view).
    if demoDot {
      CATransaction.begin(); CATransaction.setDisableActions(true)
      if let fg {
        let sx = bounds.width / W, sy = bounds.height / H, size = 34 * sy
        dot.frame = CGRect(x: fg.x * sx - size / 2, y: fg.y * sy - size / 2, width: size, height: size)
        dot.cornerRadius = size / 2
        dot.borderWidth = 1
        dot.opacity = Float(0.55 + 0.45 * (fg.press ? 1 : 0))
      } else {
        dot.opacity = 0
      }
      CATransaction.commit()
    }
  }

  // MARK: snapshots (debug comparison)

  private func parseSnapshots() {
    guard let spec = snapshotSpec, !spec.isEmpty else { snapshotDir = nil; snapshotFrames = []; return }
    let parts = spec.components(separatedBy: "|")
    guard parts.count == 3 else { return }
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
    let dir = docs.appendingPathComponent(parts[0], isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    snapshotDir = dir.path
    snapshotName = parts[1]
    // "all": every frame of the 10 s script, written as JPEGs, one frame per tick and waiting for
    // each, so a frame-exact video can be assembled whatever the simulator's pace.
    snapshotAll = parts[2] == "all"
    snapshotFrames = snapshotAll ? Set(0 ..< 640) : Set(parts[2].split(separator: ",").compactMap { Int($0) })
  }

  private func snapshotIfWanted(_ cb: MTLCommandBuffer, fluid: GlassFluid, size: MTLTexture) {
    guard let dir = snapshotDir, snapshotFrames.contains(demoFrame), let gpu else { return }
    let w = size.width, h = size.height
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: gpu.pixelFormat, width: w, height: h, mipmapped: false)
    d.usage = [.renderTarget]
    d.storageMode = .private
    guard let tex = gpu.device.makeTexture(descriptor: d), let buf = gpu.device.makeBuffer(length: w * h * 4, options: .storageModeShared) else { return }
    fluid.encodeDisplay(cb, target: tex, light: light)
    guard let blit = cb.makeBlitCommandEncoder() else { return }
    blit.copy(from: tex, sourceSlice: 0, sourceLevel: 0, sourceOrigin: MTLOrigin(), sourceSize: MTLSize(width: w, height: h, depth: 1),
              to: buf, destinationOffset: 0, destinationBytesPerRow: w * 4, destinationBytesPerImage: w * h * 4)
    blit.endEncoding()
    let path = "\(dir)/\(snapshotName)-\(String(format: "%04d", demoFrame)).\(snapshotAll ? "jpg" : "png")"
    let all = snapshotAll
    cb.addCompletedHandler { _ in
      let data = Data(bytes: buf.contents(), count: w * h * 4)
      guard let provider = CGDataProvider(data: data as CFData),
            let img = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGBitmapInfo(rawValue: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.noneSkipFirst.rawValue),
                              provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
      else { return }
      let ui = UIImage(cgImage: img)
      try? (all ? ui.jpegData(compressionQuality: 0.93) : ui.pngData())?.write(to: URL(fileURLWithPath: path))
      if !all { NSLog("[glass] snapshot %@", path) }
    }
  }
}

/// Breaks the display link's strong hold on its target.
private final class WeakTarget: NSObject {
  weak var view: HyperGlassFieldView?
  init(_ view: HyperGlassFieldView) { self.view = view }
  @objc func tick(_ link: CADisplayLink) {
    guard let view else { link.invalidate(); return }
    view.tickFromLink(link)
  }
}

extension HyperGlassFieldView {
  fileprivate func tickFromLink(_ link: CADisplayLink) { tick(link) }
}

extension GlassTuning {
  static let dtDouble: Double = 1.0 / 60.0
  // Scrolling (not in the reference, which has no scroll): three broad splats across the
  // middle of the field, the page's movement scaled so a brisk scroll stirs about as much as
  // an eddy does, never more than a light push.
  static let stirForce: Float = 500
  static let stirMax: Float = 30
  static let stirRadius: Float = 0.02
}
