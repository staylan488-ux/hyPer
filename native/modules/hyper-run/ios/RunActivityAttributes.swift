import ActivityKit
import Foundation

/// The run's Live Activity, on the lock screen and in the Dynamic Island.
/// This one file is compiled into the HyperRun module (which starts, updates
/// and ends the card), the app itself (for RunControlIntent) and the widget
/// extension (which draws it); plugins/withHyperWidgets.js copies it. ActivityKit
/// matches the copies by type name and fields, so it must stay one definition.
/// The fields match the Capacitor app's card, so nothing changes at cutover.
struct RunActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "free" (a long run) or "intervals" (splits).
    var mode: String
    var distanceM: Double
    /// Active seconds at `updatedAt`; iOS ticks the clock on from there.
    var elapsedS: Int
    var updatedAt: Date
    /// "7:59 /mi" or "—": the current split's average, else the run's.
    var livePace: String
    var averagePace: String
    var isResting: Bool
    /// After a first Finish tap on the card: a second tap before this ends the run.
    var finishArmedUntil: Date?
  }

  var runID: String
}

/// A lock-screen button: split, rest or resume, finish.
enum RunControlAction: String, Codable {
  case split
  case rest
  case finish
}

extension Notification.Name {
  /// Posted in the app's process by RunControlIntent; the recorder stores the
  /// control and hands it to JavaScript at the tap's time.
  static let hyperRunControl = Notification.Name("app.hyper.mobile.run-control")
}
