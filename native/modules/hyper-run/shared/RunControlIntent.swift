import ActivityKit
import AppIntents
import Foundation

/// The run card's Split, Rest/Resume and Finish buttons. Compiled into the app
/// and the widget extension (plugins/withHyperWidgets.js adds it to both): the
/// extension's buttons name it, and iOS runs a Live Activity intent in the
/// app's process, where the recorder hears the control (RunActivityAttributes.swift).
/// Finish asks for a second tap within 8 seconds, so a pocket press cannot end a run.
@available(iOS 17.0, *)
struct RunControlIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Control run"

  @Parameter(title: "Action")
  var action: String

  init() {
    action = RunControlAction.rest.rawValue
  }

  init(_ action: RunControlAction) {
    self.action = action.rawValue
  }

  func perform() async throws -> some IntentResult {
    guard let control = RunControlAction(rawValue: action) else {
      return .result()
    }

    let now = Date()
    if control == .finish {
      let armed = Activity<RunActivityAttributes>.activities.contains {
        ($0.content.state.finishArmedUntil ?? .distantPast) > now
      }
      if !armed {
        for activity in Activity<RunActivityAttributes>.activities {
          var state = activity.content.state
          state.finishArmedUntil = now.addingTimeInterval(8)
          await activity.update(.init(state: state, staleDate: now.addingTimeInterval(30)))
        }
        return .result()
      }
    }

    // perform() runs off the main actor. Deliver on main so the recorder's
    // observer runs in order with its location updates, and before this intent
    // updates or ends the card.
    let userInfo: [String: Any] = ["action": control.rawValue, "timestampMs": now.timeIntervalSince1970 * 1_000]
    await MainActor.run {
      NotificationCenter.default.post(name: .hyperRunControl, object: nil, userInfo: userInfo)
    }

    for activity in Activity<RunActivityAttributes>.activities {
      var state = activity.content.state
      state.finishArmedUntil = nil
      if control == .rest {
        // Carry the clock forward to the tap before toggling, so the card's
        // clock stops at (or keeps counting from) the true elapsed time rather
        // than the last sync's. In a long run, resting is a pause, so a stopped
        // clock adds nothing.
        let clockRunning = !(state.isResting && state.mode != "intervals")
        if clockRunning {
          state.elapsedS += max(0, Int(now.timeIntervalSince(state.updatedAt).rounded(.down)))
        }
        state.isResting.toggle()
        state.updatedAt = now
      }
      if control == .finish {
        await activity.end(.init(state: state, staleDate: now), dismissalPolicy: .immediate)
      } else {
        await activity.update(.init(state: state, staleDate: now.addingTimeInterval(30)))
      }
    }
    return .result()
  }
}
