import Foundation

/// Where the app leaves today's figures for the home-screen widgets, which run
/// with the app closed and cannot reach the account themselves. Compiled into
/// the HyperWidgetData module (which writes) and copied into the widget extension
/// (which reads) by plugins/withHyperWidgets.js.
enum WidgetSnapshotStore {
  /// Shared by the app and the extension; app.json lists it in the app's
  /// entitlements and the plugin in the extension's. It names neither bundle
  /// ID, so it carries over at cutover.
  static let appGroup = "group.app.hyper"
  static let key = "hyper.widgetSnapshot"
  /// The app's URL scheme (app.json "scheme"); widgets and the run card open
  /// screens through it. It becomes the Capacitor app's at cutover.
  static let appScheme = "hyper-native"

  private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  /// The snapshot JSON written by the app (native/src/lib/widgets.ts), or nil.
  static func read() -> Data? {
    defaults?.string(forKey: key)?.data(using: .utf8)
  }

  /// Saves `json`, or removes the snapshot when it is nil (signed out).
  static func write(_ json: String?) {
    guard let defaults else { return }
    if let json {
      defaults.set(json, forKey: key)
    } else {
      defaults.removeObject(forKey: key)
    }
  }
}
