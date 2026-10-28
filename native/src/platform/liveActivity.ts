// Replaces ../src/lib/liveActivity.ts (see metro.config.js): the workout's Live
// Activity through this app's own module (modules/hyper-activity), with the
// ordering rules shared with the web app (src/lib/workoutActivitySync.ts).
// Unlike the web shell, a paused rest shows on the card.
import { createWorkoutActivitySync } from '@/lib/workoutActivitySync';

import * as HyperActivity from '../../modules/hyper-activity';

export type { WorkoutActivityRest, WorkoutActivityState } from '@/lib/workoutActivitySync';

const activity = createWorkoutActivitySync(HyperActivity);

export const syncWorkoutActivity = activity.syncWorkoutActivity;
export const syncWorkoutActivityRest = activity.syncWorkoutActivityRest;
export const endWorkoutActivity = activity.endWorkoutActivity;
