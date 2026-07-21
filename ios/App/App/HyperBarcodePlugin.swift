import Capacitor
import Foundation
import UIKit
import Vision
import VisionKit

@available(iOS 16.0, *)
private final class NativeBarcodeSession: NSObject, DataScannerViewControllerDelegate {
    private weak var plugin: HyperBarcodePlugin?
    private let call: CAPPluginCall
    private let scanner: DataScannerViewController
    private var finished = false

    init(plugin: HyperBarcodePlugin, call: CAPPluginCall) {
        self.plugin = plugin
        self.call = call
        scanner = DataScannerViewController(
            recognizedDataTypes: [
                .barcode(symbologies: [.ean13, .ean8, .upce, .gs1DataBar, .gs1DataBarExpanded]),
            ],
            qualityLevel: .accurate,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: true,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        super.init()
        scanner.delegate = self
        scanner.navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .cancel,
            target: self,
            action: #selector(cancel)
        )
        scanner.title = "Scan food barcode"
    }

    func present(from presenter: UIViewController) {
        let navigation = UINavigationController(rootViewController: scanner)
        navigation.modalPresentationStyle = .fullScreen
        presenter.present(navigation, animated: true) { [weak self] in
            guard let self else { return }
            do {
                try self.scanner.startScanning()
            } catch {
                self.finish(error: error)
            }
        }
    }

    func dataScanner(
        _ dataScanner: DataScannerViewController,
        didAdd addedItems: [RecognizedItem],
        allItems: [RecognizedItem]
    ) {
        resolveFirstBarcode(in: addedItems)
    }

    func dataScanner(
        _ dataScanner: DataScannerViewController,
        didUpdate updatedItems: [RecognizedItem],
        allItems: [RecognizedItem]
    ) {
        resolveFirstBarcode(in: updatedItems)
    }

    func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: Error) {
        finish(error: error)
    }

    @objc private func cancel() {
        guard !finished else { return }
        finished = true
        scanner.stopScanning()
        scanner.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            self.call.reject("Barcode scanning was cancelled.", "CANCELLED")
            self.plugin?.finishSession()
        }
    }

    private func resolveFirstBarcode(in items: [RecognizedItem]) {
        guard !finished else { return }
        for item in items {
            guard case let .barcode(barcode) = item,
                  let value = barcode.payloadStringValue,
                  !value.isEmpty
            else { continue }
            finished = true
            scanner.stopScanning()
            let format: String
            switch barcode.observation.symbology {
            case .ean13: format = "ean_13"
            case .ean8: format = "ean_8"
            case .upce: format = "upc_e"
            default: format = "unknown"
            }
            scanner.dismiss(animated: true) { [weak self] in
                guard let self else { return }
                self.call.resolve(["rawValue": value, "format": format])
                self.plugin?.finishSession()
            }
            return
        }
    }

    private func finish(error: Error) {
        guard !finished else { return }
        finished = true
        scanner.stopScanning()
        scanner.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            self.call.reject("Native barcode scanning failed.", "SCAN_FAILED", error)
            self.plugin?.finishSession()
        }
    }
}

@objc(HyperBarcodePlugin)
final class HyperBarcodePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "HyperBarcodePlugin"
    let jsName = "HyperBarcode"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanBarcode", returnType: CAPPluginReturnPromise),
    ]

    private var activeSession: AnyObject?

    // DataScannerViewController availability checks are MainActor-isolated,
    // so plugin calls hop to the main actor before touching VisionKit
    @objc func getAvailability(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard #available(iOS 16.0, *) else {
                call.resolve(["available": false])
                return
            }
            call.resolve([
                "available": DataScannerViewController.isSupported && DataScannerViewController.isAvailable,
            ])
        }
    }

    @objc func scanBarcode(_ call: CAPPluginCall) {
        Task { @MainActor [weak self] in
            guard let self else {
                call.unavailable("Barcode scanning is unavailable.")
                return
            }
            guard #available(iOS 16.0, *) else {
                call.unavailable("Native barcode scanning requires iOS 16 or later.")
                return
            }
            guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
                call.unavailable("Native barcode scanning is unavailable on this device.")
                return
            }
            guard self.activeSession == nil else {
                call.reject("A barcode scan is already in progress.", "SCAN_IN_PROGRESS")
                return
            }
            guard let presenter = self.bridge?.viewController else {
                call.unavailable("Unable to present the barcode scanner.")
                return
            }
            let session = NativeBarcodeSession(plugin: self, call: call)
            self.activeSession = session
            session.present(from: presenter)
        }
    }

    fileprivate func finishSession() {
        activeSession = nil
    }
}

