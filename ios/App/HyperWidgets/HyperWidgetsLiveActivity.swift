import ActivityKit
import WidgetKit
import SwiftUI

/// Mirror of the attributes declared in RestActivityPlugin.swift (App target).
/// ActivityKit matches the two processes by type name + fields — if one side
/// changes, change the other identically.
struct RestTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var startedAt: Date
        var endsAt: Date
        var nextUpLabel: String
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

private func countdown(_ state: RestTimerAttributes.ContentState) -> Text {
    Text(timerInterval: state.startedAt...state.endsAt, countsDown: true)
}

struct RestLockScreenView: View {
    let state: RestTimerAttributes.ContentState

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 6) {
                Text("REST")
                    .font(.system(size: 11, weight: .medium))
                    .tracking(2.4)
                    .foregroundColor(inkDim)
                Rectangle()
                    .fill(lacquer)
                    .frame(width: 40, height: 1)
                Text(state.nextUpLabel)
                    .font(.system(size: 14))
                    .foregroundColor(ink)
                    .lineLimit(1)
            }
            Spacer()
            countdown(state)
                .font(.system(size: 44, weight: .light, design: .serif))
                .monospacedDigit()
                .foregroundColor(lacquer)
                .frame(maxWidth: 130, alignment: .trailing)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }
}

struct HyperWidgetsLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            RestLockScreenView(state: context.state)
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
                    countdown(context.state)
                        .font(.system(size: 28, weight: .light, design: .serif))
                        .monospacedDigit()
                        .foregroundColor(.white)
                        .frame(maxWidth: 90, alignment: .trailing)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.nextUpLabel)
                        .font(.system(size: 13))
                        .foregroundColor(.white.opacity(0.7))
                        .lineLimit(1)
                }
            } compactLeading: {
                Text("P")
                    .font(.system(size: 16, design: .serif))
                    .italic()
                    .foregroundColor(ember)
            } compactTrailing: {
                countdown(context.state)
                    .font(.system(size: 14, weight: .medium))
                    .monospacedDigit()
                    .foregroundColor(.white)
                    .frame(maxWidth: 46, alignment: .trailing)
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
