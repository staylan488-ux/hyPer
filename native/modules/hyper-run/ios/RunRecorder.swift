import CoreLocation
import CoreMotion
import ExpoModulesCore
import Foundation
import UIKit

// The recorder behind HyperRunModule, ported line for line from the Capacitor
// app's HyperRunPlugin.swift (same UserDefaults keys and trace folder, so a run
// recorded before cutover can still be recovered after it). Everything here
// runs on the main queue: the location delegate is delivered there, and the
// module hops there before every call, so `sequence`, `recording` and
// `currentRunID` are never touched from two threads.

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

final class RunRecorder: NSObject {
  static let shared = RunRecorder()

  /// Sends an event to JavaScript (set by the module).
  var emit: ((String, [String: Any]) -> Void)?

  private enum DefaultsKey {
    static let runID = "hyper.nativeRun.runID"
    static let recording = "hyper.nativeRun.recording"
    static let sequence = "hyper.nativeRun.sequence"
    static let controlSequence = "hyper.nativeRun.controlSequence"
    static let controls = "hyper.nativeRun.controls"
  }

  private var locationManager: CLLocationManager?
  private let motionManager = CMMotionActivityManager()
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()
  private var loaded = false
  private var currentRunID: String?
  private var sequence = 0
  private var recording = false
  private var motion = "unknown"
  private var pendingPermission: Promise?
  // Where the last drainSamples scan ended in the trace file, so the next
  // drain reads only what was appended since instead of re-decoding the
  // whole run. Cleared whenever the file is reset, discarded or resumed.
  private var drainResumePoint: (runID: String, sequence: Int, offset: UInt64)?
  // Stored properties cannot be availability-gated: keep type-erased storage
  // and expose an iOS 17-only typed accessor.
  private var backgroundActivitySessionStorage: Any?

  @available(iOS 17.0, *)
  private var backgroundActivitySession: CLBackgroundActivitySession? {
    get { backgroundActivitySessionStorage as? CLBackgroundActivitySession }
    set { backgroundActivitySessionStorage = newValue }
  }

  /// Main queue. Restores the last run's file and sequence; never resumes recording.
  func load() {
    guard !loaded else { return }
    loaded = true
    let manager = CLLocationManager()
    manager.delegate = self
    manager.activityType = .fitness
    manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
    manager.distanceFilter = kCLDistanceFilterNone
    manager.pausesLocationUpdatesAutomatically = false
    locationManager = manager

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
    // never stop (the JS resume snapshot expires after 12h, so no screen ever
    // offers to stop it). Recording resumes only when the run screen calls
    // startRecording(resume: true); the file and runID restored above let
    // that resume drain what was recorded.
  }

  private var manager: CLLocationManager {
    load()
    return locationManager!
  }

  // MARK: - Calls (main queue)

  func requestPermissions(_ promise: Promise) {
    switch manager.authorizationStatus {
    case .notDetermined:
      pendingPermission?.reject("SUPERSEDED", "A newer location permission request replaced this one.")
      pendingPermission = promise
      manager.requestWhenInUseAuthorization()
    case .authorizedAlways, .authorizedWhenInUse:
      requestPreciseLocationIfNeeded(promise)
    default:
      promise.resolve(permissionPayload)
    }
  }

  func startRecording(_ options: [String: Any], _ promise: Promise) {
    guard let runID = options["runId"] as? String, Self.isValidRunID(runID) else {
      promise.reject("INVALID_RUN_ID", "A valid run identifier is required.")
      return
    }
    guard isLocationAuthorized else {
      promise.reject("LOCATION_DENIED", "Location permission is required before starting a run.")
      return
    }
    let resume = options["resume"] as? Bool ?? false
    do {
      if !resume || currentRunID != runID {
        try resetPersistence(for: runID)
      } else {
        currentRunID = runID
        sequence = UserDefaults.standard.integer(forKey: DefaultsKey.sequence)
        drainResumePoint = nil
      }
      beginPlatformRecording()
      promise.resolve(["recording": recording, "lastSequence": sequence])
    } catch {
      promise.reject("PERSISTENCE_FAILED", "Unable to prepare durable run storage.")
    }
  }

  func stopRecording(discard: Bool, _ promise: Promise) {
    stopPlatformRecording()
    if #available(iOS 16.2, *) {
      Task { await RunLiveActivityCoordinator.shared.end() }
    }
    UserDefaults.standard.set(false, forKey: DefaultsKey.recording)
    if discard {
      do {
        try discardPersistence()
      } catch {
        promise.reject("PERSISTENCE_FAILED", "Unable to discard the native run trace.")
        return
      }
    }
    promise.resolve(nil)
  }

  var status: [String: Any] {
    [
      "recording": recording,
      "runId": currentRunID ?? NSNull(),
      "lastSequence": sequence,
      "location": authorizationLabel,
      "precise": manager.accuracyAuthorization == .fullAccuracy,
    ]
  }

  func drainSamples(after afterSequence: Int, _ promise: Promise) {
    guard
      let runID = currentRunID,
      let fileURL = traceFileURL,
      FileManager.default.fileExists(atPath: fileURL.path)
    else {
      promise.resolve(["samples": [], "lastSequence": afterSequence, "hasMore": false])
      return
    }

    do {
      // Continue from the previous page when the caller wants nothing at or
      // before it. The first drain after a launch or resume, or an older
      // cursor, reads the whole file.
      var baseOffset: UInt64 = 0
      var scannedSequence = 0
      let data: Data
      if let point = drainResumePoint, point.runID == runID, afterSequence >= point.sequence {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        try handle.seek(toOffset: point.offset)
        data = try handle.readToEnd() ?? Data()
        baseOffset = point.offset
        scannedSequence = point.sequence
      } else {
        data = try Data(contentsOf: fileURL)
      }

      var samples: [PersistedRunSample] = []
      // Every line before `scannedOffset` has a sequence at or below
      // `scannedSequence`, including lines skipped as already delivered or
      // corrupt, so the point also moves when this page comes back empty.
      var scannedOffset: UInt64?
      var lineStart = data.startIndex
      while lineStart < data.endIndex, samples.count < 1_000 {
        let newline = data[lineStart...].firstIndex(of: 0x0A)
        let lineEnd = newline ?? data.endIndex
        let nextStart = newline.map { data.index(after: $0) } ?? data.endIndex
        defer { lineStart = nextStart }
        // append() writes each line with its newline in one write, so only
        // resume past lines that are complete.
        if newline != nil {
          scannedOffset = baseOffset + UInt64(data.distance(from: data.startIndex, to: nextStart))
        }
        // Skip a truncated or corrupt line (app killed mid-append) instead of
        // failing the whole recovery.
        guard
          lineEnd > lineStart,
          let sample = try? decoder.decode(PersistedRunSample.self, from: Data(data[lineStart..<lineEnd]))
        else { continue }
        if newline != nil {
          scannedSequence = max(scannedSequence, sample.sequence)
        }
        guard sample.sequence > afterSequence else { continue }
        samples.append(sample)
      }
      if let scannedOffset {
        drainResumePoint = (runID, scannedSequence, scannedOffset)
      }
      promise.resolve([
        "samples": samples.map(\.bridgeValue),
        "lastSequence": samples.last?.sequence ?? afterSequence,
        // Only a full page can have more. Comparing with the in-memory
        // `sequence` would report more forever once a failed append left a
        // sequence that was never written.
        "hasMore": samples.count == 1_000,
      ])
    } catch {
      promise.reject("PERSISTENCE_FAILED", "Unable to recover native run samples.")
    }
  }

  func drainControls(after afterSequence: Int) -> [String: Any] {
    let controls = persistedControls.filter { $0.sequence > afterSequence }
    let batch = Array(controls.prefix(100))
    return [
      "controls": batch.map(\.bridgeValue),
      "lastSequence": batch.last?.sequence ?? afterSequence,
      "hasMore": batch.count < controls.count,
    ]
  }

  static func isValidRunID(_ value: String) -> Bool {
    value.count <= 80
      && !value.isEmpty
      && value.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) || $0 == "-" }
  }

  // MARK: - Permission

  private var isLocationAuthorized: Bool {
    manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse
  }

  private var authorizationLabel: String {
    switch manager.authorizationStatus {
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
      "precise": manager.accuracyAuthorization == .fullAccuracy,
      "motionAvailable": CMMotionActivityManager.isActivityAvailable(),
    ]
  }

  private func requestPreciseLocationIfNeeded(_ promise: Promise) {
    guard manager.accuracyAuthorization == .reducedAccuracy else {
      requestMotionIfNeeded(promise)
      return
    }
    manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "RunTracking") { [weak self] _ in
      DispatchQueue.main.async {
        guard let self else {
          promise.reject("UNAVAILABLE", "Run tracking is unavailable.")
          return
        }
        self.requestMotionIfNeeded(promise)
      }
    }
  }

  /// Asks for Motion & Fitness before the run, while the screen is in front;
  /// otherwise iOS asks the first time the app returns mid-run. Motion only
  /// helps tell running from standing, so any answer goes ahead.
  private func requestMotionIfNeeded(_ promise: Promise) {
    guard CMMotionActivityManager.isActivityAvailable(), CMMotionActivityManager.authorizationStatus() == .notDetermined else {
      promise.resolve(permissionPayload)
      return
    }
    let now = Date()
    motionManager.queryActivityStarting(from: now.addingTimeInterval(-60), to: now, to: .main) { [weak self] _, _ in
      guard let self else {
        promise.reject("UNAVAILABLE", "Run tracking is unavailable.")
        return
      }
      promise.resolve(self.permissionPayload)
    }
  }

  // MARK: - Recording

  private func beginPlatformRecording() {
    guard !recording else { return }
    // Running shakes the phone hard enough to trigger iOS's Shake to Undo,
    // which throws an alert over the run screen mid-stride. Off for the run.
    UIApplication.shared.applicationSupportsShakeToEdit = false
    // A run screen glanced at should not dim and lock mid-interval.
    UIApplication.shared.isIdleTimerDisabled = true
    manager.allowsBackgroundLocationUpdates = true
    manager.showsBackgroundLocationIndicator = true
    if #available(iOS 17.0, *) {
      backgroundActivitySession = CLBackgroundActivitySession()
    }
    startMotionUpdates()
    recording = true
    UserDefaults.standard.set(true, forKey: DefaultsKey.recording)
    manager.startUpdatingLocation()
  }

  private func stopPlatformRecording() {
    guard recording else { return }
    UIApplication.shared.applicationSupportsShakeToEdit = true
    UIApplication.shared.isIdleTimerDisabled = false
    manager.stopUpdatingLocation()
    manager.allowsBackgroundLocationUpdates = false
    motionManager.stopActivityUpdates()
    motion = "unknown"
    if #available(iOS 17.0, *) {
      backgroundActivitySession?.invalidate()
      backgroundActivitySession = nil
    }
    recording = false
    RunCuePlayer.shared.release()
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

  // MARK: - Durable storage

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
    if let oldFileURL = traceFileURL, FileManager.default.fileExists(atPath: oldFileURL.path) {
      try FileManager.default.removeItem(at: oldFileURL)
    }
    guard let directory = persistenceDirectory else { throw CocoaError(.fileNoSuchFile) }
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    )
    currentRunID = runID
    sequence = 0
    drainResumePoint = nil
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
    drainResumePoint = nil
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

  // MARK: - Lock-screen controls

  @objc private func handleRunControl(_ notification: Notification) {
    guard
      let action = notification.userInfo?["action"] as? String,
      RunControlAction(rawValue: action) != nil
    else { return }
    let timestampMs = notification.userInfo?["timestampMs"] as? Double ?? Date().timeIntervalSince1970 * 1_000
    // The observer runs on the posting thread; controls touch state that
    // lives on main.
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in
        self?.applyRunControl(action: action, timestampMs: timestampMs)
      }
      return
    }
    applyRunControl(action: action, timestampMs: timestampMs)
  }

  private func applyRunControl(action: String, timestampMs: Double) {
    guard recording else { return }
    let defaults = UserDefaults.standard
    let controlSequence = defaults.integer(forKey: DefaultsKey.controlSequence) + 1
    defaults.set(controlSequence, forKey: DefaultsKey.controlSequence)
    let control = PersistedRunControl(sequence: controlSequence, timestampMs: timestampMs, action: action)
    persistedControls.append(control)
    emit?("runControl", control.bridgeValue)

    if action == RunControlAction.finish.rawValue {
      stopPlatformRecording()
      defaults.set(false, forKey: DefaultsKey.recording)
    }
  }
}

extension RunRecorder: CLLocationManagerDelegate {
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard let promise = pendingPermission else { return }
    // The first callback reports the current status before the person answers.
    guard manager.authorizationStatus != .notDetermined else { return }
    pendingPermission = nil
    if isLocationAuthorized {
      requestPreciseLocationIfNeeded(promise)
    } else {
      promise.resolve(permissionPayload)
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
        simulated: location.sourceInformation?.isSimulatedBySoftware ?? false
      )
      persisted.append(sample)
      emit?("locationSample", sample.bridgeValue)
    }

    do {
      try append(persisted)
    } catch {
      emit?("locationError", ["code": "PERSISTENCE_FAILED", "message": "Run recovery storage failed."])
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let code: String
    let message: String
    switch (error as? CLError)?.code {
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
    emit?("locationError", ["code": code, "message": message])
  }
}
