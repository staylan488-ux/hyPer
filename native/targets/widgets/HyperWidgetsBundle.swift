import SwiftUI
import WidgetKit

/// hyPer's widget extension (added on prebuild by plugins/withHyperWidgets.js):
/// the workout and run cards on the lock screen and in the Dynamic Island, and
/// the Fuel and Training widgets for the home and lock screens.
@main
struct HyperWidgetsBundle: WidgetBundle {
  var body: some Widget {
    WorkoutLiveActivity()
    RunLiveActivity()
    FuelWidget()
    TrainingWidget()
  }
}
