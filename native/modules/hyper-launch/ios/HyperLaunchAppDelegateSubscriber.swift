import ExpoModulesCore
import UIKit

/// The Home Screen quick actions (app.json UIApplicationShortcutItems). Under
/// the scene life cycle, ExpoAppSceneDelegate hands over the item that launched
/// the app (connectionOptions.shortcutItem) and any chosen while it runs.
public class HyperLaunchAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let action = HyperLaunchAction(shortcutType: shortcutItem.type) else {
      completionHandler(false)
      return
    }
    HyperLaunchStore.post(action)
    completionHandler(true)
  }
}
