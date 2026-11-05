// Pure: whether a logged set beat the same set last time, by the shared rule
// in src/lib/workoutProgress (the one the web Train page used). No React, so
// the web test suite covers it (tests/nativeBeatLastTime.test.ts).
import { previousSetTarget, type PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { collectSessionGains, describeSetGain } from '@/lib/workoutProgress';
import type { WorkoutSet } from '@/types';

type LoggedSet = Pick<WorkoutSet, 'exercise_id' | 'set_number' | 'weight' | 'reps'>;

/** How a set beat the same set last time ("+5 lb", "+2 reps"), or null when it did not or there is no last time. */
export function gainOnLastTime(set: LoggedSet, previous: PreviousWorkoutSetMap, currentSets: readonly Pick<WorkoutSet, 'exercise_id' | 'set_number'>[]): string | null {
  const target = previousSetTarget(set, currentSets, previous);
  return target ? describeSetGain(set, target) : null;
}

/** How many logged sets in a session beat the same set last time. */
export function countBeats(sets: ReadonlyArray<LoggedSet & Pick<WorkoutSet, 'completed'>>, previous: PreviousWorkoutSetMap): number {
  return collectSessionGains([...sets], previous).length;
}
