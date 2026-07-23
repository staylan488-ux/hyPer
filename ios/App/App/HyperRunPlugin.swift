import Capacitor
import CoreLocation
import CoreMotion
import Foundation
import UIKit

private struct PersistedRunSample: Codable {
    let sequence: Int
    let timestampMs: Double
    let latitude: Double
    let longitude: Double
    let horizontalAccuracyM: Double
    let speedMps: Double?
    let speedAccuracyMps: Double?
    let courseDegrees: Double?
    let courseAccuracyDegrees: Double?
    let altitudeM: Double
    let verticalAccuracyM: Double?
    let motion: String
    let reducedAccuracy: Bool
    let simulated: Bool

    var bridgeValue: [String: Any] {
        [
            "sequence": sequence,
            "timestampMs": timestampMs,
            "latitude": latitude,
            "longitude": longitude,
            "horizontalAccuracyM": horizontalAccuracyM,
            "speedMps": speedMps ?? NSNull(),
            "speedAccuracyMps": speedAccuracyMps ?? NSNull(),
            "courseDegrees": courseDegrees ?? NSNull(),
            "courseAccuracyDegrees": courseAccuracyDegrees ?? NSNull(),
            "altitudeM": altitudeM,
            "verticalAccuracyM": verticalAccuracyM ?? NSNull(),
            "motion": motion,
            "reducedAccuracy": reducedAccuracy,
            "simulated": simulated,
        ]
    }
}

private struct PersistedRunControl: Codable {
    let sequence: Int
    let timestampMs: Double
    let action: String

    var bridgeValue: [String: Any] {
        ["sequence": sequence, "timestampMs": timestampMs, "action": action]
    }
}

@objc(HyperRunPlugin)
final class HyperRunPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HyperRunPlugin"
    let jsName = "HyperRun"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainSamples", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainControls", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "syncLiveActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareDiagnostics", returnType: CAPPluginReturnPromise),
    ]

    private enum DefaultsKey {
        static let runID = "hyper.nativeRun.runID"
        static let recording = "hyper.nativeRun.recording"
        static let sequence = "hyper.nativeRun.sequence"
        static let controlSequence = "hyper.nativeRun.controlSequence"
        static let controls = "hyper.nativeRun.controls"
    }

    private let locationManager = CLLocationManager()
    private let motionManager = CMMotionActivityManager()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var currentRunID: String?
    private var sequence = 0
    private var recording = false
    private var motion = "unknown"
    private var pendingPermissionCall: CAPPluginCall?

    // stored properties cannot be availability-gated; keep type-erased storage
    // and expose an iOS 17-only typed accessor
    private var backgroundActivitySessionStorage: Any?

    @available(iOS 17.0, *)
    private var backgroundActivitySession: CLBackgroundActivitySession? {
        get { backgroundActivitySessionStorage as? CLBackgroundActivitySession }
        set { backgroundActivitySessionStorage = newValue }
    }

    override func load() {
        locationManager.delegate = self
        locationManager.activityType = .fitness
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.pausesLocationUpdatesAutomatically = false

        let defaults = UserDefaults.standard
        currentRunID = defaults.string(forKey: DefaultsKey.runID)
        sequence = defaults.integer(forKey: DefaultsKey.sequence)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRunControl(_:)),
            name: .hyperRunControl,
            object: nil
        )
        // Do NOT auto-resume recording on launch. A run abandoned before the
        // process was killed would otherwise restart GPS on every launch and
        // never stop (the JS resume snapshot expires after 12h, so no UI ever
        // offers to stop it). Recording resumes only when the run screen calls
        // startRecording(resume:true); the durable file + runID are restored
        // above so that resume can drain what was recorded.
    }

    @objc override func requestPermissions(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Run tracking is unavailable.", "UNAVAILABLE")
                return
            }
            switch self.locationManager.authorizationStatus {
            case .notDetermined:
                self.pendingPermissionCall?.reject(
                    "A newer location permission request replaced this one.",
                    "SUPERSEDED"
                )
                self.pendingPermissionCall = call
                self.locationManager.requestWhenInUseAuthorization()
            case .authorizedAlways, .authorizedWhenInUse:
                self.requestPreciseLocationIfNeeded(call)
            default:
                call.resolve(self.permissionPayload)
            }
        }
    }

    // startRecording/stopRecording/getStatus/drainSamples run on the main queue
    // so all access to `sequence`, `recording`, and `currentRunID` is serialized
    // against the CLLocationManager delegate (which is also delivered on main).
    // Otherwise the delegate's `sequence += 1` races the plugin queue.
    @objc func startRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Run tracking is unavailable.", "UNAVAILABLE")
                return
            }
            guard let runID = call.getString("runId"), Self.isValidRunID(runID) else {
                call.reject("A valid run identifier is required.", "INVALID_RUN_ID")
                return
            }
            guard self.isLocationAuthorized else {
                call.reject("Location permission is required before starting a run.", "LOCATION_DENIED")
                return
            }

            let resume = call.getBool("resume", false)
            do {
                if !resume || self.currentRunID != runID {
                    try self.resetPersistence(for: runID)
                } else {
                    self.currentRunID = runID
                    self.sequence = UserDefaults.standard.integer(forKey: DefaultsKey.sequence)
                }
                self.beginPlatformRecording()
                call.resolve(["recording": self.recording, "lastSequence": self.sequence])
            } catch {
                call.reject("Unable to prepare durable run storage.", "PERSISTENCE_FAILED", error)
            }
        }
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Run tracking is unavailable.", "UNAVAILABLE")
                return
            }
            self.stopPlatformRecording()
            if #available(iOS 16.2, *) {
                Task { await RunLiveActivityCoordinator.shared.end() }
            }
            UserDefaults.standard.set(false, forKey: DefaultsKey.recording)
            if call.getBool("discard", false) {
                do {
                    try self.discardPersistence()
                } catch {
                    call.reject("Unable to discard the native run trace.", "PERSISTENCE_FAILED", error)
                    return
                }
            }
            call.resolve()
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Run tracking is unavailable.", "UNAVAILABLE")
                return
            }
            call.resolve([
                "recording": self.recording,
                "runId": self.currentRunID ?? NSNull(),
                "lastSequence": self.sequence,
                "location": self.authorizationLabel,
                "precise": self.locationManager.accuracyAuthorization == .fullAccuracy,
            ])
        }
    }

    @objc func drainSamples(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Run tracking is unavailable.", "UNAVAILABLE")
                return
            }
            let afterSequence = max(0, call.getInt("afterSequence") ?? 0)
            guard let fileURL = self.traceFileURL, FileManager.default.fileExists(atPath: fileURL.path) else {
                call.resolve(["samples": [], "lastSequence": afterSequence, "hasMore": false])
                return
            }

            do {
                let data = try Data(contentsOf: fileURL)
                let lines = data.split(separator: 0x0A, omittingEmptySubsequences: true)
                var samples: [PersistedRunSample] = []
                samples.reserveCapacity(min(1_000, lines.count))
                for line in lines {
                    // Skip a truncated/corrupt line (app killed mid-append)
                    // instead of failing the whole recovery — a single bad line
                    // must not brick resume for the entire run.
                    guard let sample = try? self.decoder.decode(PersistedRunSample.self, from: Data(line)) else {
                        continue
                    }
                    if sample.sequence > afterSequence {
                        samples.append(sample)
                        if samples.count == 1_000 { break }
                    }
                }
                let lastReturnedSequence = samples.last?.sequence ?? afterSequence
                call.resolve([
                    "samples": samples.map(\.bridgeValue),
                    "lastSequence": lastReturnedSequence,
                    "hasMore": lastReturnedSequence < self.sequence,
                ])
            } catch {
                call.reject("Unable to recover native run samples.", "PERSISTENCE_FAILED", error)
            }
        }
    }

    @objc func drainControls(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let afterSequence = max(0, call.getInt("afterSequence") ?? 0)
            let controls = self.persistedControls.filter { $0.sequence > afterSequence }
            let batch = Array(controls.prefix(100))
            call.resolve([
                "controls": batch.map(\.bridgeValue),
                "lastSequence": batch.last?.sequence ?? afterSequence,
                "hasMore": batch.count < controls.count,
            ])
        }
    }

    @objc func syncLiveActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        guard
            let runID = call.getString("runId"),
            Self.isValidRunID(runID),
            let mode = call.getString("mode")
        else {
            call.reject("Run activity data is invalid.", "INVALID_LIVE_ACTIVITY")
            return
        }
        let distanceM = max(0, call.getDouble("distanceM") ?? 0)
        let elapsedS = max(0, call.getInt("elapsedS") ?? 0)
        let livePace = call.getString("livePace") ?? "—"
        let averagePace = call.getString("averagePace") ?? "—"
        let isResting = call.getBool("isResting", false)

        Task {
            await RunLiveActivityCoordinator.shared.sync(
                runID: runID,
                mode: mode,
                distanceM: distanceM,
                elapsedS: elapsedS,
                livePace: livePace,
                averagePace: averagePace,
                isResting: isResting
            )
            call.resolve()
        }
    }

    @objc func shareDiagnostics(_ call: CAPPluginCall) {
        guard let content = call.getString("content"), !content.isEmpty else {
            call.reject("Diagnostics are empty.", "INVALID_DIAGNOSTICS")
            return
        }
        let requestedName = call.getString("filename") ?? "hyper-gps-diagnostics.json"
        let filename = requestedName.replacingOccurrences(
            of: "[^A-Za-z0-9._-]",
            with: "-",
            options: .regularExpression
        )
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)

        do {
            try content.write(to: fileURL, atomically: true, encoding: .utf8)
        } catch {
            call.reject("Unable to prepare GPS diagnostics.", "EXPORT_FAILED", error)
            return
        }

        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                try? FileManager.default.removeItem(at: fileURL)
                call.reject("Unable to open the iOS share sheet.", "EXPORT_UNAVAILABLE")
                return
            }
            let activity = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            activity.completionWithItemsHandler = { _, _, _, _ in
                try? FileManager.default.removeItem(at: fileURL)
                call.resolve()
            }
            if let popover = activity.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(
                    x: presenter.view.bounds.midX,
                    y: presenter.view.bounds.midY,
                    width: 1,
                    height: 1
                )
            }
            presenter.present(activity, animated: true)
        }
    }

    private var isLocationAuthorized: Bool {
        locationManager.authorizationStatus == .authorizedAlways
            || locationManager.authorizationStatus == .authorizedWhenInUse
    }

    private var authorizationLabel: String {
        switch locationManager.authorizationStatus {
        case .notDetermined: return "prompt"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .authorizedWhenInUse: return "whenInUse"
        case .authorizedAlways: return "always"
        @unknown default: return "restricted"
        }
    }

    private var permissionPayload: [String: Any] {
        [
            "location": authorizationLabel,
            "precise": locationManager.accuracyAuthorization == .fullAccuracy,
            "motionAvailable": CMMotionActivityManager.isActivityAvailable(),
        ]
    }

    private func requestPreciseLocationIfNeeded(_ call: CAPPluginCall) {
        guard locationManager.accuracyAuthorization == .reducedAccuracy else {
            call.resolve(permissionPayload)
            return
        }
        locationManager.requestTemporaryFullAccuracyAuthorization(
            withPurposeKey: "RunTracking"
        ) { [weak self] _ in
            guard let self else {
                call.reject("Run tracking is unavailable.", "UNAVAILABLE")
                return
            }
            call.resolve(self.permissionPayload)
        }
    }

    private func beginPlatformRecording() {
        guard !recording else { return }
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        if #available(iOS 17.0, *) {
            backgroundActivitySession = CLBackgroundActivitySession()
        }
        startMotionUpdates()
        recording = true
        UserDefaults.standard.set(true, forKey: DefaultsKey.recording)
        locationManager.startUpdatingLocation()
    }

    private func stopPlatformRecording() {
        guard recording else { return }
        locationManager.stopUpdatingLocation()
        motionManager.stopActivityUpdates()
        motion = "unknown"
        if #available(iOS 17.0, *) {
            backgroundActivitySession?.invalidate()
            backgroundActivitySession = nil
        }
        recording = false
    }

    private func startMotionUpdates() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        motionManager.startActivityUpdates(to: .main) { [weak self] activity in
            guard let self, let activity else { return }
            if activity.running || activity.walking || activity.cycling || activity.automotive {
                self.motion = "moving"
            } else if activity.stationary {
                self.motion = "stationary"
            } else {
                self.motion = "unknown"
            }
        }
    }

    private var persistenceDirectory: URL? {
        try? FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("HyperRunRecorder", isDirectory: true)
    }

    private var traceFileURL: URL? {
        guard let currentRunID, let directory = persistenceDirectory else { return nil }
        return directory.appendingPathComponent("\(currentRunID).jsonl", isDirectory: false)
    }

    private func resetPersistence(for runID: String) throws {
        if let oldFileURL = traceFileURL,
           FileManager.default.fileExists(atPath: oldFileURL.path)
        {
            try FileManager.default.removeItem(at: oldFileURL)
        }
        guard let directory = persistenceDirectory else {
            throw CocoaError(.fileNoSuchFile)
        }
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        currentRunID = runID
        sequence = 0
        let defaults = UserDefaults.standard
        defaults.set(runID, forKey: DefaultsKey.runID)
        defaults.set(sequence, forKey: DefaultsKey.sequence)
        defaults.set(0, forKey: DefaultsKey.controlSequence)
        defaults.removeObject(forKey: DefaultsKey.controls)
        guard let fileURL = traceFileURL else { throw CocoaError(.fileNoSuchFile) }
        FileManager.default.createFile(
            atPath: fileURL.path,
            contents: nil,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
    }

    private func discardPersistence() throws {
        if let fileURL = traceFileURL, FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
        currentRunID = nil
        sequence = 0
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: DefaultsKey.runID)
        defaults.removeObject(forKey: DefaultsKey.sequence)
        defaults.removeObject(forKey: DefaultsKey.controlSequence)
        defaults.removeObject(forKey: DefaultsKey.controls)
        defaults.set(false, forKey: DefaultsKey.recording)
    }

    private func append(_ samples: [PersistedRunSample]) throws {
        guard !samples.isEmpty, let fileURL = traceFileURL else { return }
        let handle = try FileHandle(forWritingTo: fileURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        for sample in samples {
            var data = try encoder.encode(sample)
            data.append(0x0A)
            try handle.write(contentsOf: data)
        }
        try handle.synchronize()
        UserDefaults.standard.set(sequence, forKey: DefaultsKey.sequence)
    }

    private static func isValidRunID(_ value: String) -> Bool {
        value.count <= 80
            && !value.isEmpty
            && value.unicodeScalars.allSatisfy {
                CharacterSet.alphanumerics.contains($0) || $0 == "-"
            }
    }

    private var persistedControls: [PersistedRunControl] {
        get {
            guard let data = UserDefaults.standard.data(forKey: DefaultsKey.controls) else { return [] }
            return (try? decoder.decode([PersistedRunControl].self, from: data)) ?? []
        }
        set {
            let bounded = Array(newValue.suffix(500))
            if let data = try? encoder.encode(bounded) {
                UserDefaults.standard.set(data, forKey: DefaultsKey.controls)
            }
        }
    }

    @objc private func handleRunControl(_ notification: Notification) {
        guard
            recording,
            let action = notification.userInfo?["action"] as? String,
            RunControlAction(rawValue: action) != nil
        else { return }
        let timestampMs = notification.userInfo?["timestampMs"] as? Double
            ?? Date().timeIntervalSince1970 * 1_000
        let defaults = UserDefaults.standard
        let controlSequence = defaults.integer(forKey: DefaultsKey.controlSequence) + 1
        defaults.set(controlSequence, forKey: DefaultsKey.controlSequence)
        let control = PersistedRunControl(
            sequence: controlSequence,
            timestampMs: timestampMs,
            action: action
        )
        persistedControls.append(control)
        notifyListeners("runControl", data: control.bridgeValue)

        if action == RunControlAction.finish.rawValue {
            stopPlatformRecording()
            defaults.set(false, forKey: DefaultsKey.recording)
        }
    }
}

extension HyperRunPlugin: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let call = pendingPermissionCall else { return }
        pendingPermissionCall = nil
        if isLocationAuthorized {
            requestPreciseLocationIfNeeded(call)
        } else {
            call.resolve(permissionPayload)
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard recording else { return }
        let sortedLocations = locations.sorted { $0.timestamp < $1.timestamp }
        var persisted: [PersistedRunSample] = []
        persisted.reserveCapacity(sortedLocations.count)

        for location in sortedLocations {
            guard location.horizontalAccuracy >= 0 else { continue }
            sequence += 1
            let sourceInformation = location.sourceInformation
            let sample = PersistedRunSample(
                sequence: sequence,
                timestampMs: location.timestamp.timeIntervalSince1970 * 1_000,
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                horizontalAccuracyM: location.horizontalAccuracy,
                speedMps: location.speed >= 0 ? location.speed : nil,
                speedAccuracyMps: location.speedAccuracy >= 0 ? location.speedAccuracy : nil,
                courseDegrees: location.course >= 0 ? location.course : nil,
                courseAccuracyDegrees: location.courseAccuracy >= 0 ? location.courseAccuracy : nil,
                altitudeM: location.altitude,
                verticalAccuracyM: location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil,
                motion: motion,
                reducedAccuracy: manager.accuracyAuthorization == .reducedAccuracy,
                simulated: sourceInformation?.isSimulatedBySoftware ?? false
            )
            persisted.append(sample)
            notifyListeners("locationSample", data: sample.bridgeValue)
        }

        do {
            try append(persisted)
        } catch {
            notifyListeners(
                "locationError",
                data: ["code": "PERSISTENCE_FAILED", "message": "Run recovery storage failed."]
            )
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let locationError = error as? CLError
        let code: String
        let message: String
        switch locationError?.code {
        case .denied:
            code = "LOCATION_DENIED"
            message = "Location permission was denied."
        case .locationUnknown:
            code = "LOCATION_UNAVAILABLE"
            message = "The GPS signal is temporarily unavailable."
        default:
            code = "LOCATION_FAILED"
            message = "Run location tracking failed."
        }
        notifyListeners("locationError", data: ["code": code, "message": message])
    }
}
