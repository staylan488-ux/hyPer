import Capacitor
import Foundation
import UIKit
import WebKit

/// A deliberately small native surface: all page content remains in the web view.
@objc(HyperGlassNavigationPlugin)
final class HyperGlassNavigationPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HyperGlassNavigationPlugin"
    let jsName = "HyperGlassNavigation"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
    ]

    // Calls arrive on the Capacitor queue, while UIKit work runs on main. Record
    // receipt before dispatch so hide/newer sync can invalidate queued work.
    private let revisionLock = NSLock()
    private var newestRevision = -1
    private var visibilityGeneration = 0
    private var dock: UIView?
    private var buttons: [String: UIButton] = [:]
    private var desiredVisible = false
    private var keyboardVisible = false
    private var appInactive = false
    private var observers: [NSObjectProtocol] = []
    private var webViewLoadingObservation: NSKeyValueObservation?
    private let tabs = [
        (id: "today", title: "TODAY", symbol: "house"),
        (id: "train", title: "TRAIN", symbol: "dumbbell"),
        (id: "fuel", title: "FUEL", symbol: "leaf"),
        (id: "you", title: "YOU", symbol: "person"),
    ]

    override func load() {
        guard #available(iOS 26.0, *) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.installObserversIfNeeded()
        }
    }

    @objc func getCapabilities(_ call: CAPPluginCall) {
        revisionLock.lock()
        let revision = newestRevision
        revisionLock.unlock()
        // A web-view reload can outlive the plugin. JS seeds its next revision
        // above this value instead of assuming a fresh native instance.
        if #available(iOS 26.0, *) {
            call.resolve(["supported": true, "revision": revision])
        } else {
            call.resolve(["supported": false, "revision": revision])
        }
    }

    @objc func sync(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.resolve(["supported": false, "applied": false])
            return
        }
        guard let selected = call.getString("selected"),
              tabs.contains(where: { $0.id == selected }),
              let visible = call.getBool("visible"),
              let theme = call.getString("theme"), ["light", "dark"].contains(theme),
              let revision = call.getInt("revision"), revision >= 0 else {
            call.reject("Expected a navigation tab, visibility, theme, and nonnegative revision.", "INVALID_SYNC")
            return
        }
        revisionLock.lock()
        guard revision > newestRevision else {
            revisionLock.unlock()
            call.resolve(["supported": true, "applied": false])
            return
        }
        newestRevision = revision
        let generation = visibilityGeneration
        revisionLock.unlock()

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve(["supported": true, "applied": false])
                return
            }
            self.revisionLock.lock()
            let current = revision == self.newestRevision && generation == self.visibilityGeneration
            self.revisionLock.unlock()
            guard current, let host = self.bridge?.viewController else {
                call.resolve(["supported": true, "applied": false])
                return
            }
            self.installObserversIfNeeded()
            if self.dock == nil {
                self.createDock(in: host)
            }
            self.dock?.overrideUserInterfaceStyle = theme == "dark" ? .dark : .light
            self.dock?.accessibilityValue = theme
            self.updateSelection(selected)
            self.desiredVisible = visible
            self.refreshVisibility()
            call.resolve(["supported": true, "applied": true])
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        revisionLock.lock()
        visibilityGeneration += 1
        let generation = visibilityGeneration
        let revision = newestRevision
        revisionLock.unlock()
        DispatchQueue.main.async { [weak self] in
            guard let self else { call.resolve(); return }
            self.revisionLock.lock()
            let current = generation == self.visibilityGeneration && revision == self.newestRevision
            self.revisionLock.unlock()
            if current {
                self.desiredVisible = false
                self.refreshVisibility()
            }
            call.resolve()
        }
    }

    @available(iOS 26.0, *)
    private func createDock(in host: UIViewController) {
        let effect = UIGlassEffect(style: .regular)
        effect.isInteractive = true
        let glass = UIVisualEffectView(effect: effect)
        glass.translatesAutoresizingMaskIntoConstraints = false
        glass.cornerConfiguration = .capsule(maximumRadius: 26)
        glass.clipsToBounds = true
        glass.isHidden = true
        glass.accessibilityIdentifier = "hyper-native-glass-navigation"

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.spacing = 2
        stack.translatesAutoresizingMaskIntoConstraints = false
        glass.contentView.addSubview(stack)
        for tab in tabs {
            let button = UIButton(type: .system)
            button.accessibilityLabel = tab.title.capitalized
            button.accessibilityIdentifier = "hyper-native-tab-\(tab.id)"
            button.addAction(UIAction { [weak self] _ in
                guard let self, self.canShowDock(),
                      self.bridge?.viewController?.presentedViewController == nil else { return }
                // Selection is acknowledged by the router's next sync, so a
                // rejected navigation never leaves a misleading selected tab.
                self.notifyListeners("select", data: ["tab": tab.id])
            }, for: .touchUpInside)
            buttons[tab.id] = button
            stack.addArrangedSubview(button)
        }
        host.view.addSubview(glass)
        let preferredWidth = glass.widthAnchor.constraint(equalTo: host.view.widthAnchor, constant: -34)
        preferredWidth.priority = .defaultHigh
        NSLayoutConstraint.activate([
            glass.heightAnchor.constraint(equalToConstant: 68),
            glass.widthAnchor.constraint(lessThanOrEqualToConstant: 478),
            glass.leadingAnchor.constraint(greaterThanOrEqualTo: host.view.safeAreaLayoutGuide.leadingAnchor, constant: 17),
            glass.trailingAnchor.constraint(lessThanOrEqualTo: host.view.safeAreaLayoutGuide.trailingAnchor, constant: -17),
            glass.centerXAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.centerXAnchor),
            glass.bottomAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            preferredWidth,
            stack.leadingAnchor.constraint(equalTo: glass.contentView.leadingAnchor, constant: 5),
            stack.trailingAnchor.constraint(equalTo: glass.contentView.trailingAnchor, constant: -5),
            stack.topAnchor.constraint(equalTo: glass.contentView.topAnchor, constant: 5),
            stack.bottomAnchor.constraint(equalTo: glass.contentView.bottomAnchor, constant: -5),
        ])
        dock = glass
    }

    private func updateSelection(_ selected: String) {
        for tab in tabs {
            guard let button = buttons[tab.id] else { continue }
            let active = tab.id == selected
            var configuration = UIButton.Configuration.plain()
            configuration.image = UIImage(systemName: tab.symbol)
            configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)
            configuration.imagePlacement = .top
            configuration.imagePadding = 6
            configuration.contentInsets = NSDirectionalEdgeInsets(top: 5, leading: 0, bottom: 5, trailing: 0)
            configuration.baseForegroundColor = active ? .label : .secondaryLabel
            // A quiet selection plate within the actual system glass, without
            // a second effect layer or any hand-painted glass approximation.
            configuration.background.backgroundColor = active ? UIColor.label.withAlphaComponent(0.08) : .clear
            configuration.background.cornerRadius = 20
            let font = UIFont(name: "Geist-Medium", size: 11) ?? UIFont.systemFont(ofSize: 11, weight: .medium)
            configuration.attributedTitle = AttributedString(NSAttributedString(
                string: tab.title,
                attributes: [.font: font, .kern: 1.1]
            ))
            button.configuration = configuration
            button.isSelected = active
            button.accessibilityTraits = active ? [.button, .selected] : [.button]
        }
    }

    private func installObserversIfNeeded() {
        if webViewLoadingObservation == nil, let webView = bridge?.webView {
            webViewLoadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] _, change in
                guard change.newValue == true else { return }
                // WKWebView loading changes occur on main. Do not replace its
                // navigation delegate: Capacitor and auth own that lifecycle.
                if Thread.isMainThread {
                    self?.hideForMainNavigation()
                } else {
                    DispatchQueue.main.async { [weak self] in self?.hideForMainNavigation() }
                }
            }
        }
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] _ in
            self?.keyboardVisible = true
            self?.refreshVisibility()
        })
        observers.append(center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
            self?.keyboardVisible = false
            self?.refreshVisibility()
        })
        for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.appInactive = true
                self?.dock?.isHidden = true
            })
        }
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.appInactive = false
            self?.refreshVisibility()
        })
    }

    private func hideForMainNavigation() {
        // A full document navigation does not guarantee a React unmount. Drop
        // both desired visibility and queued syncs; loading=false cannot restore
        // the dock. Same-document router changes do not trigger isLoading.
        revisionLock.lock()
        visibilityGeneration += 1
        revisionLock.unlock()
        desiredVisible = false
        refreshVisibility()
    }

    private func canShowDock() -> Bool {
        guard desiredVisible, !keyboardVisible, !appInactive,
              UIApplication.shared.applicationState == .active,
              let host = bridge?.viewController,
              host.viewIfLoaded?.window != nil,
              !host.isBeingDismissed else { return false }
        return true
    }

    private func refreshVisibility() {
        // UIKit presents native controllers above this host overlay. They cover
        // the dock naturally; the tap guard also refuses navigation underneath
        // a presentation. Web sheets use the bridge's explicit visible state.
        dock?.isHidden = !canShowDock()
    }

    deinit {
        webViewLoadingObservation?.invalidate()
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        let oldDock = dock
        DispatchQueue.main.async { oldDock?.removeFromSuperview() }
    }
}
