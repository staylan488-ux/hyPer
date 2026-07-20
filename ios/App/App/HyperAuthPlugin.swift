import AuthenticationServices
import Capacitor
import Foundation
import Security
import UIKit

final class HyperAuthDeepLinkRouter {
    static let shared = HyperAuthDeepLinkRouter()

    private weak var plugin: HyperAuthPlugin?
    private var pendingURL: URL?

    private init() {}

    func attach(_ plugin: HyperAuthPlugin) {
        self.plugin = plugin
    }

    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard url.scheme == "com.alexanderroesler.hyper",
              url.host == "auth",
              url.path == "/callback"
        else { return false }

        if let plugin, plugin.hasListeners("authCallback") {
            plugin.notifyListeners(
                "authCallback",
                data: ["callbackUrl": url.absoluteString],
                retainUntilConsumed: true
            )
        } else {
            pendingURL = url
        }
        return true
    }

    func takePendingURL() -> URL? {
        defer { pendingURL = nil }
        return pendingURL
    }
}

@objc(HyperAuthPlugin)
final class HyperAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HyperAuthPlugin"
    let jsName = "HyperAuth"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openOAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSecureValue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecureValue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeSecureValue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingAuthCallback", returnType: CAPPluginReturnPromise),
    ]

    private static let callbackScheme = "com.alexanderroesler.hyper"
    private var webAuthenticationSession: ASWebAuthenticationSession?

    override func load() {
        HyperAuthDeepLinkRouter.shared.attach(self)
    }

    @objc func openOAuth(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"),
              let url = URL(string: rawURL),
              url.scheme == "https"
        else {
            call.reject("A valid HTTPS OAuth URL is required.", "INVALID_URL")
            return
        }
        guard call.getString("callbackScheme") == Self.callbackScheme else {
            call.reject("The OAuth callback scheme is not allowed.", "INVALID_CALLBACK")
            return
        }
        guard let callbackHost = call.getString("callbackHost"),
              let callbackPath = call.getString("callbackPath"),
              (callbackHost == "auth" && callbackPath == "/callback")
                || (callbackHost == "settings" && callbackPath.isEmpty)
        else {
            call.reject("The OAuth callback destination is not allowed.", "INVALID_CALLBACK")
            return
        }
        guard webAuthenticationSession == nil else {
            call.reject("Another sign-in is already in progress.", "AUTH_IN_PROGRESS")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Unable to start sign-in.", "UNAVAILABLE")
                return
            }
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: Self.callbackScheme
            ) { [weak self] callbackURL, error in
                defer { self?.webAuthenticationSession = nil }
                if let authenticationError = error as? ASWebAuthenticationSessionError,
                   authenticationError.code == .canceledLogin
                {
                    call.reject("Sign-in was cancelled.", "CANCELLED", authenticationError)
                    return
                }
                if let error {
                    call.reject("Unable to complete sign-in.", "AUTH_FAILED", error)
                    return
                }
                guard let callbackURL,
                      callbackURL.scheme == Self.callbackScheme,
                      callbackURL.host == callbackHost,
                      callbackURL.path == callbackPath
                else {
                    call.reject("The sign-in provider returned an invalid callback.", "INVALID_CALLBACK")
                    return
                }
                call.resolve(["callbackUrl": callbackURL.absoluteString])
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.webAuthenticationSession = session
            if !session.start() {
                self.webAuthenticationSession = nil
                call.reject("Unable to present sign-in.", "UNAVAILABLE")
            }
        }
    }

    @objc func getSecureValue(_ call: CAPPluginCall) {
        guard let key = validatedKey(from: call) else { return }
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8)
        else {
            call.reject("Secure session storage is unavailable.", "KEYCHAIN_READ_FAILED")
            return
        }
        call.resolve(["value": value])
    }

    @objc func setSecureValue(_ call: CAPPluginCall) {
        guard let key = validatedKey(from: call) else { return }
        guard let value = call.getString("value"),
              let data = value.data(using: .utf8),
              data.count <= 1_000_000
        else {
            call.reject("The secure value is invalid or too large.", "INVALID_VALUE")
            return
        }

        let query = baseQuery(for: key)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            call.resolve()
            return
        }
        guard updateStatus == errSecItemNotFound else {
            call.reject("Unable to update secure session storage.", "KEYCHAIN_WRITE_FAILED")
            return
        }

        var newItem = query
        newItem[kSecValueData as String] = data
        newItem[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(newItem as CFDictionary, nil) == errSecSuccess else {
            call.reject("Unable to save secure session storage.", "KEYCHAIN_WRITE_FAILED")
            return
        }
        call.resolve()
    }

    @objc func removeSecureValue(_ call: CAPPluginCall) {
        guard let key = validatedKey(from: call) else { return }
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Unable to clear secure session storage.", "KEYCHAIN_DELETE_FAILED")
            return
        }
        call.resolve()
    }

    @objc func getPendingAuthCallback(_ call: CAPPluginCall) {
        call.resolve([
            "callbackUrl": HyperAuthDeepLinkRouter.shared.takePendingURL()?.absoluteString ?? NSNull(),
        ])
    }

    private func validatedKey(from call: CAPPluginCall) -> String? {
        guard let key = call.getString("key"),
              !key.isEmpty,
              key.utf8.count <= 512
        else {
            call.reject("A valid secure-storage key is required.", "INVALID_KEY")
            return nil
        }
        return key
    }

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "\(Bundle.main.bundleIdentifier ?? "hyPer").auth",
            kSecAttrAccount as String: key,
        ]
    }
}

extension HyperAuthPlugin: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
