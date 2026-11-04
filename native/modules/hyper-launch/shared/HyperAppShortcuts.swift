import AppIntents
import Foundation

/// Opens Log food on Recent.
struct LogFoodIntent: AppIntent {
  static var title: LocalizedStringResource = "Log food"
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    HyperLaunchStore.post(.logFood)
    return .result()
  }
}

/// Opens Train: the live workout, or today's session to start. Never starts one itself.
struct OpenTrainIntent: AppIntent {
  static var title: LocalizedStringResource = "Open Train"
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    HyperLaunchStore.post(.train)
    return .result()
  }
}

/// Shortcuts, Spotlight, Siri and the Action button's Shortcut list. App only:
/// iOS reads App Shortcuts from the app. Every phrase names the app once.
@available(iOS 17.0, *)
struct HyperAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SnapMealIntent(),
      phrases: [
        "Snap a meal in \(.applicationName)",
        "Snap a meal with \(.applicationName)",
        "Take a meal photo in \(.applicationName)",
      ],
      shortTitle: "Snap a meal",
      systemImageName: "camera.viewfinder"
    )
    AppShortcut(
      intent: LogFoodIntent(),
      phrases: [
        "Log food in \(.applicationName)",
        "Log food with \(.applicationName)",
        "Add food in \(.applicationName)",
      ],
      shortTitle: "Log food",
      systemImageName: "fork.knife"
    )
    AppShortcut(
      intent: OpenTrainIntent(),
      phrases: [
        "Open Train in \(.applicationName)",
        "Show Train in \(.applicationName)",
      ],
      shortTitle: "Train",
      systemImageName: "dumbbell"
    )
  }
}
