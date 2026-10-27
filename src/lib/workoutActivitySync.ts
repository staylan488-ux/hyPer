import { withTimeout } from '@/lib/withTimeout';

/**
 * The workout's Live Activity (lock screen and Dynamic Island), kept in step
 * with the app: one card per live workout. Platform-free, so the web app's
 * Capacitor plugin (src/lib/liveActivity.ts) and the native app's Expo module
 * share these ordering rules. iOS ticks the clocks itself from absolute times;
 * updates are needed only when the state changes.
 */
export interface WorkoutActivityState {
  exerciseName: string;
  detailLine: string;
  sessionStartedAtEpochMs: number;
}

/** A running rest window, a paused rest's seconds left, or no rest. */
export type WorkoutActivityRest =
  | { startedAtIso: string; endsAtIso: string }
  | { pausedRemainingSeconds: number }
  | null;

export interface WorkoutActivityPayload extends WorkoutActivityState {
  restStartedAtEpochMs?: number;
  restEndsAtEpochMs?: number;
  /** Seconds left on a paused rest, shown still. Sent only while paused. */
  restPausedSeconds?: number;
}

export interface WorkoutActivityBridge {
  sync(options: WorkoutActivityPayload): Promise<void>;
  end(): Promise<void>;
}

export interface WorkoutActivitySync {
  /** The workout's movement, set and stats changed. */
  syncWorkoutActivity(next: WorkoutActivityState): void;
  /** The rest started, paused, resumed or ended. */
  syncWorkoutActivityRest(next: WorkoutActivityRest): void;
  /** Workout finished or abandoned: take the card down. */
  endWorkoutActivity(): void;
}

type RestState =
  | { kind: 'running'; startedAtEpochMs: number; endsAtEpochMs: number }
  | { kind: 'paused'; seconds: number };

// A native call that never settles must not freeze every later update.
const STEP_TIMEOUT_MS = 10_000;

function toRestState(next: WorkoutActivityRest, now: number): RestState | null {
  if (!next) return null;
  if ('pausedRemainingSeconds' in next) {
    const seconds = Math.round(next.pausedRemainingSeconds);
    return Number.isFinite(seconds) && seconds > 0 ? { kind: 'paused', seconds } : null;
  }
  const startedAtEpochMs = new Date(next.startedAtIso).getTime();
  const endsAtEpochMs = new Date(next.endsAtIso).getTime();
  return Number.isFinite(startedAtEpochMs) && Number.isFinite(endsAtEpochMs) && endsAtEpochMs > now
    ? { kind: 'running', startedAtEpochMs, endsAtEpochMs }
    : null;
}

export function createWorkoutActivitySync(bridge: WorkoutActivityBridge): WorkoutActivitySync {
  // Train owns the session state; the rest timer owns the rest state. Whichever
  // side updates last, the merged snapshot is what iOS renders.
  let sessionState: WorkoutActivityState | null = null;
  let restState: RestState | null = null;

  // Native sync/end resolve only once ActivityKit has applied them, but each
  // runs as its own Swift Task. Chaining them here keeps them in call order, so
  // an older snapshot can never land last and a sync can never follow end().
  let tail: Promise<void> = Promise.resolve();
  // The one queued sync not yet sent. It reads the state when it runs, so pushes
  // made meanwhile collapse into it; end() drops it.
  let queuedSync: object | null = null;

  function enqueue(step: () => Promise<void> | void): void {
    tail = tail
      .then(() => withTimeout(Promise.resolve(step()), STEP_TIMEOUT_MS, 'Live Activity call timed out'))
      .catch(() => {
        // The activity is garnish on top of the in-app session — fail quietly.
      });
  }

  function payload(session: WorkoutActivityState): WorkoutActivityPayload {
    const running = restState?.kind === 'running' ? restState : null;
    return {
      ...session,
      restStartedAtEpochMs: running?.startedAtEpochMs,
      restEndsAtEpochMs: running?.endsAtEpochMs,
      ...(restState?.kind === 'paused' ? { restPausedSeconds: restState.seconds } : {}),
    };
  }

  function push(): void {
    if (!sessionState || queuedSync) return;

    const token = {};
    queuedSync = token;
    enqueue(() => {
      if (queuedSync !== token) return;
      queuedSync = null;
      if (!sessionState) return;
      return bridge.sync(payload(sessionState));
    });
  }

  return {
    syncWorkoutActivity(next) {
      sessionState = next;
      push();
    },
    syncWorkoutActivityRest(next) {
      restState = toRestState(next, Date.now());
      push();
    },
    endWorkoutActivity() {
      sessionState = null;
      restState = null;
      queuedSync = null;
      enqueue(() => bridge.end());
    },
  };
}

/**
 * The card's second line, the same on web and native: the set that's up, sets
 * done of planned, and the session's tonnage once there is any.
 */
export function workoutActivityDetailLine({
  nextSetNumber,
  completedSets,
  totalSets,
  tonnage,
}: {
  nextSetNumber: number | null;
  completedSets: number;
  totalSets: number;
  tonnage: number;
}): string {
  return [
    nextSetNumber ? `set ${nextSetNumber}` : null,
    `${completedSets} of ${totalSets} sets`,
    tonnage > 0 ? `${Math.round(tonnage).toLocaleString('en-US')} lb` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
