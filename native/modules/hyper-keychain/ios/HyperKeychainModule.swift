import ExpoModulesCore
import Foundation
import Security

// The auth session's Keychain items, written exactly as the Capacitor app's
// HyperAuthPlugin writes them: a generic password with service
// "<bundle ID>.auth", account = the storage key, readable after first unlock,
// this device only. When this app takes over the app.hyper.mobile bundle ID,
// it reads the sessions that app saved.
//
// Results come back as dictionaries rather than thrown errors, so the JS side
// can rebuild the plugin's error codes and OSStatus for the shared diagnostics.
public class HyperKeychainModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HyperKeychain")

    AsyncFunction("getValue") { (key: String) -> [String: Any] in
      guard Self.isValid(key) else { return ["error": "INVALID_KEY"] }
      var query = Self.baseQuery(for: key)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne

      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      if status == errSecItemNotFound { return ["value": NSNull()] }
      guard status == errSecSuccess,
            let data = item as? Data,
            let value = String(data: data, encoding: .utf8)
      else {
        return ["error": "KEYCHAIN_READ_FAILED", "osStatus": Int(status)]
      }
      return ["value": value]
    }

    AsyncFunction("setValue") { (key: String, value: String) -> [String: Any] in
      guard Self.isValid(key) else { return ["error": "INVALID_KEY"] }
      guard let data = value.data(using: .utf8), data.count <= 1_000_000 else {
        return ["error": "INVALID_VALUE"]
      }

      let query = Self.baseQuery(for: key)
      let updateStatus = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      if updateStatus == errSecSuccess { return [:] }
      guard updateStatus == errSecItemNotFound else {
        return ["error": "KEYCHAIN_WRITE_FAILED", "osStatus": Int(updateStatus)]
      }

      var newItem = query
      newItem[kSecValueData as String] = data
      newItem[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let addStatus = SecItemAdd(newItem as CFDictionary, nil)
      guard addStatus == errSecSuccess else {
        return ["error": "KEYCHAIN_WRITE_FAILED", "osStatus": Int(addStatus)]
      }
      return [:]
    }

    AsyncFunction("removeValue") { (key: String) -> [String: Any] in
      guard Self.isValid(key) else { return ["error": "INVALID_KEY"] }
      let status = SecItemDelete(Self.baseQuery(for: key) as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        return ["error": "KEYCHAIN_DELETE_FAILED", "osStatus": Int(status)]
      }
      return [:]
    }
  }

  private static func isValid(_ key: String) -> Bool {
    !key.isEmpty && key.utf8.count <= 512
  }

  private static func baseQuery(for key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "\(Bundle.main.bundleIdentifier ?? "hyPer").auth",
      kSecAttrAccount as String: key,
    ]
  }
}
