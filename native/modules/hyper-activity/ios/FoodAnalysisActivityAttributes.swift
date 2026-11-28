import ActivityKit
import Foundation

/// A Gemini meal analysis on the lock screen and in the Dynamic Island.
/// This one file is compiled into the HyperActivity module (which starts,
/// updates and ends the card) and the HyperWidgets extension (which draws it);
/// plugins/withHyperWidgets.js copies it so ActivityKit matches both targets by
/// type name and fields.
struct FoodAnalysisActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "running", "ready", "clarify", or "failed".
    var phase: String
    /// While running: the server's current step ("Searching the web").
    /// Once settled: the outcome heading ("Estimate ready", "One quick detail", ...).
    var title: String
    /// Quiet supporting line: the step's detail, meal label, or macro summary.
    var detail: String
    /// When Analyze was tapped; iOS ticks the elapsed clock natively while running.
    var startedAt: Date
    /// Rounded total calories once an estimate is ready; nil otherwise.
    var calories: Int?
    /// Number of foods identified once ready; nil otherwise.
    var itemCount: Int?
  }
}

extension FoodAnalysisActivityAttributes.ContentState {
  /// Running analyses go stale after two minutes (past the server's 90 s limit)
  /// so a suspended app never leaves a ticking clock stuck forever. Finished
  /// outcomes stay visible for 15 minutes until the person returns to hyPer.
  var staleDate: Date {
    phase == "running"
      ? startedAt.addingTimeInterval(120)
      : Date().addingTimeInterval(15 * 60)
  }
}
