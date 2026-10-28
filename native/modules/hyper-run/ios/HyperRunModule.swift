import ActivityKit
import ExpoModulesCore
import Foundation
import UIKit

// The run recorder, ported from the Capacitor app's HyperRunPlugin.swift with
// the same calls, events, storage and rules, so the shared JavaScript
// (src/lib/nativeRunSource.ts, src/hooks/useRunTracker.ts) runs unchanged:
// - every GPS sample is appended to ApplicationSupport/HyperRunRecorder/<runId>.jsonl
//   and lock-screen controls are kept in UserDefaults, so a run survives the
//   app being suspended or killed;
// - recording keeps going in the background (the location background mode),
//   and never restarts on its own at launch;
// - the run's Live Activity (RunActivityAttributes) is started, updated at most
//   every 3 seconds and ended here; its buttons arrive as RunControlIntent.
// New here: lap and sprint cues played natively (RunCuePlayer), since the
// JavaScript keeps running while the screen is locked.
public final class HyperRunModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HyperRun")

    Events("locationSample", "locationError", "runControl")

    OnCreate {
      let recorder = RunRecorder.shared
      recorder.emit = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
      DispatchQueue.main.async { recorder.load() }
    }

    AsyncFunction("requestPermissions") { (promise: Promise) in
      DispatchQueue.main.async { RunRecorder.shared.requestPermissions(promise) }
    }

    AsyncFunction("startRecording") { (options: [String: Any], promise: Promise) in
      DispatchQueue.main.async { RunRecorder.shared.startRecording(options, promise) }
    }

    AsyncFunction("stopRecording") { (options: [String: Any]?, promise: Promise) in
      DispatchQueue.main.async { RunRecorder.shared.stopRecording(discard: (options?["discard"] as? Bool) ?? false, promise) }
    }

    AsyncFunction("getStatus") { (promise: Promise) in
      DispatchQueue.main.async { promise.resolve(RunRecorder.shared.status) }
    }

    AsyncFunction("drainSamples") { (options: [String: Any], promise: Promise) in
      DispatchQueue.main.async {
        RunRecorder.shared.drainSamples(after: max(0, (options["afterSequence"] as? NSNumber)?.intValue ?? 0), promise)
      }
    }

    AsyncFunction("drainControls") { (options: [String: Any], promise: Promise) in
      DispatchQueue.main.async {
        promise.resolve(RunRecorder.shared.drainControls(after: max(0, (options["afterSequence"] as? NSNumber)?.intValue ?? 0)))
      }
    }

    AsyncFunction("syncLiveActivity") { (options: [String: Any], promise: Promise) in
      guard #available(iOS 16.2, *) else {
        promise.resolve(nil)
        return
      }
      guard
        let runID = options["runId"] as? String,
        RunRecorder.isValidRunID(runID),
        let mode = options["mode"] as? String
      else {
        promise.reject("INVALID_LIVE_ACTIVITY", "Run activity data is invalid.")
        return
      }
      let distanceM = max(0, (options["distanceM"] as? NSNumber)?.doubleValue ?? 0)
      let elapsedS = max(0, (options["elapsedS"] as? NSNumber)?.intValue ?? 0)
      let livePace = options["livePace"] as? String ?? "—"
      let averagePace = options["averagePace"] as? String ?? "—"
      let isResting = options["isResting"] as? Bool ?? false
      Task {
        await RunLiveActivityCoordinator.shared.sync(
          runID: runID,
          mode: mode,
          distanceM: distanceM,
          elapsedS: elapsedS,
          livePace: livePace,
          averagePace: averagePace,
          isResting: isResting
        )
        promise.resolve(nil)
      }
    }

    AsyncFunction("shareDiagnostics") { (options: [String: Any], promise: Promise) in
      guard let content = options["content"] as? String, !content.isEmpty else {
        promise.reject("INVALID_DIAGNOSTICS", "Diagnostics are empty.")
        return
      }
      let requestedName = options["filename"] as? String ?? "hyper-gps-diagnostics.json"
      let filename = requestedName.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "-", options: .regularExpression)
      let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
      do {
        try content.write(to: fileURL, atomically: true, encoding: .utf8)
      } catch {
        promise.reject("EXPORT_FAILED", "Unable to prepare GPS diagnostics.")
        return
      }
      DispatchQueue.main.async { [weak self] in
        guard var presenter = self?.appContext?.utilities?.currentViewController() else {
          try? FileManager.default.removeItem(at: fileURL)
          promise.reject("EXPORT_UNAVAILABLE", "Unable to open the iOS share sheet.")
          return
        }
        // Present from the topmost screen (the run is itself a modal): one
        // already covered by another fails silently.
        while let next = presenter.presentedViewController, !next.isBeingDismissed {
          presenter = next
        }
        let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        activity.completionWithItemsHandler = { _, _, _, _ in
          try? FileManager.default.removeItem(at: fileURL)
          promise.resolve(nil)
        }
        if let popover = activity.popoverPresentationController {
          popover.sourceView = presenter.view
          popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
        }
        presenter.present(activity, animated: true)
      }
    }

    // "lap", "sprintStart" or "sprintEnd": the web app's tones, played over any
    // music, including with the screen locked.
    AsyncFunction("playCue") { (kind: String) in
      DispatchQueue.main.async { RunCuePlayer.shared.play(kind) }
    }
  }
}

@available(iOS 16.2, *)
final class RunLiveActivityCoordinator {
  static let shared = RunLiveActivityCoordinator()

  private var lastUpdateAt = Date.distantPast

  func sync(
    runID: String,
    mode: String,
    distanceM: Double,
    elapsedS: Int,
    livePace: String,
    averagePace: String,
    isResting: Bool
  ) async {
    let now = Date()
    let activities = Activity<RunActivityAttributes>.activities
    // At most every 3 seconds: iOS ticks the clock itself, and a sooner sync
    // could undo a lock-screen Rest the app has not heard yet.
    if now.timeIntervalSince(lastUpdateAt) < 3 {
      return
    }
    lastUpdateAt = now
    let current = activities.first(where: { $0.attributes.runID == runID })

    // Keep a lock-screen "Tap to finish" alive across this sync; only the
    // intent's second tap ends the run.
    var finishArmedUntil: Date?
    if let current, let armedUntil = current.content.state.finishArmedUntil, armedUntil > now {
      finishArmedUntil = armedUntil
    }

    let state = RunActivityAttributes.ContentState(
      mode: mode,
      distanceM: distanceM,
      elapsedS: elapsedS,
      updatedAt: now,
      livePace: livePace,
      averagePace: averagePace,
      isResting: isResting,
      finishArmedUntil: finishArmedUntil
    )
    let content = ActivityContent(state: state, staleDate: now.addingTimeInterval(30))

    if let current {
      await current.update(content)
      for extra in activities where extra.id != current.id {
        await extra.end(nil, dismissalPolicy: .immediate)
      }
    } else {
      for activity in activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      if ActivityAuthorizationInfo().areActivitiesEnabled {
        _ = try? Activity<RunActivityAttributes>.request(
          attributes: RunActivityAttributes(runID: runID),
          content: content
        )
      }
    }
  }

  func end() async {
    for activity in Activity<RunActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
