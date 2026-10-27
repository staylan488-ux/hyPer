import ExpoModulesCore
import UIKit
import Vision
import VisionKit

// Food barcode scanning with VisionKit's data scanner, ported from the
// Capacitor app's HyperBarcodePlugin.swift: the same symbologies, digit-count
// filter, formats and rejection codes (CANCELLED, SCAN_FAILED).
public class HyperBarcodeModule: Module {
  private var activeSession: AnyObject?

  public func definition() -> ModuleDefinition {
    Name("HyperBarcode")

    // VisionKit's availability checks and controllers are main-actor only,
    // so each call hops to the main actor first, as the Capacitor plugin did.
    AsyncFunction("getAvailability") { (promise: Promise) in
      Task { @MainActor in
        guard #available(iOS 16.0, *) else {
          promise.resolve(["available": false])
          return
        }
        promise.resolve(["available": DataScannerViewController.isSupported && DataScannerViewController.isAvailable])
      }
    }

    AsyncFunction("scanBarcode") { (promise: Promise) in
      Task { @MainActor [weak self] in
        guard let self else {
          promise.reject("UNAVAILABLE", "Barcode scanning is unavailable.")
          return
        }
        guard #available(iOS 16.0, *) else {
          promise.reject("UNAVAILABLE", "Native barcode scanning requires iOS 16 or later.")
          return
        }
        guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
          promise.reject("UNAVAILABLE", "Native barcode scanning is unavailable on this device.")
          return
        }
        guard let presenter = self.appContext?.utilities?.currentViewController() else {
          promise.reject("UNAVAILABLE", "Unable to present the barcode scanner.")
          return
        }

        let begin: () -> Void = { [weak self] in
          guard let self else {
            promise.reject("UNAVAILABLE", "Barcode scanning is unavailable.")
            return
          }
          let session = BarcodeScanSession(promise: promise) { [weak self] in self?.activeSession = nil }
          self.activeSession = session
          session.present(from: presenter)
        }

        // A stale session (its dismissal completion was lost) must never block
        // future scans: settle it and tear it down, then start the new one.
        if let stale = self.activeSession as? BarcodeScanSession {
          self.activeSession = nil
          stale.forceCancel(completion: begin)
        } else {
          begin()
        }
      }
    }
  }
}

@available(iOS 16.0, *)
@MainActor
private final class BarcodeScanSession: NSObject, DataScannerViewControllerDelegate {
  private let promise: Promise
  private let onFinish: () -> Void
  private let scanner: DataScannerViewController
  private var navigation: UINavigationController?
  private var finished = false

  init(promise: Promise, onFinish: @escaping () -> Void) {
    self.promise = promise
    self.onFinish = onFinish
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
    // Present from the topmost controller: presenting from one already
    // covered by another modal (a form sheet) fails silently.
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

  func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    resolveFirstBarcode(in: addedItems)
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didUpdate updatedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    resolveFirstBarcode(in: updatedItems)
  }

  func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: Error) {
    finish(error: error)
  }

  @objc private func cancel() {
    guard !finished else { return }
    finished = true
    scanner.stopScanning()
    // Settle before dismissing, so a lost dismissal cannot strand the promise.
    promise.reject("CANCELLED", "Barcode scanning was cancelled.")
    onFinish()
    dismissPresentation(animated: true, completion: nil)
  }

  func forceCancel(completion: @escaping () -> Void) {
    if !finished {
      finished = true
      scanner.stopScanning()
      promise.reject("CANCELLED", "Barcode scanning was restarted.")
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
      // Keep scanning past payloads that cannot be a food GTIN. Mirrors
      // SUPPORTED_GTIN_LENGTHS in src/lib/barcodes.ts, the checksum authority.
      let digitCount = value.filter { $0.isASCII && $0.isNumber }.count
      guard [8, 12, 13, 14].contains(digitCount) else { continue }
      finished = true
      scanner.stopScanning()
      let format: String
      switch barcode.observation.symbology {
      case .ean13: format = "ean_13"
      case .ean8: format = "ean_8"
      case .upce: format = "upc_e"
      default: format = "unknown"
      }
      promise.resolve(["rawValue": value, "format": format])
      onFinish()
      dismissPresentation(animated: true, completion: nil)
      return
    }
  }

  private func finish(error: Error) {
    guard !finished else { return }
    finished = true
    scanner.stopScanning()
    promise.reject("SCAN_FAILED", "Native barcode scanning failed.")
    onFinish()
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
