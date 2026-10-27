import ExpoModulesCore
import Foundation
import HealthKit

// Apple Health body weight, ported from the Capacitor app's
// HyperHealthPlugin.swift: read-only access to body mass, samples oldest first
// in pages, and an observer that reports new samples.
public class HyperHealthModule: Module {
  private let healthStore = HKHealthStore()
  private let isoFormatter = ISO8601DateFormatter()
  // JS sends `new Date().toISOString()`, which always has milliseconds; a
  // default ISO8601DateFormatter cannot parse those, so try a fractional-aware
  // formatter first.
  private let isoFractionalFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  private var weightObserver: HKObserverQuery?

  private var bodyMassType: HKQuantityType? {
    HKObjectType.quantityType(forIdentifier: .bodyMass)
  }

  private func parseISODate(_ raw: String) -> Date? {
    isoFractionalFormatter.date(from: raw) ?? isoFormatter.date(from: raw)
  }

  public func definition() -> ModuleDefinition {
    Name("HyperHealth")

    Events("weightSamplesChanged")

    AsyncFunction("requestBodyMeasurementAccess") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable(), let bodyMassType = self.bodyMassType else {
        promise.resolve(["available": false, "requested": false])
        return
      }
      self.healthStore.requestAuthorization(toShare: [], read: [bodyMassType]) { _, error in
        if let error {
          promise.reject("HEALTH_PERMISSION_FAILED", "Unable to request Apple Health access. \(error.localizedDescription)")
          return
        }
        // HealthKit never says whether read access was denied; an empty
        // query is the privacy-preserving result.
        promise.resolve(["available": true, "requested": true])
      }
    }

    AsyncFunction("readWeightSamples") { (options: [String: Any], promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable(), let bodyMassType = self.bodyMassType else {
        promise.resolve(["samples": []])
        return
      }
      let requested = (options["limit"] as? NSNumber)?.intValue ?? 250
      let limit = min(500, max(1, requested))
      var predicate: NSPredicate?
      if let rawSince = options["since"] as? String, let since = self.parseISODate(rawSince) {
        predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
      }
      let formatter = self.isoFormatter
      let query = HKSampleQuery(
        sampleType: bodyMassType,
        predicate: predicate,
        limit: limit,
        sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
      ) { _, samples, error in
        if let error {
          promise.reject("HEALTH_QUERY_FAILED", "Unable to read Apple Health weight data. \(error.localizedDescription)")
          return
        }
        let values = (samples as? [HKQuantitySample] ?? []).map { sample in
          [
            "id": sample.uuid.uuidString,
            "measuredAt": formatter.string(from: sample.startDate),
            "kilograms": sample.quantity.doubleValue(for: .gramUnit(with: .kilo)),
            "sourceBundle": sample.sourceRevision.source.bundleIdentifier,
            "sourceName": sample.sourceRevision.source.name,
          ] as [String: Any]
        }
        promise.resolve(["samples": values])
      }
      self.healthStore.execute(query)
    }

    AsyncFunction("enableWeightUpdates") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable(), let bodyMassType = self.bodyMassType else {
        promise.resolve(["enabled": false])
        return
      }
      if self.weightObserver == nil {
        let query = HKObserverQuery(sampleType: bodyMassType, predicate: nil) { [weak self] _, completionHandler, error in
          defer { completionHandler() }
          guard error == nil else { return }
          DispatchQueue.main.async {
            self?.sendEvent("weightSamplesChanged", [:])
          }
        }
        self.weightObserver = query
        self.healthStore.execute(query)
      }
      // Background delivery is a bonus: the observer above and the sync on
      // each return to the app keep weights current without it, and the
      // simulator never grants it. Report it rather than fail the opt-in.
      self.healthStore.enableBackgroundDelivery(for: bodyMassType, frequency: .immediate) { enabled, error in
        if let error {
          NSLog("hyPer: Apple Health background delivery unavailable: %@", error.localizedDescription)
        }
        promise.resolve(["enabled": true, "backgroundDelivery": error == nil && enabled])
      }
    }
  }
}
