import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

struct RunActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var mode: String
        var distanceM: Double
        var elapsedS: Int
        var updatedAt: Date
        var livePace: String
        var averagePace: String
        var isResting: Bool
        var finishArmedUntil: Date?
    }

    var runID: String
}

enum RunControlAction: String, Codable {
    case split
    case rest
    case finish
}

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

        NotificationCenter.default.post(
            name: Notification.Name("app.hyper.mobile.run-control"),
            object: nil,
            userInfo: ["action": control.rawValue, "timestampMs": now.timeIntervalSince1970 * 1_000]
        )
        for activity in Activity<RunActivityAttributes>.activities {
            var state = activity.content.state
            state.finishArmedUntil = nil
            if control == .rest {
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

private let runPaper = Color(red: 244 / 255, green: 240 / 255, blue: 231 / 255)
private let runInk = Color(red: 26 / 255, green: 22 / 255, blue: 18 / 255)
private let runMuted = Color(red: 90 / 255, green: 82 / 255, blue: 73 / 255)
private let runAccent = Color(red: 168 / 255, green: 53 / 255, blue: 42 / 255)
private let runEmber = Color(red: 204 / 255, green: 82 / 255, blue: 64 / 255)

private extension RunActivityAttributes.ContentState {
    var isSplits: Bool { mode == "intervals" }
    var finishArmed: Bool { (finishArmedUntil ?? .distantPast) > Date() }
    var elapsedRange: ClosedRange<Date> {
        let start = updatedAt.addingTimeInterval(TimeInterval(-elapsedS))
        let end = updatedAt.addingTimeInterval(12 * 3600)
        return start...end
    }
    var distanceLabel: String {
        let miles = distanceM / 1609.344
        return miles < 0.1
            ? "\(Int(distanceM.rounded())) m"
            : String(format: "%.2f mi", miles)
    }
    var elapsedLabel: String {
        let hours = elapsedS / 3600
        let minutes = (elapsedS % 3600) / 60
        let seconds = elapsedS % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
            : String(format: "%d:%02d", minutes, seconds)
    }
}

private struct RunMetric: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 8, weight: .medium))
                .tracking(1.2)
                .foregroundColor(runMuted)
            Text(value)
                .font(.system(size: 16, weight: .regular, design: .serif))
                .monospacedDigit()
                .foregroundColor(runInk)
                .lineLimit(1)
        }
    }
}

private struct RunLockScreenView: View {
    let state: RunActivityAttributes.ContentState

    var body: some View {
        VStack(spacing: 9) {
            HStack {
                Text(state.isResting ? "RESTING" : state.isSplits ? "SPLITS" : "LONG RUN")
                    .font(.system(size: 10, weight: .medium))
                    .tracking(2)
                    .foregroundColor(state.isResting ? runAccent : runMuted)
                Spacer()
                if state.isResting && !state.isSplits {
                    Text(state.elapsedLabel)
                        .font(.system(size: 12, weight: .medium))
                        .monospacedDigit()
                        .foregroundColor(runMuted)
                } else {
                    Text(timerInterval: state.elapsedRange, countsDown: false)
                        .font(.system(size: 12, weight: .medium))
                        .monospacedDigit()
                        .foregroundColor(runMuted)
                        .frame(maxWidth: 72, alignment: .trailing)
                }
            }

            HStack(spacing: 18) {
                RunMetric(label: "DISTANCE", value: state.distanceLabel)
                RunMetric(label: "LIVE PACE", value: state.livePace)
                RunMetric(label: "AVG PACE", value: state.averagePace)
                Spacer(minLength: 0)
            }

            HStack(spacing: 8) {
                if state.isSplits && !state.isResting {
                    Button(intent: RunControlIntent(.split)) {
                        Label("Split", systemImage: "flag.fill")
                    }
                }
                Button(intent: RunControlIntent(.rest)) {
                    Label(state.isResting ? "Resume" : "Rest", systemImage: state.isResting ? "play.fill" : "pause.fill")
                }
                Button(intent: RunControlIntent(.finish)) {
                    Label(state.finishArmed ? "Tap to finish" : "Finish", systemImage: "stop.fill")
                }
                .tint(state.finishArmed ? runAccent : runInk)
            }
            .buttonStyle(.bordered)
            .font(.system(size: 11, weight: .semibold))
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
    }
}

struct RunLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunActivityAttributes.self) { context in
            RunLockScreenView(state: context.state)
                .activityBackgroundTint(runPaper)
                .activitySystemActionForegroundColor(runInk)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading) {
                        Text(context.state.distanceLabel)
                        Text(context.state.isResting ? "REST" : context.state.livePace)
                            .foregroundColor(context.state.isResting ? runEmber : .white.opacity(0.65))
                    }
                    .font(.system(size: 13, weight: .medium))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.isResting && !context.state.isSplits {
                        Text(context.state.elapsedLabel)
                            .monospacedDigit()
                    } else {
                        Text(timerInterval: context.state.elapsedRange, countsDown: false)
                            .monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 8) {
                        if context.state.isSplits && !context.state.isResting {
                            Button(intent: RunControlIntent(.split)) {
                                Label("Split", systemImage: "flag.fill")
                            }
                        }
                        Button(intent: RunControlIntent(.rest)) {
                            Label(context.state.isResting ? "Resume" : "Rest", systemImage: context.state.isResting ? "play.fill" : "pause.fill")
                        }
                        Button(intent: RunControlIntent(.finish)) {
                            Label(context.state.finishArmed ? "Confirm" : "Finish", systemImage: "stop.fill")
                        }
                    }
                    .buttonStyle(.bordered)
                    .font(.system(size: 11, weight: .semibold))
                }
            } compactLeading: {
                Text(context.state.distanceLabel)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(runEmber)
            } compactTrailing: {
                Text(context.state.isResting ? "REST" : context.state.livePace)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(context.state.isResting ? runEmber : .white)
            } minimal: {
                Image(systemName: context.state.isResting ? "pause.fill" : "figure.run")
                    .foregroundColor(runEmber)
            }
            .keylineTint(runEmber)
        }
    }
}
