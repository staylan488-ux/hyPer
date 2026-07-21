import ActivityKit
import WidgetKit
import SwiftUI

/// Mirror of the attributes declared in RestActivityPlugin.swift (App target).
/// ActivityKit matches the two processes by type name + fields — if one side
/// changes, change the other identically.
struct WorkoutActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var exerciseName: String
        var detailLine: String
        var sessionStartedAt: Date
        var restStartedAt: Date?
        var restEndsAt: Date?
    }
}

// FOLIO tokens (src/index.css). The lock-screen card is always Paper — a
// printed ticket regardless of wallpaper; the Dynamic Island is always black
// glass, so it uses the Ink theme's ember accent for legibility.
private let paper = Color(red: 244 / 255, green: 240 / 255, blue: 231 / 255)
private let ink = Color(red: 26 / 255, green: 22 / 255, blue: 18 / 255)
private let inkDim = Color(red: 90 / 255, green: 82 / 255, blue: 73 / 255)
private let lacquer = Color(red: 168 / 255, green: 53 / 255, blue: 42 / 255)
private let ember = Color(red: 204 / 255, green: 82 / 255, blue: 64 / 255)

private extension WorkoutActivityAttributes.ContentState {
    var restRange: ClosedRange<Date>? {
        guard let start = restStartedAt, let end = restEndsAt, start < end else { return nil }
        return start...end
    }

    /// Session clock range: the far end only sets the reserved digit width.
    var sessionRange: ClosedRange<Date> {
        sessionStartedAt...sessionStartedAt.addingTimeInterval(10 * 3600)
    }
}

/// The lock-screen ticket. One loud element maximum: the Lacquer countdown,
/// present only while resting. Working state is quiet type on paper.
struct WorkoutLockScreenView: View {
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(state.restRange != nil ? "REST" : "IN SESSION")
                    .font(.system(size: 11, weight: .medium))
                    .tracking(2.4)
                    .foregroundColor(inkDim)
                Spacer()
                Text(timerInterval: state.sessionRange, countsDown: false)
                    .font(.system(size: 11, weight: .medium))
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .foregroundColor(inkDim)
                    .frame(maxWidth: 70, alignment: .trailing)
            }

            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.exerciseName)
                        .font(.system(size: 19, weight: .regular, design: .serif))
                        .foregroundColor(ink)
                        .lineLimit(1)
                    Text(state.detailLine)
                        .font(.system(size: 12))
                        .foregroundColor(inkDim)
                        .lineLimit(1)
                }
                Spacer()
                if let restRange = state.restRange {
                    Text(timerInterval: restRange, countsDown: true)
                        .font(.system(size: 40, weight: .light, design: .serif))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .foregroundColor(lacquer)
                        .frame(maxWidth: 118, alignment: .trailing)
                }
            }

            if let restRange = state.restRange {
                // The app's draining hairline, rendered natively all rest long.
                ProgressView(timerInterval: restRange, countsDown: true) {
                } currentValueLabel: {
                }
                .progressViewStyle(.linear)
                .tint(lacquer)
                .scaleEffect(x: 1, y: 0.5, anchor: .center)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }
}

struct HyperWidgetsLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            WorkoutLockScreenView(state: context.state)
                .activityBackgroundTint(paper)
                .activitySystemActionForegroundColor(ink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("P")
                        .font(.system(size: 24, weight: .regular, design: .serif))
                        .italic()
                        .foregroundColor(ember)
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let restRange = context.state.restRange {
                        Text(timerInterval: restRange, countsDown: true)
                            .font(.system(size: 28, weight: .light, design: .serif))
                            .monospacedDigit()
                            .multilineTextAlignment(.trailing)
                            .foregroundColor(ember)
                            .frame(maxWidth: 90, alignment: .trailing)
                            .padding(.trailing, 6)
                    } else {
                        Text(timerInterval: context.state.sessionRange, countsDown: false)
                            .font(.system(size: 22, weight: .light))
                            .monospacedDigit()
                            .multilineTextAlignment(.trailing)
                            .foregroundColor(.white.opacity(0.75))
                            .frame(maxWidth: 90, alignment: .trailing)
                            .padding(.trailing, 6)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.exerciseName)
                            .font(.system(size: 15, design: .serif))
                            .foregroundColor(.white)
                            .lineLimit(1)
                        Text(context.state.detailLine)
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.6))
                            .lineLimit(1)
                    }
                }
            } compactLeading: {
                Text("P")
                    .font(.system(size: 16, design: .serif))
                    .italic()
                    .foregroundColor(ember)
            } compactTrailing: {
                if let restRange = context.state.restRange {
                    Text(timerInterval: restRange, countsDown: true)
                        .font(.system(size: 14, weight: .medium))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .foregroundColor(ember)
                        .frame(maxWidth: 46, alignment: .trailing)
                } else {
                    Text(timerInterval: context.state.sessionRange, countsDown: false)
                        .font(.system(size: 13, weight: .medium))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .foregroundColor(.white.opacity(0.75))
                        .frame(maxWidth: 56, alignment: .trailing)
                }
            } minimal: {
                Text("P")
                    .font(.system(size: 15, design: .serif))
                    .italic()
                    .foregroundColor(ember)
            }
            .keylineTint(ember)
        }
    }
}
