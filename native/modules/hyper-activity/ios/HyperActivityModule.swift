import ActivityKit
import ExpoModulesCore
import Foundation
import UIKit

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

/// What JavaScript sends (FoodAnalysisActivityPayload in src/lib/foodAnalysisActivitySync.ts).
struct FoodAnalysisActivityPayload: Record {
  @Field var phase: String = "running"
  @Field var title: String = ""
  @Field var detail: String = ""
  @Field var startedAtEpochMs: Double = 0
  @Field var calories: Double?
  @Field var itemCount: Double?
  @Field var alertTitle: String?
  @Field var alertBody: String?

  var contentState: FoodAnalysisActivityAttributes.ContentState {
    let validPhases: Set<String> = ["running", "ready", "clarify", "failed"]
    let normalizedPhase = validPhases.contains(phase) ? phase : "running"
    let startedAt = startedAtEpochMs > 0 ? Date(timeIntervalSince1970: startedAtEpochMs / 1000) : Date()
    let roundedCalories = calories.map { max(0, Int($0.rounded())) }
    let roundedCount = itemCount.map { max(0, Int($0.rounded())) }

    return FoodAnalysisActivityAttributes.ContentState(
      phase: normalizedPhase,
      title: title.isEmpty ? "Analyzing meal" : title,
      detail: detail,
      startedAt: startedAt,
      calories: normalizedPhase == "ready" ? roundedCalories : nil,
      itemCount: normalizedPhase == "ready" ? roundedCount : nil
    )
  }
}

/// One Live Activity per live workout, plus the transient meal-analysis Live
/// Activity and iOS background task guard for Gemini food lookups.
/// Ordering and collapsing of Live Activity calls happen in JavaScript.
///
/// The workout card's +30 s and End rest buttons run RestControlIntent, which
/// logs each tap (RestControlLog); `restControl` tells JavaScript to read them
/// with `pendingRestControls` and confirm them with `markRestControlsApplied`.
public final class HyperActivityModule: Module {
  private var restControlObserver: NSObjectProtocol?
  private let backgroundTasks = BackgroundTaskRegistry()

  public func definition() -> ModuleDefinition {
    Name("HyperActivity")

    Events("restControl", "backgroundTaskExpired")

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
      self?.backgroundTasks.endAll()
    }

    AsyncFunction("sync") { (payload: WorkoutActivityPayload) async in
      await WorkoutActivityController.sync(payload.contentState)
    }

    AsyncFunction("end") { () async in
      await WorkoutActivityController.end()
    }

    AsyncFunction("syncFoodAnalysis") { (payload: FoodAnalysisActivityPayload) async in
      await FoodAnalysisActivityController.sync(
        payload.contentState,
        alertTitle: payload.alertTitle,
        alertBody: payload.alertBody
      )
    }

    AsyncFunction("endFoodAnalysis") { () async in
      await FoodAnalysisActivityController.end()
    }

    // Synchronous so the background grace period is claimed before the first fetch leaves.
    Function("beginBackgroundTask") { [weak self] (name: String) -> String in
      guard let self else { return "" }
      return self.backgroundTasks.begin(name: name) { [weak self] token in
        self?.sendEvent("backgroundTaskExpired", ["token": token])
      }
    }

    Function("endBackgroundTask") { [weak self] (token: String) in
      self?.backgroundTasks.end(token: token)
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

/// Holds active UIBackgroundTaskIdentifiers by opaque token so an in-flight
/// meal analysis keeps running in the background and always releases cleanly on
/// completion or expiration.
private final class BackgroundTaskRegistry {
  private let lock = NSLock()
  private var tasks: [String: UIBackgroundTaskIdentifier] = [:]

  func begin(name: String, onExpire: @escaping (String) -> Void) -> String {
    let token = UUID().uuidString
    let taskName = name.isEmpty ? "FoodAnalysis" : name
    let identifier = UIApplication.shared.beginBackgroundTask(withName: taskName) { [weak self] in
      guard let self, let expired = self.remove(token: token) else { return }
      onExpire(token)
      if expired != .invalid {
        UIApplication.shared.endBackgroundTask(expired)
      }
    }
    guard identifier != .invalid else { return "" }
    lock.lock()
    tasks[token] = identifier
    lock.unlock()
    return token
  }

  func end(token: String) {
    guard !token.isEmpty, let identifier = remove(token: token), identifier != .invalid else { return }
    UIApplication.shared.endBackgroundTask(identifier)
  }

  func endAll() {
    lock.lock()
    let remaining = Array(tasks.values)
    tasks.removeAll()
    lock.unlock()
    for identifier in remaining where identifier != .invalid {
      UIApplication.shared.endBackgroundTask(identifier)
    }
  }

  private func remove(token: String) -> UIBackgroundTaskIdentifier? {
    lock.lock()
    defer { lock.unlock() }
    return tasks.removeValue(forKey: token)
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

enum FoodAnalysisActivityController {
  /// Higher relevance than WorkoutActivityController's default (0.0) so a
  /// transient meal analysis takes the Dynamic Island even mid-workout, then
  /// hands the island straight back once dismissed.
  private static let relevanceScore: Double = 100

  static func sync(
    _ state: FoodAnalysisActivityAttributes.ContentState,
    alertTitle: String?,
    alertBody: String?
  ) async {
    let content = ActivityContent(state: state, staleDate: state.staleDate, relevanceScore: relevanceScore)
    let activities = Activity<FoodAnalysisActivityAttributes>.activities

    if let current = activities.first {
      if state.phase != "running", let title = alertTitle, !title.isEmpty {
        let body = (alertBody?.isEmpty == false ? alertBody : nil) ?? state.detail
        let alert = AlertConfiguration(
          title: LocalizedStringResource(stringLiteral: title),
          body: LocalizedStringResource(stringLiteral: body),
          sound: .default
        )
        await current.update(content, alertConfiguration: alert)
      } else {
        await current.update(content)
      }
      for extra in activities.dropFirst() {
        await extra.end(nil, dismissalPolicy: .immediate)
      }
    } else if state.phase == "running", ActivityAuthorizationInfo().areActivitiesEnabled {
      // Started while the app is in front (as Analyze is tapped); iOS automatically
      // moves it into the Dynamic Island the moment the person switches apps.
      _ = try? Activity<FoodAnalysisActivityAttributes>.request(
        attributes: FoodAnalysisActivityAttributes(),
        content: content
      )
    }
  }

  static func end() async {
    for activity in Activity<FoodAnalysisActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
