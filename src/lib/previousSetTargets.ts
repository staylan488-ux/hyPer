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
