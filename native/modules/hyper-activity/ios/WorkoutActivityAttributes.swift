import ActivityKit
import Foundation

/// The workout's Live Activity, on the lock screen and in the Dynamic Island.
/// This one file is compiled into the app (the HyperActivity module) and copied
/// into the widget extension by plugins/withHyperWidgets.js. ActivityKit matches
/// the two by type name and fields, so it must stay a single definition.
struct WorkoutActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// The movement that's up, or the session's name once every set is done.
    var exerciseName: String
    /// "set 3 · 5 of 12 sets · 4,200 lb", from the shared workoutActivityDetailLine.
    var detailLine: String
    var sessionStartedAt: Date
    /// A running rest. iOS ticks its countdown and bar on its own.
    var restStartedAt: Date?
    var restEndsAt: Date?
    /// A paused rest: the seconds left, shown still.
    var restPausedSeconds: Int?
  }
}
