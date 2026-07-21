import Capacitor
import CoreLocation
import CoreMotion
import Foundation

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
    ]

    private enum DefaultsKey {
        static let runID = "hyper.nativeRun.runID"
        static let recording = "hyper.nativeRun.recording"
        static let sequence = "hyper.nativeRun.sequence"
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

