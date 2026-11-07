import type { WorkoutActivityRest, WorkoutActivityState } from '@/lib/workoutActivitySync';

export type { WorkoutActivityRest, WorkoutActivityState } from '@/lib/workoutActivitySync';

// The workout's Live Activity. The app keeps it through
// native/src/platform/liveActivity.ts, which native/metro.config.js swaps in
// for this file (it must stay so the swap can resolve); the ordering rules are
// shared in src/lib/workoutActivitySync.ts. Outside the app there is no lock
// screen, so these do nothing.
export const syncWorkoutActivity: (next: WorkoutActivityState) => void = () => {};
export const syncWorkoutActivityRest: (next: WorkoutActivityRest) => void = () => {};
export const endWorkoutActivity: () => void = () => {};
