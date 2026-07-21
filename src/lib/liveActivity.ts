import { Capacitor, registerPlugin } from '@capacitor/core';

/** Bridge to the in-app plugin (ios/App/App/RestActivityPlugin.swift): one
 *  Live Activity per workout session, on the lock screen and Dynamic Island.
 *  iOS ticks the clocks itself from absolute times — no updates needed
 *  between the state changes pushed here. */
interface WorkoutActivityBridge {
  sync(options: {
    exerciseName: string;
    detailLine: string;
    sessionStartedAtEpochMs: number;
    restStartedAtEpochMs?: number;
    restEndsAtEpochMs?: number;
  }): Promise<void>;
  end(): Promise<void>;
}

const WorkoutActivity = registerPlugin<WorkoutActivityBridge>('WorkoutActivity');

export interface WorkoutActivityState {
  exerciseName: string;
  detailLine: string;
  sessionStartedAtEpochMs: number;
}

// The Workout page owns the session state; the rest pill owns the rest state.
// Whichever side updates last, the merged snapshot is what iOS renders.
let sessionState: WorkoutActivityState | null = null;
let restState: { startedAtEpochMs: number; endsAtEpochMs: number } | null = null;

function push(): void {
  if (!sessionState) return;

  void WorkoutActivity.sync({
    ...sessionState,
    restStartedAtEpochMs: restState?.startedAtEpochMs,
    restEndsAtEpochMs: restState?.endsAtEpochMs,
  }).catch(() => {
    // The activity is garnish on top of the in-app session — fail quietly.
  });
}

/** Called by the Workout page whenever exercise/set/stats change. */
export function syncWorkoutActivity(next: WorkoutActivityState): void {
  if (!Capacitor.isNativePlatform()) return;
  sessionState = next;
  push();
}

/** Called by the rest timer: a running rest window, or null when idle. */
export function syncWorkoutActivityRest(
  next: { startedAtIso: string; endsAtIso: string } | null,
): void {
  if (!Capacitor.isNativePlatform()) return;

  if (next) {
    const startedAtEpochMs = new Date(next.startedAtIso).getTime();
    const endsAtEpochMs = new Date(next.endsAtIso).getTime();
    restState =
      Number.isFinite(startedAtEpochMs) && Number.isFinite(endsAtEpochMs) && endsAtEpochMs > Date.now()
        ? { startedAtEpochMs, endsAtEpochMs }
        : null;
  } else {
    restState = null;
  }
  push();
}

/** Workout finished or abandoned — take the card down. */
export function endWorkoutActivity(): void {
  if (!Capacitor.isNativePlatform()) return;

  sessionState = null;
  restState = null;
  void WorkoutActivity.end().catch(() => {});
}
