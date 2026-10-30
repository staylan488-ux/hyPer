import ActivityKit
import Foundation

/// The workout's Live Activity, on the lock screen and in the Dynamic Island.
/// This one file is compiled into the HyperActivity module (which starts,
/// updates and ends the card), the app itself (for RestControlIntent) and the
/// widget extension (which draws it); plugins/withHyperWidgets.js copies it.
/// ActivityKit matches the copies by type name and fields, so it must stay a
/// single definition.
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

extension WorkoutActivityAttributes.ContentState {
  /// A running rest goes stale when it ends, so the card turns to "rest over"
  /// even if the app never comes back. A working card outlives any realistic
  /// session before staling.
  var staleDate: Date {
    restEndsAt ?? Date().addingTimeInterval(8 * 3600)
  }
}

/// The card's rest buttons (RestControlIntent): +30 s and End rest.
enum RestControlAction: String, Codable {
  case extend
  case end

  /// What +30 s adds, as the rest sheet's button does.
  static let extendSeconds = 30
}

/// Taps on the card's rest buttons, kept until the app's JavaScript has applied
/// them to its stored rest (native/src/lib/restControls.ts). The intent changes
/// the card and the "Rest over" notification itself, so they follow the tap even
/// while the app sleeps; this log lets the app catch up whenever it next runs.
/// Only the intent appends (on the main actor) and only JavaScript marks entries
/// applied, so neither overwrites the other's key.
enum RestControlLog {
  struct Entry: Codable {
    let sequence: Int
    let action: String
    let timestampMs: Double
  }

  private static let entriesKey = "hyper.restControls.entries"
  private static let sequenceKey = "hyper.restControls.sequence"
  private static let appliedKey = "hyper.restControls.applied"

  /// Taps not yet applied, oldest first.
  static var pending: [Entry] {
    let defaults = UserDefaults.standard
    let applied = defaults.integer(forKey: appliedKey)
    guard
      let data = defaults.data(forKey: entriesKey),
      let entries = try? JSONDecoder().decode([Entry].self, from: data)
    else { return [] }
    return entries.filter { $0.sequence > applied }
  }

  static func append(_ action: RestControlAction, at date: Date) {
    let defaults = UserDefaults.standard
    let sequence = defaults.integer(forKey: sequenceKey) + 1
    let entry = Entry(sequence: sequence, action: action.rawValue, timestampMs: date.timeIntervalSince1970 * 1_000)
    guard let data = try? JSONEncoder().encode(Array((pending + [entry]).suffix(50))) else { return }
    defaults.set(sequence, forKey: sequenceKey)
    defaults.set(data, forKey: entriesKey)
  }

  static func markApplied(through sequence: Int) {
    let defaults = UserDefaults.standard
    if sequence > defaults.integer(forKey: appliedKey) {
      defaults.set(sequence, forKey: appliedKey)
    }
  }
}

extension Notification.Name {
  /// Posted in the app's process by RestControlIntent once a tap is logged;
  /// the HyperActivity module tells JavaScript to apply it.
  static let hyperRestControl = Notification.Name("app.hyper.mobile.rest-control")
}
