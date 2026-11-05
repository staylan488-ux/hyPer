import AppIntents
import SwiftUI
import WidgetKit

/// Snap a meal for Control Center, the lock screen and the Action button: opens
/// the app straight into the camera (SnapMealIntent, compiled into the app and
/// this extension). Its glyph differs from the system Camera control's.
@available(iOS 18.0, *)
struct SnapMealControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "hyper.snap-meal") {
      ControlWidgetButton(action: SnapMealIntent()) {
        Label("Snap a meal", systemImage: "camera.viewfinder")
      }
    }
    .displayName("Snap a meal")
    .description("Opens the camera to log a meal.")
  }
}
