import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The workout card on the lock screen and in the Dynamic Island, in Blanc
// (Blanc.swift): chalk and black ink, following the system appearance, with
// the red italic P. iOS ticks the countdown, the bar and the session clock
// itself from the dates the app sends (WorkoutActivityAttributes). During a
// rest, +30 s and End rest work without unlocking (RestControlIntent).

private enum RestPhase {
  case running(ClosedRange<Date>)
  case paused(seconds: Int)
  /// The rest ran out with the app away: "Rest over" was notified, the card says so too.
  case over
  case none
}

private extension WorkoutActivityAttributes.ContentState {
  func restPhase(isStale: Bool) -> RestPhase {
    if let seconds = restPausedSeconds, seconds > 0 { return .paused(seconds: seconds) }
    guard let start = restStartedAt, let end = restEndsAt, start < end else { return .none }
    return isStale || end <= Date() ? .over : .running(start...end)
  }

  /// Counts up from the session's start; the far end only reserves the digits.
  var sessionRange: ClosedRange<Date> {
    sessionStartedAt...sessionStartedAt.addingTimeInterval(10 * 3600)
  }
}

private func clock(_ seconds: Int) -> String {
  String(format: "%d:%02d", seconds / 60, seconds % 60)
}

private extension RestPhase {
  /// +30 s and End rest show while a rest runs or is paused.
  var hasControls: Bool {
    switch self {
    case .running, .paused: return true
    case .over, .none: return false
    }
  }
}

private func caption(_ phase: RestPhase) -> String {
  switch phase {
  case .running: return "rest"
  case .paused: return "paused"
  case .over: return "rest over"
  case .none: return "in session"
  }
}

/// The rest's +30 s and End rest. Each runs RestControlIntent in the app's
/// process, which moves the countdown and the "Rest over" notification.
@available(iOS 17.0, *)
private struct RestControls: View {
  let tint: Color

  var body: some View {
    HStack(spacing: 8) {
      Button(intent: RestControlIntent(.extend)) {
        Text("+30 s").frame(maxWidth: .infinity, minHeight: 22)
      }
      .accessibilityLabel("Add 30 seconds")
      Button(intent: RestControlIntent(.end)) {
        Text("End rest").frame(maxWidth: .infinity, minHeight: 22)
      }
    }
    .buttonStyle(.bordered)
    .tint(tint)
    .font(.system(size: 13, weight: .semibold))
  }
}

// MARK: - Lock screen

// Tapping the card, or the Dynamic Island, opens Train's workout.

struct WorkoutLockScreenView: View {
  let context: ActivityViewContext<WorkoutActivityAttributes>
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let blanc = Blanc.of(scheme)
    let state = context.state
    let phase = state.restPhase(isStale: context.isStale)

    // The lock screen gives a card at most 160 points; the buttons take the
    // room the padding and spacing give up.
    let controls = phase.hasControls
    VStack(alignment: .leading, spacing: controls ? 10 : 12) {
      HStack(alignment: .center, spacing: 14) {
        Text("P")
          .font(brandMark(size: 30))
          .foregroundStyle(blanc.brand)
          .accessibilityHidden(true)

        VStack(alignment: .leading, spacing: 2) {
          Text(state.exerciseName)
            .font(.headline)
            .foregroundStyle(blanc.ink)
            .lineLimit(1)
          Text(state.detailLine)
            .font(.footnote)
            .foregroundStyle(blanc.graphite)
            .lineLimit(1)
        }

        Spacer(minLength: 8)

        VStack(alignment: .trailing, spacing: 0) {
          lockFigure(phase, state: state, blanc: blanc)
          Text(caption(phase))
            .font(.footnote)
            .foregroundStyle(blanc.graphite)
        }
      }

      if case .running(let range) = phase {
        ProgressView(timerInterval: range, countsDown: true) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
        .progressViewStyle(.linear)
        .tint(blanc.ink)
      }

      if #available(iOS 17.0, *), controls {
        RestControls(tint: blanc.ink)
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, controls ? 14 : 16)
    .activityBackgroundTint(blanc.ground)
    .activitySystemActionForegroundColor(blanc.ink)
    .widgetURL(appURL("train"))
  }

  @ViewBuilder
  private func lockFigure(_ phase: RestPhase, state: WorkoutActivityAttributes.ContentState, blanc: Blanc) -> some View {
    switch phase {
    case .running(let range):
      // A timer takes all the width it is offered; offer what "9:59" or "59:59"
      // needs, so the set line beside it keeps its room.
      let longRest = range.upperBound.timeIntervalSince(range.lowerBound) >= 600
      Text(timerInterval: range, countsDown: true)
        .font(.system(size: 40, weight: .thin))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .foregroundStyle(blanc.ink)
        .frame(maxWidth: longRest ? 112 : 86, alignment: .trailing)
    case .paused(let seconds):
      Text(clock(seconds))
        .font(.system(size: 40, weight: .thin))
        .monospacedDigit()
        .foregroundStyle(blanc.graphite)
    case .over:
      Text("0:00")
        .font(.system(size: 40, weight: .thin))
        .monospacedDigit()
        .foregroundStyle(blanc.ink)
    case .none:
      Text(timerInterval: state.sessionRange, countsDown: false)
        .font(.system(size: 22, weight: .light))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .foregroundStyle(blanc.ink)
        .frame(maxWidth: 90, alignment: .trailing)
    }
  }
}

// MARK: - Dynamic Island (always black)

private struct IslandFigure: View {
  let phase: RestPhase
  let state: WorkoutActivityAttributes.ContentState
  let size: CGFloat
  let maxWidth: CGFloat

  var body: some View {
    switch phase {
    case .running(let range):
      Text(timerInterval: range, countsDown: true)
        .font(.system(size: size, weight: .medium))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .foregroundStyle(.white)
        .frame(maxWidth: maxWidth, alignment: .trailing)
    case .paused(let seconds):
      HStack(spacing: 3) {
        Image(systemName: "pause.fill")
          .font(.system(size: size * 0.6, weight: .bold))
        Text(clock(seconds))
          .font(.system(size: size, weight: .medium))
          .monospacedDigit()
      }
      .foregroundStyle(.white.opacity(0.6))
    case .over:
      Text("0:00")
        .font(.system(size: size, weight: .medium))
        .monospacedDigit()
        .foregroundStyle(.white)
    case .none:
      Text(timerInterval: state.sessionRange, countsDown: false)
        .font(.system(size: size * 0.92, weight: .medium))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .foregroundStyle(.white.opacity(0.75))
        .frame(maxWidth: maxWidth + 10, alignment: .trailing)
    }
  }
}

struct WorkoutLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
      WorkoutLockScreenView(context: context)
    } dynamicIsland: { context in
      let state = context.state
      let phase = state.restPhase(isStale: context.isStale)
      let brand = Blanc.dark.brand

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("P")
            .font(brandMark(size: 28))
            .foregroundStyle(brand)
            .padding(.leading, 6)
            .accessibilityHidden(true)
        }
        DynamicIslandExpandedRegion(.trailing) {
          IslandFigure(phase: phase, state: state, size: 28, maxWidth: 96)
            .padding(.trailing, 6)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
              Text(state.exerciseName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
              Text(state.detailLine)
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.6))
                .lineLimit(1)
            }
            if case .running(let range) = phase {
              ProgressView(timerInterval: range, countsDown: true) {
                EmptyView()
              } currentValueLabel: {
                EmptyView()
              }
              .progressViewStyle(.linear)
              .tint(.white)
            }
            if #available(iOS 17.0, *), phase.hasControls {
              RestControls(tint: .white)
                .padding(.top, 2)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 6)
        }
      } compactLeading: {
        Text("P")
          .font(brandMark(size: 17))
          .foregroundStyle(brand)
          .accessibilityHidden(true)
      } compactTrailing: {
        IslandFigure(phase: phase, state: state, size: 14, maxWidth: 46)
      } minimal: {
        // With music playing, iOS moves this card to the minimal slot; show the
        // countdown there, not the P, so a rest stays readable.
        IslandFigure(phase: phase, state: state, size: 12, maxWidth: 36)
          .minimumScaleFactor(0.5)
      }
      .widgetURL(appURL("train"))
      .keylineTint(brand)
    }
  }
}
