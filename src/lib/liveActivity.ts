import { Capacitor, registerPlugin } from '@capacitor/core';
import { withTimeout } from '@/lib/withTimeout';

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

// Native sync/end resolve only once ActivityKit has applied them, but each
// runs as its own Swift Task. Chaining them here keeps them in call order, so
// an older snapshot can never land last and a sync can never follow end().
let tail: Promise<void> = Promise.resolve();
// The one queued sync not yet sent. It reads the state when it runs, so pushes
// made meanwhile collapse into it; end() drops it.
let queuedSync: object | null = null;
// A native call that never settles must not freeze every later update.
const STEP_TIMEOUT_MS = 10_000;

function enqueue(step: () => Promise<void> | void): void {
  tail = tail.then(() => withTimeout(Promise.resolve(step()), STEP_TIMEOUT_MS, 'Live Activity call timed out')).catch(() => {
    // The activity is garnish on top of the in-app session — fail quietly.
  });
}

function push(): void {
  if (!sessionState || queuedSync) return;

  const token = {};
  queuedSync = token;
  enqueue(() => {
    if (queuedSync !== token) return;
    queuedSync = null;
    if (!sessionState) return;
    return WorkoutActivity.sync({
      ...sessionState,
      restStartedAtEpochMs: restState?.startedAtEpochMs,
      restEndsAtEpochMs: restState?.endsAtEpochMs,
    });
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
  queuedSync = null;
  enqueue(() => WorkoutActivity.end());
}
