import SwiftUI
import WidgetKit

/// hyPer's widget extension (added on prebuild by plugins/withHyperWidgets.js).
/// Milestone 8 adds the run card and home-screen widgets here.
@main
struct HyperWidgetsBundle: WidgetBundle {
  var body: some Widget {
    WorkoutLiveActivity()
  }
}
