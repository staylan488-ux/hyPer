import Foundation
import UIKit
import Capacitor
import ActivityKit

/// Mirror of the attributes declared in HyperWidgetsLiveActivity.swift.
/// ActivityKit matches the two processes by type name + fields — if one side
/// changes, change the other identically.
@available(iOS 16.2, *)
struct RestTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var startedAt: Date
        var endsAt: Date
        var nextUpLabel: String
    }
}

/// Web-side contract (src/lib/liveActivity.ts):
///   RestActivity.start({ startedAtEpochMs, endsAtEpochMs, nextUpLabel })
///   RestActivity.end()
@objc(RestActivityPlugin)
public class RestActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestActivityPlugin"
    public let jsName = "RestActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }

        let endsAtMs = call.getDouble("endsAtEpochMs") ?? 0
        let startedAtMs = call.getDouble("startedAtEpochMs") ?? Date().timeIntervalSince1970 * 1000
        let label = call.getString("nextUpLabel") ?? "Next set"
        let endsAt = Date(timeIntervalSince1970: endsAtMs / 1000)
        let startedAt = Date(timeIntervalSince1970: startedAtMs / 1000)

        guard endsAt > Date(), ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve()
            return
        }

        Task {
            // One rest at a time: replace any lingering activity.
            for activity in Activity<RestTimerAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }

            let state = RestTimerAttributes.ContentState(startedAt: startedAt, endsAt: endsAt, nextUpLabel: label)
            _ = try? Activity<RestTimerAttributes>.request(
                attributes: RestTimerAttributes(),
                content: .init(state: state, staleDate: endsAt.addingTimeInterval(60))
            )
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }

        Task {
            for activity in Activity<RestTimerAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }
}

/// Storyboard entry point: identical to CAPBridgeViewController except it
/// registers the in-app plugins above. Referenced from Main.storyboard.
class HyperViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RestActivityPlugin())
    }
}
