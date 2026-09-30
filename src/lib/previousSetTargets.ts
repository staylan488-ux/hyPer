import { supabase } from '@/lib/supabase';
import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { toFiniteNumber, type PreviousSetSummary, type PreviousWorkoutSummary } from '@/lib/workoutProgress';
import type { WorkoutSet } from '@/types';

/**
 * Stable key for the session's unique exercise ids. The "last time" lookup
 * excludes the current workout, so only this list (not set values or order)
 * can change its result. Exercise ids are UUIDs, so a comma join is safe.
 */
export function previousTargetExerciseKey(sets: ReadonlyArray<Pick<WorkoutSet, 'exercise_id'>>): string {
  return Array.from(new Set(sets.map((set) => set.exercise_id))).sort().join(',');
}

export function exerciseIdsFromKey(key: string): string[] {
  return key ? key.split(',') : [];
}

/**
 * Changes when a set is added, removed, completed or un-completed. Train uses
 * it to retry a failed "last time" lookup on the next set log.
 */
export function previousTargetRetrySignal(sets: ReadonlyArray<Pick<WorkoutSet, 'completed'>>): string {
  let completed = 0;
  for (const set of sets) {
    if (set.completed) completed += 1;
  }
  return `${sets.length}:${completed}`;
}

/**
 * Keeps, for each exercise and set number, the set from the most recent
 * workout (lowest index in `workoutIds`, which is ordered newest first).
 */
export function buildPreviousSetTargets(workoutIds: string[], previousSets: PreviousSetSummary[]): PreviousWorkoutSetMap {
  const workoutRank = new Map(workoutIds.map((id, index) => [id, index]));
  const bestByExerciseAndSet = new Map<string, PreviousSetSummary>();

  for (const set of previousSets) {
    const key = `${set.exercise_id}:${set.set_number}`;
    const currentBest = bestByExerciseAndSet.get(key);

    if (!currentBest) {
      bestByExerciseAndSet.set(key, set);
      continue;
    }

    const currentRank = workoutRank.get(set.workout_id) ?? Number.MAX_SAFE_INTEGER;
    const bestRank = workoutRank.get(currentBest.workout_id) ?? Number.MAX_SAFE_INTEGER;

    if (currentRank < bestRank) {
      bestByExerciseAndSet.set(key, set);
    }
  }

  const groupedTargets: PreviousWorkoutSetMap = {};

  for (const set of bestByExerciseAndSet.values()) {
    const parsedSetNumber = typeof set.set_number === 'number'
      ? set.set_number
      : Number.parseInt(String(set.set_number), 10);

    if (!Number.isFinite(parsedSetNumber)) continue;

    if (!groupedTargets[set.exercise_id]) {
      groupedTargets[set.exercise_id] = {};
    }

    groupedTargets[set.exercise_id][parsedSetNumber] = {
      weight: toFiniteNumber(set.weight),
      reps: toFiniteNumber(set.reps),
      rpe: toFiniteNumber(set.rpe),
    };
  }

  return groupedTargets;
}

/**
 * "Target to beat" for each set: completed sets from the last 30 workouts on
 * or before `date`, excluding the current one. Returns `null` on a query
 * error so the caller can tell a failure apart from "no history" (`{}`).
 */
export async function fetchPreviousSetTargets({ userId, workoutId, date, exerciseIds }: {
  userId: string;
  workoutId: string;
  date: string;
  exerciseIds: string[];
}): Promise<PreviousWorkoutSetMap | null> {
  const { data: completedWorkouts, error: workoutsError } = await supabase
    .from('workouts')
    .select('id')
    .eq('user_id', userId)
    .lte('date', date)
    .neq('id', workoutId)
    .order('date', { ascending: false })
    .limit(30);

  if (workoutsError) {
    console.error('Error loading previous workouts for target-to-beat:', workoutsError);
    return null;
  }

  const workoutIds = (completedWorkouts || []).map((workout) => (workout as PreviousWorkoutSummary).id);

  if (workoutIds.length === 0) return {};

  const { data: previousSets, error: previousSetsError } = await supabase
    .from('sets')
    .select('workout_id, exercise_id, set_number, weight, reps, rpe, completed')
    .in('workout_id', workoutIds)
    .in('exercise_id', exerciseIds)
    .eq('completed', true);

  if (previousSetsError) {
    console.error('Error loading previous sets for target-to-beat:', previousSetsError);
    return null;
  }

  return buildPreviousSetTargets(workoutIds, (previousSets || []) as PreviousSetSummary[]);
}
