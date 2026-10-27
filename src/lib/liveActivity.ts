import { Capacitor, registerPlugin } from '@capacitor/core';
import { createWorkoutActivitySync, type WorkoutActivityBridge, type WorkoutActivityState } from '@/lib/workoutActivitySync';

export type { WorkoutActivityState } from '@/lib/workoutActivitySync';

/** Bridge to the in-app plugin (ios/App/App/RestActivityPlugin.swift): one
 *  Live Activity per workout session, on the lock screen and Dynamic Island.
 *  The ordering rules live in src/lib/workoutActivitySync.ts, shared with the
 *  native app. */
const workoutActivity = createWorkoutActivitySync(registerPlugin<WorkoutActivityBridge>('WorkoutActivity'));

/** Called by the Workout page whenever exercise/set/stats change. */
export function syncWorkoutActivity(next: WorkoutActivityState): void {
  if (!Capacitor.isNativePlatform()) return;
  workoutActivity.syncWorkoutActivity(next);
}

/** Called by the rest timer: a running rest window, or null when idle. */
export function syncWorkoutActivityRest(
  next: { startedAtIso: string; endsAtIso: string } | null,
): void {
  if (!Capacitor.isNativePlatform()) return;
  workoutActivity.syncWorkoutActivityRest(next);
}

/** Workout finished or abandoned — take the card down. */
export function endWorkoutActivity(): void {
  if (!Capacitor.isNativePlatform()) return;
  workoutActivity.endWorkoutActivity();
}
