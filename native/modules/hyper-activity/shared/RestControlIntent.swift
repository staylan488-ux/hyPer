import ActivityKit
import AppIntents
import Foundation
import UserNotifications

/// The workout card's +30 s and End rest buttons, which work without unlocking.
/// Compiled into the app and the widget extension (plugins/withHyperWidgets.js
/// adds it to both): the extension's buttons name it, and iOS runs a Live
/// Activity intent in the app's process, even when the app is not running.
///
/// A tap changes the card and the "Rest over" notification here, so both follow
/// it while the app sleeps, then logs it (RestControlLog) for the app's
/// JavaScript to apply to its stored rest by the same rule
/// (native/src/lib/restControls.ts): +30 s moves a running rest's end, or adds
/// to a paused one; End rest clears it; a rest already over is left alone.
@available(iOS 17.0, *)
struct RestControlIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Control rest"

  @Parameter(title: "Action")
  var action: String

  init() {
    action = RestControlAction.extend.rawValue
  }

  init(_ action: RestControlAction) {
    self.action = action.rawValue
  }

  func perform() async throws -> some IntentResult {
    guard let control = RestControlAction(rawValue: action) else {
      return .result()
    }
    let now = Date()
    // One tap at a time, so a quick double +30 s adds a full minute.
    await RestControlQueue.run {
      await apply(control, at: now)
    }
    return .result()
  }
}

@available(iOS 17.0, *)
@MainActor
private func apply(_ control: RestControlAction, at now: Date) async {
  RestControlLog.append(control, at: now)

  var restEndsAt: Date?
  for activity in Activity<WorkoutActivityAttributes>.activities {
    // A rest that is over already stays as it is; updating still redraws a card
    // iOS has not yet turned to "rest over".
    let state = activity.content.state.applying(control, at: now) ?? activity.content.state
    restEndsAt = state.restEndsAt
    await activity.update(ActivityContent(state: state, staleDate: state.staleDate))
  }
  await RestOverNotification.follow(restEndsAt, now: now)

  NotificationCenter.default.post(name: .hyperRestControl, object: nil)
}

private extension WorkoutActivityAttributes.ContentState {
  /// The card after a tap, or nil when the tap changes nothing.
  func applying(_ control: RestControlAction, at now: Date) -> Self? {
    let paused = (restPausedSeconds ?? 0) > 0
    let running = !paused && (restEndsAt.map { $0 > now } ?? false)
    guard paused || running else { return nil }

    var next = self
    switch control {
    case .extend:
      if paused {
        next.restPausedSeconds = (restPausedSeconds ?? 0) + RestControlAction.extendSeconds
      } else if let end = restEndsAt {
        // The start stays, so the bar reads against the whole, longer rest.
        next.restEndsAt = end.addingTimeInterval(TimeInterval(RestControlAction.extendSeconds))
      }
    case .end:
      next.restStartedAt = nil
      next.restEndsAt = nil
      next.restPausedSeconds = nil
    }
    return next
  }
}

/// The app's "Rest over" notification (native/src/platform/restNotifications.ts,
/// scheduled by expo-notifications under this identifier), moved to the rest's
/// new end or taken away.
private enum RestOverNotification {
  static let identifier = "hyper-rest-over"

  static func follow(_ restEndsAt: Date?, now: Date) async {
    let center = UNUserNotificationCenter.current()
    guard let end = restEndsAt, end > now else {
      // Ended or paused: nothing to say. One already delivered stays.
      center.removePendingNotificationRequests(withIdentifiers: [identifier])
      return
    }
    // Reuse the pending one's words ("Rest over", the set that's up). None
    // pending means notifications are off.
    let pending = await center.pendingNotificationRequests()
    guard let request = pending.first(where: { $0.identifier == identifier }) else { return }
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: end.timeIntervalSince(now), repeats: false)
    try? await center.add(UNNotificationRequest(identifier: identifier, content: request.content, trigger: trigger))
  }
}

/// Runs taps one after another on the main actor.
@MainActor
private enum RestControlQueue {
  private static var tail: Task<Void, Never>?

  static func run(_ work: @escaping @MainActor () async -> Void) async {
    let previous = tail
    let task = Task { @MainActor in
      await previous?.value
      await work()
    }
    tail = task
    await task.value
  }
}
