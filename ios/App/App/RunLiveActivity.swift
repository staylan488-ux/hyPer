import ActivityKit
import AppIntents
import Foundation

@available(iOS 16.2, *)
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

extension Notification.Name {
    static let hyperRunControl = Notification.Name("app.hyper.mobile.run-control")
}

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

        NotificationCenter.default.post(
            name: .hyperRunControl,
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
                await activity.end(
                    .init(state: state, staleDate: now),
                    dismissalPolicy: .immediate
                )
            } else {
                await activity.update(.init(state: state, staleDate: now.addingTimeInterval(30)))
            }
        }
        return .result()
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
        if now.timeIntervalSince(lastUpdateAt) < 3 {
            return
        }
        lastUpdateAt = now

        let state = RunActivityAttributes.ContentState(
            mode: mode,
            distanceM: distanceM,
            elapsedS: elapsedS,
            updatedAt: now,
            livePace: livePace,
            averagePace: averagePace,
            isResting: isResting,
            finishArmedUntil: nil
        )
        let content = ActivityContent(state: state, staleDate: now.addingTimeInterval(30))

        if let current = activities.first, current.attributes.runID == runID {
            await current.update(content)
            for extra in activities.dropFirst() {
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
