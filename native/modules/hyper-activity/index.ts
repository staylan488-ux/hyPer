import { requireOptionalNativeModule } from 'expo';

import type { RestControl } from '../../src/lib/restControls';

export type { RestControl };

/** What the card shows; mirrors ios/WorkoutActivityAttributes.swift. */
export type WorkoutActivityPayload = {
  exerciseName: string;
  detailLine: string;
  sessionStartedAtEpochMs: number;
  restStartedAtEpochMs?: number;
  restEndsAtEpochMs?: number;
  /** Seconds left on a paused rest. */
  restPausedSeconds?: number;
};

type Subscription = { remove: () => void };

interface HyperActivityNative {
  sync(payload: WorkoutActivityPayload): Promise<void>;
  end(): Promise<void>;
  // Absent from a development build made before the card's rest buttons.
  pendingRestControls?(): RestControl[];
  markRestControlsApplied?(sequence: number): void;
  addListener?(eventName: 'restControl', listener: () => void): Subscription;
}

// Absent from a development build made before this module: calls then do nothing.
let loaded: HyperActivityNative | null | undefined;
const native = () => (loaded === undefined ? (loaded = requireOptionalNativeModule<HyperActivityNative>('HyperActivity')) : loaded);

/** Shows or updates the workout's Live Activity. */
export function sync(payload: WorkoutActivityPayload): Promise<void> {
  return native()?.sync(payload) ?? Promise.resolve();
}

/** Takes every workout Live Activity down. */
export function end(): Promise<void> {
  return native()?.end() ?? Promise.resolve();
}

/** Taps on the card's +30 s and End rest not yet applied, oldest first. */
export function pendingRestControls(): RestControl[] {
  return native()?.pendingRestControls?.() ?? [];
}

/** The app has applied every tap up to this one. */
export function markRestControlsApplied(sequence: number): void {
  native()?.markRestControlsApplied?.(sequence);
}

/** Called when the card's rest buttons are tapped, while the app runs. */
export function addRestControlListener(listener: () => void): Subscription {
  return native()?.addListener?.('restControl', listener) ?? { remove: () => {} };
}
