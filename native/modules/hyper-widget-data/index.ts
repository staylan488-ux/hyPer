// Hands the home-screen widgets their data (ios/HyperWidgetDataModule.swift):
// the snapshot is written to the App Group the widget extension reads.
import { requireOptionalNativeModule } from 'expo';

interface HyperWidgetDataNative {
  setSnapshot(json: string): Promise<void>;
  clear(): Promise<void>;
}

// Absent from a development build made before this module: calls then do nothing.
let loaded: HyperWidgetDataNative | null | undefined;
const native = () => (loaded === undefined ? (loaded = requireOptionalNativeModule<HyperWidgetDataNative>('HyperWidgetData')) : loaded);

/** Saves the widgets' snapshot (JSON) and asks iOS to redraw them. */
export function setSnapshot(json: string): Promise<void> {
  return native()?.setSnapshot(json) ?? Promise.resolve();
}

/** Removes the snapshot, so widgets show nothing of a signed-out account. */
export function clear(): Promise<void> {
  return native()?.clear() ?? Promise.resolve();
}
