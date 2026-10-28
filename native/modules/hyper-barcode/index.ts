/** What the scanner read: the raw payload and its symbology (ean_13, ean_8, upc_e or unknown). */
export type ScannedBarcode = { rawValue: string; format: string };

interface HyperBarcodeNative {
  getAvailability(): Promise<{ available: boolean }>;
  scanBarcode(): Promise<ScannedBarcode>;
}

let loaded: HyperBarcodeNative | null = null;
// Loaded on first use, and typed locally: the native bridge (which uses this)
// is also imported by shared code under test, outside React Native, where
// expo's runtime and its global type overrides must stay out.
type ExpoModules = { requireNativeModule<T>(name: string): T };
const native = (): HyperBarcodeNative =>
  (loaded ??= (require('expo') as ExpoModules).requireNativeModule<HyperBarcodeNative>('HyperBarcode'));

/**
 * VisionKit's data scanner, the same one the Capacitor app uses
 * (ios/App/App/HyperBarcodePlugin.swift). A cancelled scan rejects with code
 * CANCELLED and a failed one with SCAN_FAILED, as there.
 */
export const HyperBarcode: HyperBarcodeNative = {
  getAvailability: () => native().getAvailability(),
  scanBarcode: () => native().scanBarcode(),
};
