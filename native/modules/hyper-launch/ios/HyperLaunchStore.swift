import Foundation

/// What a press outside the app asks it to open: the Snap a meal control, an
/// App Shortcut (Shortcuts, Spotlight, Siri, the Action button) or a Home
/// Screen quick action. Raw values are the app's (native/src/lib/launchActions.ts).
enum HyperLaunchAction: String {
  case snapMeal = "snap-meal"
  case logFood = "log-food"
  case train

  /// A quick action's type (app.json UIApplicationShortcutItems): "hyper.<action>".
  init?(shortcutType: String) {
    let prefix = "hyper."
    guard shortcutType.hasPrefix(prefix) else { return nil }
    self.init(rawValue: String(shortcutType.dropFirst(prefix.count)))
  }
}

/// The press, kept until the app's JavaScript takes it (native/src/lib/launch.ts):
/// at launch, on the HyperLaunch module's event, and on each return to the front.
/// One file compiled into the HyperLaunch module (which reads it and hears the
/// quick actions), the app (the intents) and the widget extension (the control's
/// intent); plugins/withHyperWidgets.js copies it. It lives in the App Group, so
/// the press is kept wherever iOS performs the intent.
enum HyperLaunchStore {
  private static let appGroup = "group.app.hyper"

  /// One key per app: the test app and the released app share the App Group.
  /// In the widget extension, the key is for the app it ships in (App.app/PlugIns/X.appex).
  private static let key: String = {
    var bundle = Bundle.main
    if bundle.bundleURL.pathExtension == "appex",
       let app = Bundle(url: bundle.bundleURL.deletingLastPathComponent().deletingLastPathComponent()) {
      bundle = app
    }
    return "hyper.launchAction.\(bundle.bundleIdentifier ?? "")"
  }()

  /// Keeps the press (a newer one replaces it) and tells the app, if it is running.
  static func post(_ action: HyperLaunchAction) {
    let press: [String: Any] = ["action": action.rawValue, "atMs": Date().timeIntervalSince1970 * 1_000]
    UserDefaults(suiteName: appGroup)?.set(press, forKey: key)
    DispatchQueue.main.async {
      NotificationCenter.default.post(name: .hyperLaunchAction, object: nil)
    }
  }

  /// The press not yet taken, removed as it is read; empty when there is none.
  static func take() -> [String: Any] {
    guard let defaults = UserDefaults(suiteName: appGroup), let press = defaults.dictionary(forKey: key) else { return [:] }
    defaults.removeObject(forKey: key)
    return press
  }
}

extension Notification.Name {
  /// Posted on the main thread once a press is kept; the HyperLaunch module tells JavaScript.
  static let hyperLaunchAction = Notification.Name("app.hyper.launch-action")
}
