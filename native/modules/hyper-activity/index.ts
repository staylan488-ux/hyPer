import { requireOptionalNativeModule } from 'expo';

import type { FoodAnalysisActivityPayload } from '@/lib/foodAnalysisActivitySync';
import type { RestControl } from '../../src/lib/restControls';

export type { FoodAnalysisActivityPayload, RestControl };

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
  // Absent from a development build made before the food analysis Live Activity.
  syncFoodAnalysis?(payload: FoodAnalysisActivityPayload): Promise<void>;
  endFoodAnalysis?(): Promise<void>;
  beginBackgroundTask?(name: string): string;
  endBackgroundTask?(token: string): void;
  // Absent from a development build made before the card's rest buttons.
  pendingRestControls?(): RestControl[];
  markRestControlsApplied?(sequence: number): void;
  addListener?(eventName: 'restControl', listener: () => void): Subscription;
  addListener?(eventName: 'backgroundTaskExpired', listener: (event: { token?: string }) => void): Subscription;
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

/** Shows or updates the Gemini meal analysis Live Activity. */
export function syncFoodAnalysis(payload: FoodAnalysisActivityPayload): Promise<void> {
  return native()?.syncFoodAnalysis?.(payload) ?? Promise.resolve();
}

/** Takes every meal analysis Live Activity down. */
export function endFoodAnalysis(): Promise<void> {
  return native()?.endFoodAnalysis?.() ?? Promise.resolve();
}

/** Claims iOS background execution time so an in-flight lookup survives switching apps. */
export function beginBackgroundTask(name: string): string {
  return native()?.beginBackgroundTask?.(name) ?? '';
}

/** Releases a previously claimed iOS background task token. */
export function endBackgroundTask(token: string): void {
  if (token) native()?.endBackgroundTask?.(token);
}

/** Called when iOS ends a background task because the background grace period expired. */
export function addBackgroundTaskExpiredListener(listener: (token: string) => void): Subscription {
  return (
    native()?.addListener?.('backgroundTaskExpired', (event) => {
      if (typeof event?.token === 'string' && event.token) listener(event.token);
    }) ?? { remove: () => {} }
  );
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
