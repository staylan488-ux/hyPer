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
    private var navigation: UINavigationController?
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
        // present from the topmost controller: presenting from one that is
        // already covered by another modal fails silently, its completion
        // never runs, and the JS promise would never settle
        var top = presenter
        while let next = top.presentedViewController, !next.isBeingDismissed {
            top = next
        }
        let navigation = UINavigationController(rootViewController: scanner)
        navigation.modalPresentationStyle = .fullScreen
        self.navigation = navigation
        top.present(navigation, animated: true) { [weak self] in
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
        // settle the call before dismissing: a dismissal whose completion
        // never fires must not be able to strand the JS promise
        call.reject("Barcode scanning was cancelled.", "CANCELLED")
        plugin?.finishSession()
        dismissPresentation(animated: true, completion: nil)
    }

    // used when a new scan request arrives while this session is still
    // registered — settles the old call, tears the sheet down without
    // animation, then lets the caller present the fresh session
    func forceCancel(completion: @escaping () -> Void) {
        if !finished {
            finished = true
            scanner.stopScanning()
            call.reject("Barcode scanning was restarted.", "CANCELLED")
        }
        dismissPresentation(animated: false, completion: completion)
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
            call.resolve(["rawValue": value, "format": format])
            plugin?.finishSession()
            dismissPresentation(animated: true, completion: nil)
            return
        }
    }

    private func finish(error: Error) {
        guard !finished else { return }
        finished = true
        scanner.stopScanning()
        call.reject("Native barcode scanning failed.", "SCAN_FAILED", error)
        plugin?.finishSession()
        dismissPresentation(animated: true, completion: nil)
    }

    private func dismissPresentation(animated: Bool, completion: (() -> Void)?) {
        guard let navigation, let presenting = navigation.presentingViewController else {
            completion?()
            return
        }
        presenting.dismiss(animated: animated, completion: completion)
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
            guard let presenter = self.bridge?.viewController else {
                call.unavailable("Unable to present the barcode scanner.")
                return
            }

            let begin: () -> Void = { [weak self] in
                guard let self else {
                    call.unavailable("Barcode scanning is unavailable.")
                    return
                }
                let session = NativeBarcodeSession(plugin: self, call: call)
                self.activeSession = session
                session.present(from: presenter)
            }

            // a stale session (its dismissal completion was lost, or the
            // WebView reloaded mid-scan) must never brick future scans:
            // settle it and tear it down, then start the new one
            if let stale = self.activeSession as? NativeBarcodeSession {
                self.activeSession = nil
                stale.forceCancel(completion: begin)
            } else {
                begin()
            }
        }
    }

    fileprivate func finishSession() {
        activeSession = nil
    }
}
