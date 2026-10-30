import ActivityKit
import ExpoModulesCore
import Foundation

/// What JavaScript sends (WorkoutActivityPayload in src/lib/workoutActivitySync.ts).
struct WorkoutActivityPayload: Record {
  @Field var exerciseName: String = ""
  @Field var detailLine: String = ""
  @Field var sessionStartedAtEpochMs: Double = 0
  @Field var restStartedAtEpochMs: Double?
  @Field var restEndsAtEpochMs: Double?
  @Field var restPausedSeconds: Double?

  var contentState: WorkoutActivityAttributes.ContentState {
    func date(_ epochMs: Double) -> Date { Date(timeIntervalSince1970: epochMs / 1000) }

    var restStartedAt: Date?
    var restEndsAt: Date?
    if let start = restStartedAtEpochMs, let end = restEndsAtEpochMs, date(end) > Date(), start < end {
      restStartedAt = date(start)
      restEndsAt = date(end)
    }
    let paused = restPausedSeconds.map { Int($0.rounded()) }.flatMap { $0 > 0 ? $0 : nil }

    return WorkoutActivityAttributes.ContentState(
      exerciseName: exerciseName.isEmpty ? "In session" : exerciseName,
      detailLine: detailLine,
      sessionStartedAt: sessionStartedAtEpochMs > 0 ? date(sessionStartedAtEpochMs) : Date(),
      restStartedAt: restStartedAt,
      restEndsAt: restEndsAt,
      restPausedSeconds: restEndsAt == nil ? paused : nil
    )
  }
}

/// One Live Activity per live workout. `sync` shows or updates it with the
/// current state (movement, set line, any rest); `end` takes it down.
/// Ordering and collapsing of calls happen in JavaScript.
///
/// The card's +30 s and End rest buttons run RestControlIntent, which logs each
/// tap (RestControlLog); `restControl` tells JavaScript to read them with
/// `pendingRestControls` and confirm them with `markRestControlsApplied`.
public final class HyperActivityModule: Module {
  private var restControlObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HyperActivity")

    Events("restControl")

    OnCreate { [weak self] in
      self?.restControlObserver = NotificationCenter.default.addObserver(
        forName: .hyperRestControl,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("restControl", [:])
      }
    }

    OnDestroy { [weak self] in
      if let observer = self?.restControlObserver {
        NotificationCenter.default.removeObserver(observer)
      }
    }

    AsyncFunction("sync") { (payload: WorkoutActivityPayload) async in
      await WorkoutActivityController.sync(payload.contentState)
    }

    AsyncFunction("end") { () async in
      await WorkoutActivityController.end()
    }

    // Synchronous, so the app can apply taps before it restores a stored rest.
    Function("pendingRestControls") { () -> [[String: Any]] in
      RestControlLog.pending.map { entry -> [String: Any] in
        ["sequence": entry.sequence, "action": entry.action, "timestampMs": entry.timestampMs]
      }
    }

    Function("markRestControlsApplied") { (sequence: Int) in
      RestControlLog.markApplied(through: sequence)
    }
  }
}

enum WorkoutActivityController {
  static func sync(_ state: WorkoutActivityAttributes.ContentState) async {
    let content = ActivityContent(state: state, staleDate: state.staleDate)
    let activities = Activity<WorkoutActivityAttributes>.activities

    if let current = activities.first {
      await current.update(content)
      for extra in activities.dropFirst() {
        await extra.end(nil, dismissalPolicy: .immediate)
      }
    } else if ActivityAuthorizationInfo().areActivitiesEnabled {
      // iOS starts activities only while the app is in front, which is when a
      // workout starts or the app opens on one.
      _ = try? Activity<WorkoutActivityAttributes>.request(
        attributes: WorkoutActivityAttributes(),
        content: content
      )
    }
  }

  static func end() async {
    for activity in Activity<WorkoutActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
