import Capacitor
import CoreMotion
import CoreText
import Foundation
import SwiftUI
import UIKit

// MARK: - Fonts

/// Geist and Fraunces ship inside the web bundle (`public/fonts/native`), so
/// native surfaces can speak the same typography without extra Xcode
/// resources. Missing files fall back to the system faces.
enum HyperFonts {
    private static var registered: [String: String] = [:]
    private static var didRegister = false

    static func registerBundled() {
        guard !didRegister else { return }
        didRegister = true
        for file in ["Geist-Medium", "Fraunces-Light"] {
            guard let url = Bundle.main.url(forResource: file, withExtension: "ttf", subdirectory: "public/fonts/native"),
                  let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
                  let name = descriptors.first.flatMap({ CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String })
            else { continue }
            var error: Unmanaged<CFError>?
            if CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) || UIFont(name: name, size: 12) != nil {
                registered[file] = name
            }
        }
    }

    static func sans(_ size: CGFloat) -> UIFont {
        registerBundled()
        return registered["Geist-Medium"].flatMap { UIFont(name: $0, size: size) }
            ?? UIFont.systemFont(ofSize: size, weight: .medium)
    }

    static func display(_ size: CGFloat) -> UIFont {
        registerBundled()
        if let name = registered["Fraunces-Light"], let font = UIFont(name: name, size: size) { return font }
        let descriptor = UIFont.systemFont(ofSize: size, weight: .light).fontDescriptor.withDesign(.serif)
        return descriptor.map { UIFont(descriptor: $0, size: size) } ?? UIFont.systemFont(ofSize: size, weight: .light)
    }
}

extension Color {
    init(hyperHex hex: String, fallback: Color) {
        let digits = hex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self = fallback
            return
        }
        self = Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

// MARK: - Rest dock

final class RestDockModel: ObservableObject {
    @Published var presented = false
    @Published var status = "running"
    @Published var endsAt = Date()
    @Published var pausedRemaining: TimeInterval = 0
    @Published var total: TimeInterval = 90
    @Published var nextLabel: String?
    @Published var accent = Color(red: 0.66, green: 0.21, blue: 0.16)
    var onAction: ((String) -> Void)?

    func remaining(at date: Date) -> TimeInterval {
        switch status {
        case "running": return max(0, endsAt.timeIntervalSince(date))
        case "paused": return max(0, pausedRemaining)
        default: return 0
        }
    }
}

@available(iOS 26.0, *)
struct RestDockView: View {
    @ObservedObject var model: RestDockModel
    @Namespace private var glass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var completed: Bool { model.status == "completed" }
    private var paused: Bool { model.status == "paused" }

    var body: some View {
        ZStack(alignment: .bottom) {
            if model.presented {
                TimelineView(.periodic(from: .now, by: 0.25)) { context in
                    dock(at: context.date)
                }
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .animation(reduceMotion ? nil : .spring(duration: 0.5, bounce: 0.28), value: model.presented)
        .animation(reduceMotion ? nil : .spring(duration: 0.45, bounce: 0.3), value: model.status)
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let whole = Int(seconds.rounded(.up))
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }

    @ViewBuilder
    private func dock(at date: Date) -> some View {
        let left = model.remaining(at: date)
        let wholeLeft = Int(left.rounded(.up))
        let warning = model.status == "running" && wholeLeft <= 10
        let fraction = model.total > 0 ? min(1, max(0, left / model.total)) : 0

        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                Button { model.onAction?("open") } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline, spacing: 9) {
                            Text(clock(left))
                                .font(Font(HyperFonts.display(30)))
                                .monospacedDigit()
                                .foregroundStyle(warning ? model.accent : Color.primary)
                                .contentTransition(reduceMotion ? .identity : .numericText(countsDown: true))
                                .animation(reduceMotion ? nil : .snappy(duration: 0.3), value: wholeLeft)
                            Text(completed ? "Rest complete" : paused ? "Paused" : "Rest")
                                .font(Font(HyperFonts.sans(11)))
                                .foregroundStyle(.secondary)
                        }
                        Text(model.nextLabel.map { "Next · \($0)" } ?? (completed ? "Ready when you are" : "Tap timer for options"))
                            .font(Font(HyperFonts.sans(11)))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 22)
                    .padding(.trailing, 12)
                    .frame(minHeight: 64)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .capsule)
                .glassEffectID("summary", in: glass)
                .accessibilityLabel("Rest timer, \(clock(left)) remaining\(model.nextLabel.map { ", next \($0)" } ?? "")")
                .accessibilityHint("Opens rest timer options")

                if !completed {
                    Button { model.onAction?("toggle") } label: {
                        ZStack {
                            Circle()
                                .stroke(Color.primary.opacity(0.12), lineWidth: 2.5)
                            Circle()
                                .trim(from: 0, to: fraction)
                                .stroke(warning ? model.accent : Color.primary.opacity(0.7), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                                .animation(reduceMotion ? nil : .linear(duration: 0.25), value: fraction)
                            Image(systemName: paused ? "play.fill" : "pause.fill")
                                .font(.system(size: 17, weight: .semibold))
                                .contentTransition(.symbolEffect(.replace))
                        }
                        .padding(9)
                        .frame(width: 64, height: 64)
                        .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .glassEffectID("toggle", in: glass)
                    .accessibilityLabel(paused ? "Resume rest timer" : "Pause rest timer")
                }

                Button { model.onAction?(completed ? "continue" : "skip") } label: {
                    Text(completed ? "Continue" : "Skip")
                        .font(Font(HyperFonts.sans(13)))
                        .foregroundStyle(completed ? Color.white : Color.primary)
                        .padding(.horizontal, 18)
                        .frame(minWidth: 64, minHeight: 64)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .glassEffect(completed ? .regular.tint(model.accent).interactive() : .regular.interactive(), in: .capsule)
                .glassEffectID("action", in: glass)
                .accessibilityLabel(completed ? "Continue training" : "Skip rest")
            }
        }
    }
}

// MARK: - Toast

final class ToastModel: ObservableObject {
    @Published var message: String?
}

@available(iOS 26.0, *)
struct GlassToastView: View {
    @ObservedObject var model: ToastModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack(alignment: .top) {
            if let message = model.message {
                Text(message)
                    .font(Font(HyperFonts.sans(13)))
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .glassEffect(.regular, in: .capsule)
                    .id(message)
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(reduceMotion ? nil : .spring(duration: 0.45, bounce: 0.3), value: model.message)
    }
}

// MARK: - Plugin

/// Native iOS 26 glass for surfaces that float above the web view: the rest
/// dock and toasts, plus the device-attitude stream that drives the web's
/// motion light. The web keeps every timer, save and preference; these views
/// only draw state they are sent and report taps back.
@objc(HyperGlassSurfacesPlugin)
final class HyperGlassSurfacesPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HyperGlassSurfacesPlugin"
    let jsName = "HyperGlassSurfaces"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncRest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncToast", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startMotion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopMotion", returnType: CAPPluginReturnPromise),
    ]

    private let revisionLock = NSLock()
    private var newestRest = -1
    private var newestToast = -1
    /// Bumped when the web document reloads: queued syncs from the old page
    /// must not bring a surface back.
    private var documentGeneration = 0
    private var webViewLoadingObservation: NSKeyValueObservation?

    private let restModel = RestDockModel()
    private var restController: UIViewController?
    private var restWantsVisible = false
    private var pendingRestHide: DispatchWorkItem?
    private var restHideGeneration = 0
    private var presentationPoll: Timer?

    private let toastModel = ToastModel()
    private var toastController: UIViewController?
    private var announcedToast: String?

    private var keyboardVisible = false
    private var appInactive = false
    private var observers: [NSObjectProtocol] = []

    private let motion = CMMotionManager()
    private var motionRequested = false
    private var motionToken = 0
    private var restingPitch: Double?
    private var lastMotion: (x: Double, y: Double)?

    override func load() {
        guard #available(iOS 26.0, *) else { return }
        restModel.onAction = { [weak self] action in
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            self?.notifyListeners("restAction", data: ["action": action])
        }
        DispatchQueue.main.async { [weak self] in
            HyperFonts.registerBundled()
            self?.installObservers()
        }
    }

    @objc func getCapabilities(_ call: CAPPluginCall) {
        revisionLock.lock()
        let rest = newestRest
        let toast = newestToast
        revisionLock.unlock()
        if #available(iOS 26.0, *) {
            call.resolve(["supported": true, "restRevision": rest, "toastRevision": toast, "motion": motion.isDeviceMotionAvailable])
        } else {
            call.resolve(["supported": false, "restRevision": rest, "toastRevision": toast, "motion": false])
        }
    }

    /// Records a sync's receipt; returns the document generation it belongs
    /// to, or nil when a newer revision already arrived.
    private func accept(_ revision: Int, newest: Swift.ReferenceWritableKeyPath<HyperGlassSurfacesPlugin, Int>) -> Int? {
        revisionLock.lock()
        defer { revisionLock.unlock() }
        guard revision > self[keyPath: newest] else { return nil }
        self[keyPath: newest] = revision
        return documentGeneration
    }

    private func isNewest(_ revision: Int, _ newest: Swift.KeyPath<HyperGlassSurfacesPlugin, Int>, generation: Int) -> Bool {
        revisionLock.lock()
        defer { revisionLock.unlock() }
        return revision == self[keyPath: newest] && generation == documentGeneration
    }

    // MARK: Rest

    @objc func syncRest(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.resolve(["supported": false, "applied": false])
            return
        }
        guard let revision = call.getInt("revision"), revision >= 0,
              let visible = call.getBool("visible"),
              let theme = call.getString("theme"), ["light", "dark"].contains(theme) else {
            call.reject("Expected revision, visibility and theme.", "INVALID_REST")
            return
        }
        guard let generation = accept(revision, newest: \.newestRest) else {
            call.resolve(["supported": true, "applied": false])
            return
        }
        let status = call.getString("status") ?? "running"
        let endsAtMs = call.getDouble("endsAtMs")
        let remainingMs = call.getDouble("remainingMs") ?? 0
        let totalMs = call.getDouble("totalMs") ?? 90_000
        let nextLabel = call.getString("nextLabel")
        let accent = call.getString("accent") ?? "#A8352A"

        DispatchQueue.main.async { [weak self] in
            guard let self, self.isNewest(revision, \.newestRest, generation: generation), let host = self.bridge?.viewController else {
                call.resolve(["supported": true, "applied": false])
                return
            }
            self.installObservers()
            let controller = self.restController ?? self.makeRestController(in: host)
            controller.view.overrideUserInterfaceStyle = theme == "dark" ? .dark : .light
            let model = self.restModel
            model.status = ["running", "paused", "completed"].contains(status) ? status : "running"
            if let endsAtMs { model.endsAt = Date(timeIntervalSince1970: endsAtMs / 1000) }
            model.pausedRemaining = remainingMs / 1000
            model.total = max(1, totalMs / 1000)
            model.nextLabel = (nextLabel?.isEmpty == false) ? nextLabel : nil
            model.accent = Color(hyperHex: accent, fallback: model.accent)
            self.restWantsVisible = visible
            self.refreshRest()
            call.resolve(["supported": true, "applied": true])
        }
    }

    @available(iOS 26.0, *)
    private func makeRestController(in host: UIViewController) -> UIViewController {
        let controller = UIHostingController(rootView: RestDockView(model: restModel))
        controller.view.backgroundColor = .clear
        controller.sizingOptions = []
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        controller.view.accessibilityIdentifier = "hyper-native-rest-dock"
        controller.view.isHidden = true
        host.addChild(controller)
        host.view.addSubview(controller.view)
        controller.didMove(toParent: host)
        let preferredWidth = controller.view.widthAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.widthAnchor, constant: -24)
        preferredWidth.priority = .defaultHigh
        NSLayoutConstraint.activate([
            preferredWidth,
            controller.view.widthAnchor.constraint(lessThanOrEqualToConstant: 488),
            controller.view.centerXAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.centerXAnchor),
            controller.view.bottomAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            controller.view.heightAnchor.constraint(equalToConstant: 64),
        ])
        restController = controller
        return controller
    }

    private func canShowRest() -> Bool {
        restWantsVisible && !keyboardVisible && !appInactive
            && bridge?.viewController?.presentedViewController == nil
    }

    private func refreshRest() {
        guard let view = restController?.view else { return }
        pendingRestHide?.cancel()
        pendingRestHide = nil
        if canShowRest() {
            presentationPoll?.invalidate()
            presentationPoll = nil
            restHideGeneration += 1
            view.isHidden = false
            view.isUserInteractionEnabled = true
            if !restModel.presented { restModel.presented = true }
            return
        }
        view.isUserInteractionEnabled = false
        if appInactive {
            restHideGeneration += 1
            restModel.presented = false
            view.isHidden = true
            return
        }
        // A native presentation (scanner, share sheet) hides the dock; nothing
        // notifies its dismissal, so look again until it is gone.
        if restWantsVisible, bridge?.viewController?.presentedViewController != nil, presentationPoll == nil {
            presentationPoll = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] timer in
                guard let self else { timer.invalidate(); return }
                if !self.restWantsVisible || self.bridge?.viewController?.presentedViewController == nil {
                    timer.invalidate()
                    self.presentationPoll = nil
                    self.refreshRest()
                }
            }
        }
        // A remount hides and re-shows within a frame; wait briefly so the
        // glass does not flicker, then let SwiftUI dematerialise it.
        restHideGeneration += 1
        let generation = restHideGeneration
        let work = DispatchWorkItem { [weak self] in
            guard let self, generation == self.restHideGeneration, !self.canShowRest() else { return }
            self.restModel.presented = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self, generation == self.restHideGeneration, !self.restModel.presented else { return }
                self.restController?.view.isHidden = true
            }
        }
        pendingRestHide = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08, execute: work)
    }

    // MARK: Toast

    @objc func syncToast(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.resolve(["supported": false, "applied": false])
            return
        }
        guard let revision = call.getInt("revision"), revision >= 0,
              let visible = call.getBool("visible"),
              let theme = call.getString("theme"), ["light", "dark"].contains(theme) else {
            call.reject("Expected revision, visibility and theme.", "INVALID_TOAST")
            return
        }
        guard let generation = accept(revision, newest: \.newestToast) else {
            call.resolve(["supported": true, "applied": false])
            return
        }
        let message = call.getString("message") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isNewest(revision, \.newestToast, generation: generation), let host = self.bridge?.viewController else {
                call.resolve(["supported": true, "applied": false])
                return
            }
            self.installObservers()
            let controller = self.toastController ?? self.makeToastController(in: host)
            controller.view.overrideUserInterfaceStyle = theme == "dark" ? .dark : .light
            let showing = visible && !message.isEmpty && !self.appInactive
            self.toastModel.message = showing ? message : nil
            // Announce each appearance once, not on every re-sync.
            if showing, self.announcedToast != message {
                UIAccessibility.post(notification: .announcement, argument: message)
            }
            self.announcedToast = showing ? message : nil
            call.resolve(["supported": true, "applied": true])
        }
    }

    @available(iOS 26.0, *)
    private func makeToastController(in host: UIViewController) -> UIViewController {
        let controller = UIHostingController(rootView: GlassToastView(model: toastModel))
        controller.view.backgroundColor = .clear
        // A fixed stage: sizing to the pill would re-centre it mid-transition.
        controller.sizingOptions = []
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        // Status only: touches always reach the page beneath.
        controller.view.isUserInteractionEnabled = false
        controller.view.accessibilityIdentifier = "hyper-native-toast"
        host.addChild(controller)
        host.view.addSubview(controller.view)
        controller.didMove(toParent: host)
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            controller.view.trailingAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            controller.view.topAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.topAnchor, constant: 8),
            controller.view.heightAnchor.constraint(equalToConstant: 64),
        ])
        toastController = controller
        return controller
    }

    // MARK: Motion

    @objc func startMotion(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(["active": false, "token": 0]); return }
            self.motionRequested = true
            self.motionToken += 1
            let active = self.startMotionUpdatesIfPossible()
            call.resolve(["active": active, "token": self.motionToken])
        }
    }

    @objc func stopMotion(_ call: CAPPluginCall) {
        let token = call.getInt("token")
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(); return }
            // Only the newest subscriber may stop the stream, so a late stop
            // from a replaced subscription cannot cut off its successor.
            if token == nil || token == self.motionToken {
                self.motionRequested = false
                self.motion.stopDeviceMotionUpdates()
            }
            call.resolve()
        }
    }

    @discardableResult
    private func startMotionUpdatesIfPossible() -> Bool {
        guard motionRequested, !appInactive, motion.isDeviceMotionAvailable else { return false }
        guard !motion.isDeviceMotionActive else { return true }
        // 15 Hz is plenty for a diffuse light; only changes cross the bridge.
        motion.deviceMotionUpdateInterval = 1.0 / 15.0
        restingPitch = nil
        lastMotion = nil
        motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
            guard let self, let attitude = data?.attitude else { return }
            let pitch = attitude.pitch
            let resting = (self.restingPitch ?? pitch) + (pitch - (self.restingPitch ?? pitch)) * 0.01
            self.restingPitch = resting
            let clamp: (Double) -> Double = { max(-1, min(1, $0)) }
            let x = clamp(attitude.roll / 0.5)
            let y = clamp((resting - pitch) / 0.5)
            if let last = self.lastMotion, abs(last.x - x) < 0.012, abs(last.y - y) < 0.012 { return }
            self.lastMotion = (x, y)
            self.notifyListeners("motion", data: ["x": x, "y": y])
        }
        return true
    }

    // MARK: Lifecycle

    private func installObservers() {
        if webViewLoadingObservation == nil, let webView = bridge?.webView {
            webViewLoadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] _, change in
                guard change.newValue == true else { return }
                if Thread.isMainThread {
                    self?.resetForDocumentReload()
                } else {
                    DispatchQueue.main.async { [weak self] in self?.resetForDocumentReload() }
                }
            }
        }
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in
            self?.keyboardVisible = true
            self?.refreshRest()
        })
        observers.append(center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
            self?.keyboardVisible = false
            self?.refreshRest()
        })
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                self.appInactive = true
                self.refreshRest()
                self.toastModel.message = nil
                self.motion.stopDeviceMotionUpdates()
            })
        }
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.appInactive = false
            self.refreshRest()
            self.startMotionUpdatesIfPossible()
        })
    }

    /// A full document load (crash recovery, reload) may never remount the
    /// surfaces that asked to be shown, so drop them and any queued syncs.
    private func resetForDocumentReload() {
        revisionLock.lock()
        documentGeneration += 1
        revisionLock.unlock()
        restWantsVisible = false
        refreshRest()
        toastModel.message = nil
        announcedToast = nil
        motionRequested = false
        motion.stopDeviceMotionUpdates()
    }

    deinit {
        webViewLoadingObservation?.invalidate()
        presentationPoll?.invalidate()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        motion.stopDeviceMotionUpdates()
        let rest = restController
        let toast = toastController
        DispatchQueue.main.async {
            for controller in [rest, toast].compactMap({ $0 }) {
                controller.willMove(toParent: nil)
                controller.view.removeFromSuperview()
                controller.removeFromParent()
            }
        }
    }
}
