import { requireOptionalNativeModule } from 'expo';

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

interface HyperActivityNative {
  sync(payload: WorkoutActivityPayload): Promise<void>;
  end(): Promise<void>;
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
