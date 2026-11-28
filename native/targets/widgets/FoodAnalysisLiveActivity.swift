import ActivityKit
import SwiftUI
import WidgetKit

// The Gemini meal analysis card on the lock screen and in the Dynamic Island,
// in Blanc (Blanc.swift): system lock-screen material with Blanc ink following
// the system appearance, and the red italic P. While analyzing, iOS ticks the
// elapsed clock natively and shows the server's real step; once settled in the
// background, the Dynamic Island expands with the result and settles into a
// crisp checkmark + kcal pill until the person taps back to hyPer.

private enum AnalysisPhase {
  case running
  case stale
  case ready
  case clarify
  case failed
}

private extension FoodAnalysisActivityAttributes.ContentState {
  func resolvedPhase(isStale: Bool) -> AnalysisPhase {
    switch phase {
    case "ready": return .ready
    case "clarify": return .clarify
    case "failed": return .failed
    default: return isStale ? .stale : .running
    }
  }

  /// Counts up from when Analyze was tapped; the far end only reserves the digits.
  var elapsedRange: ClosedRange<Date> {
    startedAt...startedAt.addingTimeInterval(3600)
  }

  var caloriesLabel: String? {
    calories.map { $0.formatted(.number) }
  }

  func displayTitle(for resolved: AnalysisPhase) -> String {
    switch resolved {
    case .stale: return "Open hyPer to check"
    default: return title
    }
  }

  func displayDetail(for resolved: AnalysisPhase) -> String {
    switch resolved {
    case .stale:
      return detail.isEmpty ? "Your estimate may be ready" : detail
    default:
      return detail
    }
  }
}

// MARK: - Lock screen

struct FoodAnalysisLockScreenView: View {
  let context: ActivityViewContext<FoodAnalysisActivityAttributes>
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let blanc = Blanc.of(scheme)
    let state = context.state
    let phase = state.resolvedPhase(isStale: context.isStale)
    let headline = state.displayTitle(for: phase)
    let subtitle = state.displayDetail(for: phase)

    HStack(alignment: .center, spacing: 14) {
      Text("P")
        .font(brandMark(size: 30))
        .foregroundStyle(blanc.brand)
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 2) {
        Text(headline)
          .font(.headline)
          .foregroundStyle(blanc.ink)
          .lineLimit(1)
        if !subtitle.isEmpty {
          Text(subtitle)
            .font(.footnote)
            .foregroundStyle(blanc.graphite)
            .lineLimit(phase == .clarify ? 2 : 1)
        }
      }

      Spacer(minLength: 8)

      lockRight(phase: phase, state: state, blanc: blanc)
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
    // Leave the platter on iOS's default material (FB15148099), matching
    // WorkoutLiveActivity and RunLiveActivity.
    .widgetURL(appURL("log-food"))
  }

  @ViewBuilder
  private func lockRight(phase: AnalysisPhase, state: FoodAnalysisActivityAttributes.ContentState, blanc: Blanc) -> some View {
    switch phase {
    case .running:
      VStack(alignment: .trailing, spacing: 0) {
        Text(timerInterval: state.elapsedRange, countsDown: false)
          .font(.system(size: 30, weight: .thin))
          .monospacedDigit()
          .multilineTextAlignment(.trailing)
          .foregroundStyle(blanc.ink)
          .frame(maxWidth: 88, alignment: .trailing)
        Text("analyzing")
          .font(.footnote)
          .foregroundStyle(blanc.graphite)
      }
    case .stale:
      VStack(alignment: .trailing, spacing: 2) {
        Image(systemName: "arrow.up.right")
          .font(.system(size: 18, weight: .light))
          .foregroundStyle(blanc.graphite)
          .accessibilityHidden(true)
        Text("check")
          .font(.footnote)
          .foregroundStyle(blanc.graphite)
      }
    case .ready:
      VStack(alignment: .trailing, spacing: 0) {
        if let kcal = state.caloriesLabel {
          Text(kcal)
            .font(.system(size: 36, weight: .thin))
            .monospacedDigit()
            .foregroundStyle(blanc.ink)
          Text("kcal")
            .font(.footnote)
            .foregroundStyle(blanc.graphite)
        } else {
          Image(systemName: "checkmark")
            .font(.system(size: 22, weight: .medium))
            .foregroundStyle(blanc.ink)
            .accessibilityHidden(true)
          Text("ready")
            .font(.footnote)
            .foregroundStyle(blanc.graphite)
        }
      }
    case .clarify:
      VStack(alignment: .trailing, spacing: 2) {
        Image(systemName: "questionmark.circle")
          .font(.system(size: 24, weight: .light))
          .foregroundStyle(blanc.ink)
          .accessibilityHidden(true)
        Text("reply")
          .font(.footnote)
          .foregroundStyle(blanc.graphite)
      }
    case .failed:
      VStack(alignment: .trailing, spacing: 2) {
        Image(systemName: "exclamationmark.circle")
          .font(.system(size: 24, weight: .light))
          .foregroundStyle(blanc.live)
          .accessibilityHidden(true)
        Text("retry")
          .font(.footnote)
          .foregroundStyle(blanc.graphite)
      }
    }
  }
}

// MARK: - Dynamic Island (always black)

struct FoodAnalysisLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: FoodAnalysisActivityAttributes.self) { context in
      FoodAnalysisLockScreenView(context: context)
    } dynamicIsland: { context in
      let state = context.state
      let phase = state.resolvedPhase(isStale: context.isStale)
      let brand = Blanc.dark.brand
      let live = Blanc.dark.live
      let headline = state.displayTitle(for: phase)
      let subtitle = state.displayDetail(for: phase)

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("P")
            .font(brandMark(size: 28))
            .foregroundStyle(brand)
            .padding(.leading, 6)
            .accessibilityHidden(true)
        }
        DynamicIslandExpandedRegion(.trailing) {
          expandedTrailing(phase: phase, state: state, live: live)
            .padding(.trailing, 6)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 2) {
            Text(headline)
              .font(.system(size: 15, weight: .semibold))
              .foregroundStyle(.white)
              .lineLimit(1)
            if !subtitle.isEmpty {
              Text(subtitle)
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.65))
                .lineLimit(phase == .clarify ? 2 : 1)
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
        compactTrailing(phase: phase, state: state, live: live)
      } minimal: {
        minimalView(phase: phase, state: state, live: live)
      }
      .widgetURL(appURL("log-food"))
      .keylineTint(brand)
    }
  }

  @ViewBuilder
  private func expandedTrailing(
    phase: AnalysisPhase,
    state: FoodAnalysisActivityAttributes.ContentState,
    live: Color
  ) -> some View {
    switch phase {
    case .running:
      Text(timerInterval: state.elapsedRange, countsDown: false)
        .font(.system(size: 24, weight: .medium))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .foregroundStyle(.white)
        .frame(maxWidth: 88, alignment: .trailing)
    case .stale:
      Text("Check")
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.white.opacity(0.7))
    case .ready:
      if let kcal = state.caloriesLabel {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
          Text(kcal)
            .font(.system(size: 26, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(.white)
          Text("kcal")
            .font(.system(size: 12))
            .foregroundStyle(.white.opacity(0.6))
        }
      } else {
        Image(systemName: "checkmark.circle")
          .font(.system(size: 24, weight: .light))
          .foregroundStyle(.white)
          .accessibilityLabel("Estimate ready")
      }
    case .clarify:
      Image(systemName: "questionmark.circle")
        .font(.system(size: 24, weight: .light))
        .foregroundStyle(.white)
        .accessibilityLabel("One quick detail")
    case .failed:
      Image(systemName: "exclamationmark.circle")
        .font(.system(size: 24, weight: .light))
        .foregroundStyle(live)
        .accessibilityLabel("Analysis didn't finish")
    }
  }

  @ViewBuilder
  private func compactTrailing(
    phase: AnalysisPhase,
    state: FoodAnalysisActivityAttributes.ContentState,
    live: Color
  ) -> some View {
    switch phase {
    case .running:
      Text(timerInterval: state.elapsedRange, countsDown: false)
        .font(.system(size: 14, weight: .medium))
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
        .foregroundStyle(.white)
        .frame(maxWidth: 46, alignment: .trailing)
    case .stale:
      Image(systemName: "arrow.up.right")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.white.opacity(0.7))
        .accessibilityLabel("Check meal analysis")
    case .ready:
      HStack(spacing: 3) {
        Image(systemName: "checkmark")
          .font(.system(size: 10, weight: .bold))
        if let kcal = state.caloriesLabel {
          Text(kcal)
            .font(.system(size: 13, weight: .semibold))
            .monospacedDigit()
            .minimumScaleFactor(0.75)
        }
      }
      .foregroundStyle(.white)
    case .clarify:
      Image(systemName: "questionmark.circle.fill")
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(.white)
        .accessibilityLabel("One quick detail")
    case .failed:
      Image(systemName: "exclamationmark.circle.fill")
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(live)
        .accessibilityLabel("Analysis didn't finish")
    }
  }

  @ViewBuilder
  private func minimalView(
    phase: AnalysisPhase,
    state: FoodAnalysisActivityAttributes.ContentState,
    live: Color
  ) -> some View {
    switch phase {
    case .running:
      Text(timerInterval: state.elapsedRange, countsDown: false)
        .font(.system(size: 12, weight: .medium))
        .monospacedDigit()
        .multilineTextAlignment(.center)
        .foregroundStyle(.white)
        .frame(maxWidth: 36)
        .minimumScaleFactor(0.5)
    case .stale:
      Image(systemName: "arrow.up.right")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.white.opacity(0.7))
        .accessibilityLabel("Check meal analysis")
    case .ready:
      Image(systemName: "checkmark")
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(.white)
        .accessibilityLabel("Estimate ready")
    case .clarify:
      Image(systemName: "questionmark")
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(.white)
        .accessibilityLabel("One quick detail")
    case .failed:
      Image(systemName: "exclamationmark")
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(live)
        .accessibilityLabel("Analysis didn't finish")
    }
  }
}
