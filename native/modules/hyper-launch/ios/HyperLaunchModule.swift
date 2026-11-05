import ExpoModulesCore
import Foundation

/// Hands presses from outside the app to JavaScript: `launchAction` says one
/// arrived while the app runs; `takePendingAction` reads it and removes it.
public final class HyperLaunchModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HyperLaunch")

    Events("launchAction")

    OnCreate { [weak self] in
      self?.observer = NotificationCenter.default.addObserver(
        forName: .hyperLaunchAction,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("launchAction", [:])
      }
    }

    OnDestroy { [weak self] in
      if let observer = self?.observer {
        NotificationCenter.default.removeObserver(observer)
      }
    }

    // Synchronous, so the root layout knows before its first frame whether to leave the intro out.
    Function("takePendingAction") { () -> [String: Any] in
      HyperLaunchStore.take()
    }
  }
}
