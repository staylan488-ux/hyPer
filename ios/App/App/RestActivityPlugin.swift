import Foundation
import UIKit
import Capacitor
import ActivityKit

/// Mirror of the attributes declared in HyperWidgetsLiveActivity.swift.
/// ActivityKit matches the two processes by type name + fields — if one side
/// changes, change the other identically.
@available(iOS 16.2, *)
struct WorkoutActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var exerciseName: String
        var detailLine: String
        var sessionStartedAt: Date
        var restStartedAt: Date?
        var restEndsAt: Date?
    }
}

/// One Live Activity per workout session. `sync` upserts the current state
/// (exercise, set/stats line, optional running rest); `end` tears it down.
/// Web-side contract: src/lib/liveActivity.ts.
@objc(RestActivityPlugin)
public class RestActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestActivityPlugin"
    public let jsName = "WorkoutActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    @objc func sync(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }

        let exerciseName = call.getString("exerciseName") ?? "In session"
        let detailLine = call.getString("detailLine") ?? ""
        let sessionStartedAtMs = call.getDouble("sessionStartedAtEpochMs") ?? Date().timeIntervalSince1970 * 1000
        let restStartedAtMs = call.getDouble("restStartedAtEpochMs")
        let restEndsAtMs = call.getDouble("restEndsAtEpochMs")

        let sessionStartedAt = Date(timeIntervalSince1970: sessionStartedAtMs / 1000)
        var restStartedAt: Date? = nil
        var restEndsAt: Date? = nil
        if let startMs = restStartedAtMs, let endMs = restEndsAtMs {
            let end = Date(timeIntervalSince1970: endMs / 1000)
            if end > Date() {
                restStartedAt = Date(timeIntervalSince1970: startMs / 1000)
                restEndsAt = end
            }
        }

        let state = WorkoutActivityAttributes.ContentState(
            exerciseName: exerciseName,
            detailLine: detailLine,
            sessionStartedAt: sessionStartedAt,
            restStartedAt: restStartedAt,
            restEndsAt: restEndsAt
        )
        // Rest ends dim the card quickly if the app never comes back; a
        // working-state card outlives any realistic session before staling.
        let staleDate = restEndsAt?.addingTimeInterval(60) ?? Date().addingTimeInterval(8 * 3600)

        Task {
            let activities = Activity<WorkoutActivityAttributes>.activities
            if let current = activities.first {
                await current.update(.init(state: state, staleDate: staleDate))
                for extra in activities.dropFirst() {
                    await extra.end(nil, dismissalPolicy: .immediate)
                }
            } else if ActivityAuthorizationInfo().areActivitiesEnabled {
                _ = try? Activity<WorkoutActivityAttributes>.request(
                    attributes: WorkoutActivityAttributes(),
                    content: .init(state: state, staleDate: staleDate)
                )
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }

        Task {
            for activity in Activity<WorkoutActivityAttributes>.activities {
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
        // App-local plugins are not in Capacitor's generated package list, so
        // register concrete instances once the bridge exists. Rest-timer
        // notifications are owned by RestActivityPlugin (Live Activities).
        bridge?.registerPluginInstance(RestActivityPlugin())
        bridge?.registerPluginInstance(HyperAuthPlugin())
        bridge?.registerPluginInstance(HyperRunPlugin())
        bridge?.registerPluginInstance(HyperHealthPlugin())
        bridge?.registerPluginInstance(HyperBarcodePlugin())
    }
}
