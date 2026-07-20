import Capacitor
import Foundation
import HealthKit

@objc(HyperHealthPlugin)
final class HyperHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HyperHealthPlugin"
    let jsName = "HyperHealth"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestBodyMeasurementAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readWeightSamples", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableWeightUpdates", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()
    private let isoFormatter = ISO8601DateFormatter()
    private var weightObserver: HKObserverQuery?

    private var bodyMassType: HKQuantityType? {
        HKObjectType.quantityType(forIdentifier: .bodyMass)
    }

    @objc func requestBodyMeasurementAccess(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), let bodyMassType else {
            call.resolve(["available": false, "requested": false])
            return
        }
        healthStore.requestAuthorization(toShare: [], read: [bodyMassType]) { _, error in
            if let error {
                call.reject("Unable to request Apple Health access.", "HEALTH_PERMISSION_FAILED", error)
                return
            }
            // HealthKit intentionally does not reveal whether read access was
            // denied. An empty query is the privacy-preserving result.
            call.resolve(["available": true, "requested": true])
        }
    }

    @objc func readWeightSamples(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), let bodyMassType else {
            call.resolve(["samples": []])
            return
        }

        let limit = min(500, max(1, call.getInt("limit") ?? 250))
        var predicate: NSPredicate?
        if let rawSince = call.getString("since"), let since = isoFormatter.date(from: rawSince) {
            predicate = HKQuery.predicateForSamples(
                withStart: since,
                end: nil,
                options: .strictStartDate
            )
        }

        let query = HKSampleQuery(
            sampleType: bodyMassType,
            predicate: predicate,
            limit: limit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { [weak self] _, samples, error in
            guard let self else {
                call.reject("Apple Health is unavailable.", "UNAVAILABLE")
                return
            }
            if let error {
                call.reject("Unable to read Apple Health weight data.", "HEALTH_QUERY_FAILED", error)
                return
            }
            let values = (samples as? [HKQuantitySample] ?? []).map { sample in
                [
                    "id": sample.uuid.uuidString,
                    "measuredAt": self.isoFormatter.string(from: sample.startDate),
                    "kilograms": sample.quantity.doubleValue(for: .gramUnit(with: .kilo)),
                    "sourceBundle": sample.sourceRevision.source.bundleIdentifier,
                    "sourceName": sample.sourceRevision.source.name,
                ] as [String: Any]
            }
            call.resolve(["samples": values])
        }
        healthStore.execute(query)
    }

    @objc func enableWeightUpdates(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(), let bodyMassType else {
            call.resolve(["enabled": false])
            return
        }

        if weightObserver == nil {
            let query = HKObserverQuery(sampleType: bodyMassType, predicate: nil) {
                [weak self] _, completionHandler, error in
                defer { completionHandler() }
                guard error == nil else { return }
                DispatchQueue.main.async {
                    self?.notifyListeners(
                        "weightSamplesChanged",
                        data: [:],
                        retainUntilConsumed: true
                    )
                }
            }
            weightObserver = query
            healthStore.execute(query)
        }

        healthStore.enableBackgroundDelivery(for: bodyMassType, frequency: .immediate) {
            enabled, error in
            if let error {
                call.reject("Unable to enable Apple Health updates.", "HEALTH_BACKGROUND_FAILED", error)
            } else {
                call.resolve(["enabled": enabled])
            }
        }
    }
}

