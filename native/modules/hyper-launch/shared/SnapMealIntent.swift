import AppIntents
import Foundation

/// Snap a meal: opens the app straight into the camera for Gemini. The Snap a
/// meal control (targets/widgets/SnapMealControl.swift) runs it, as does its
/// App Shortcut. Compiled into the app and the widget extension
/// (plugins/withHyperWidgets.js): the control names it, and iOS performs an
/// intent that opens the app in the app's process. The press waits in
/// HyperLaunchStore for the app's JavaScript.
struct SnapMealIntent: AppIntent {
  static var title: LocalizedStringResource = "Snap a meal"
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    HyperLaunchStore.post(.snapMeal)
    return .result()
  }
}
