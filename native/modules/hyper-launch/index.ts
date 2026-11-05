// Presses from outside the app (ios/HyperLaunchStore.swift): the Snap a meal
// control, App Shortcuts and Home Screen quick actions, kept by iOS until the
// app takes them (src/lib/launch.ts).
import { requireOptionalNativeModule } from 'expo';

type Subscription = { remove: () => void };

interface HyperLaunchNative {
  takePendingAction(): Record<string, unknown>;
  addListener?(eventName: 'launchAction', listener: () => void): Subscription;
}

// Absent from a development build made before this module: calls then do nothing.
let loaded: HyperLaunchNative | null | undefined;
const native = () => (loaded === undefined ? (loaded = requireOptionalNativeModule<HyperLaunchNative>('HyperLaunch')) : loaded);

/** The press iOS is keeping ({ action, atMs }), removed as it is read. */
export function takePendingAction(): unknown {
  return native()?.takePendingAction() ?? null;
}

/** Called when a press arrives while the app runs; read it with takePendingAction. */
export function addLaunchActionListener(listener: () => void): Subscription {
  return native()?.addListener?.('launchAction', listener) ?? { remove: () => {} };
}
