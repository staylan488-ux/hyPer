import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The run card on the lock screen and in the Dynamic Island, in Blanc
// (Blanc.swift). The app sends distance, paces and the active seconds
// (RunActivityAttributes); iOS ticks the clock on from there. Split, Rest and
// Finish run RunControlIntent in the app's process, which records the tap at
// its time; Finish asks for a second tap. Tapping the card opens the run.

private extension RunActivityAttributes.ContentState {
  var isSplits: Bool { mode == "intervals" }
  var finishArmed: Bool { (finishArmedUntil ?? .distantPast) > Date() }
  /// A long run's rest is a pause: its clock stands still.
  var clockStopped: Bool { isResting && !isSplits }

  var elapsedRange: ClosedRange<Date> {
    let start = updatedAt.addingTimeInterval(TimeInterval(-elapsedS))
    return start...updatedAt.addingTimeInterval(12 * 3600)
  }

  var distanceLabel: String {
    let miles = distanceM / 1609.344
    return miles < 1 ? "\(Int(distanceM.rounded())) m" : String(format: "%.2f mi", miles)
  }

  var elapsedLabel: String {
    let hours = elapsedS / 3600
    let minutes = (elapsedS % 3600) / 60
    let seconds = elapsedS % 60
    return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, seconds) : String(format: "%d:%02d", minutes, seconds)
  }

  /// "7:52 /mi · avg 8:01", leaving out what is not known yet.
  var paceLine: String {
    if isResting { return isSplits ? "Rest lap" : "Paused" }
    let live = livePace == "—" ? nil : livePace
    let average = averagePace == "—" ? nil : "avg \(averagePace.replacingOccurrences(of: " /mi", with: ""))"
    return [live, average].compactMap { $0 }.joined(separator: " · ").ifEmpty("Finding GPS")
  }
}

private extension String {
  func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}

/// The run clock: ticking, or standing still while paused or once the app stops updating.
private struct RunClock: View {
  let state: RunActivityAttributes.ContentState
  let isStale: Bool

  var body: some View {
    if state.clockStopped || isStale {
      Text(state.elapsedLabel)
    } else {
      Text(timerInterval: state.elapsedRange, countsDown: false)
    }
  }
}

@available(iOS 17.0, *)
private struct RunControls: View {
  let state: RunActivityAttributes.ContentState
  let tint: Color
  let finishTint: Color

  var body: some View {
    HStack(spacing: 8) {
      if state.isSplits && !state.isResting {
        Button(intent: RunControlIntent(.split)) {
          Label("Split", systemImage: "flag.fill").frame(maxWidth: .infinity)
        }
      }
      Button(intent: RunControlIntent(.rest)) {
        Label(state.isResting ? "Resume" : "Rest", systemImage: state.isResting ? "play.fill" : "pause.fill")
          .frame(maxWidth: .infinity)
      }
      Button(intent: RunControlIntent(.finish)) {
        Label(state.finishArmed ? "Tap again" : "Finish", systemImage: "stop.fill").frame(maxWidth: .infinity)
      }
      .tint(state.finishArmed ? finishTint : tint)
    }
    .buttonStyle(.bordered)
    .tint(tint)
    .font(.system(size: 13, weight: .semibold))
    .labelStyle(.titleOnly)
  }
}

// MARK: - Lock screen

struct RunLockScreenView: View {
  let context: ActivityViewContext<RunActivityAttributes>
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let blanc = Blanc.of(scheme)
    let state = context.state

    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .center, spacing: 14) {
        Text("P")
          .font(brandMark(size: 30))
          .foregroundStyle(blanc.brand)
          .accessibilityHidden(true)

        VStack(alignment: .leading, spacing: 2) {
          Text(state.distanceLabel)
            .font(.headline)
            .monospacedDigit()
            .foregroundStyle(blanc.ink)
          Text(context.isStale ? "Open hyPer to keep tracking" : state.paceLine)
            .font(.footnote)
            .monospacedDigit()
            .foregroundStyle(blanc.graphite)
            .lineLimit(1)
        }

        Spacer(minLength: 8)

        VStack(alignment: .trailing, spacing: 0) {
          RunClock(state: state, isStale: context.isStale)
            .font(.system(size: 34, weight: .thin))
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .foregroundStyle(state.clockStopped ? blanc.graphite : blanc.ink)
            .frame(maxWidth: 120, alignment: .trailing)
          Text(state.isResting ? "resting" : state.isSplits ? "splits" : "long run")
            .font(.footnote)
            .foregroundStyle(state.isResting ? blanc.live : blanc.graphite)
        }
      }

      if #available(iOS 17.0, *), !context.isStale {
        RunControls(state: state, tint: blanc.ink, finishTint: blanc.live)
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
    .activityBackgroundTint(blanc.ground)
    .activitySystemActionForegroundColor(blanc.ink)
    .widgetURL(appURL("run"))
  }
}

// MARK: - Dynamic Island (always black)

struct RunLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RunActivityAttributes.self) { context in
      RunLockScreenView(context: context)
    } dynamicIsland: { context in
      let state = context.state
      let brand = Blanc.dark.brand
      let live = Blanc.dark.live

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("P")
            .font(brandMark(size: 28))
            .foregroundStyle(brand)
            .padding(.leading, 6)
            .accessibilityHidden(true)
        }
        DynamicIslandExpandedRegion(.trailing) {
          RunClock(state: state, isStale: context.isStale)
            .font(.system(size: 28, weight: .medium))
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .foregroundStyle(state.clockStopped ? .white.opacity(0.6) : .white)
            .frame(maxWidth: 110, alignment: .trailing)
            .padding(.trailing, 6)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
              Text(state.distanceLabel)
                .font(.system(size: 15, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.white)
              Text(context.isStale ? "Open hyPer to keep tracking" : state.paceLine)
                .font(.system(size: 12))
                .monospacedDigit()
                .foregroundStyle(state.isResting ? live : .white.opacity(0.6))
                .lineLimit(1)
            }
            if #available(iOS 17.0, *), !context.isStale {
              RunControls(state: state, tint: .white, finishTint: live)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 6)
        }
      } compactLeading: {
        Text(state.distanceLabel)
          .font(.system(size: 13, weight: .medium))
          .monospacedDigit()
          .foregroundStyle(state.isResting ? live : .white)
          .minimumScaleFactor(0.7)
      } compactTrailing: {
        // The clock, not pace: it is the one number a runner wants at a glance.
        RunClock(state: state, isStale: context.isStale)
          .font(.system(size: 13, weight: .medium))
          .monospacedDigit()
          .multilineTextAlignment(.trailing)
          .minimumScaleFactor(0.6)
          .frame(maxWidth: 56, alignment: .trailing)
          .foregroundStyle(state.clockStopped ? .white.opacity(0.6) : .white)
      } minimal: {
        // With music playing, iOS moves the card to the minimal slot; keep the
        // clock there so it never vanishes mid-run.
        RunClock(state: state, isStale: context.isStale)
          .font(.system(size: 11, weight: .semibold))
          .monospacedDigit()
          .minimumScaleFactor(0.4)
          .foregroundStyle(state.isResting ? live : .white)
      }
      .widgetURL(appURL("run"))
      .keylineTint(brand)
    }
  }
}
