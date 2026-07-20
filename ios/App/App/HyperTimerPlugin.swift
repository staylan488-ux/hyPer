import Capacitor
import Foundation
import UserNotifications

@objc(HyperTimerPlugin)
final class HyperTimerPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HyperTimerPlugin"
    let jsName = "HyperTimer"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    private let center = UNUserNotificationCenter.current()
    private let dateFormatter = ISO8601DateFormatter()

    @objc override func requestPermissions(_ call: CAPPluginCall) {
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            if let error {
                call.reject("Unable to request notification permission.", "PERMISSION_FAILED", error)
                return
            }
            call.resolve(["granted": granted])
        }
    }

    @objc func schedule(_ call: CAPPluginCall) {
        guard let id = validatedID(from: call),
              let title = call.getString("title"), !title.isEmpty,
              let body = call.getString("body"), !body.isEmpty,
              let rawFireAt = call.getString("fireAt"),
              let fireAt = dateFormatter.date(from: rawFireAt)
        else {
            call.reject("A valid timer notification is required.", "INVALID_NOTIFICATION")
            return
        }

        let interval = fireAt.timeIntervalSinceNow
        guard interval > 0 else {
            center.removePendingNotificationRequests(withIdentifiers: [identifier(for: id)])
            call.resolve()
            return
        }

        let content = UNMutableNotificationContent()
        content.title = String(title.prefix(120))
        content.body = String(body.prefix(240))
        content.sound = .default
        content.threadIdentifier = "hyper.rest"

        let request = UNNotificationRequest(
            identifier: identifier(for: id),
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: max(1, interval), repeats: false)
        )
        center.add(request) { error in
            if let error {
                call.reject("Unable to schedule the rest timer alert.", "SCHEDULE_FAILED", error)
            } else {
                call.resolve()
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = validatedID(from: call) else { return }
        let identifier = identifier(for: id)
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
        call.resolve()
    }

    private func validatedID(from call: CAPPluginCall) -> String? {
        guard let id = call.getString("id"),
              !id.isEmpty,
              id.count <= 120,
              id.unicodeScalars.allSatisfy({
                  CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_"
              })
        else {
            call.reject("A valid timer identifier is required.", "INVALID_ID")
            return nil
        }
        return id
    }

    private func identifier(for id: String) -> String {
        "hyper.rest.\(id)"
    }
}

