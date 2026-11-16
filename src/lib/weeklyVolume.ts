import { endOfWeek, format, startOfWeek } from 'date-fns';

import { addMovementSets, type MuscleSets, type MuscleSource } from '@/lib/muscleVolume';
import { TRAINING_WEEK } from '@/lib/workoutSessions';
import type { MuscleGroup, MuscleVolume } from '@/types';

export type CompletedSetRow = {
  exercise: MuscleSource | null;
  completed: boolean;
};

export type WeeklyVolumeWorkoutRow = {
  sets: CompletedSetRow[];
};

// The Monday-to-Sunday training week containing `now`, as local
// 'yyyy-MM-dd' dates for the workouts date filter.
export function trainingWeekRange(now: Date): { weekStart: string; weekEnd: string } {
  return {
    weekStart: format(startOfWeek(now, TRAINING_WEEK), 'yyyy-MM-dd'),
    weekEnd: format(endOfWeek(now, TRAINING_WEEK), 'yyyy-MM-dd'),
  };
}

/**
 * Counts the week's completed sets per muscle: 1 for the movement's main
 * muscle and 0.5 for its second, with muscle names as src/lib/muscleVolume
 * counts them. Muscles keep the order they were first seen in.
 */
export function computeWeeklyVolume(workouts: WeeklyVolumeWorkoutRow[]): MuscleVolume[] {
  const sets: MuscleSets = new Map();
  for (const workout of workouts) {
    for (const set of workout.sets) if (set.completed) addMovementSets(sets, set.exercise, 1);
  }
  return [...sets].map(([muscle, weekly_sets]) => ({ muscle_group: muscle as MuscleGroup, weekly_sets }));
}

/** A week's volume list as counts per muscle. */
export function volumeSets(volume: readonly MuscleVolume[]): MuscleSets {
  const sets: MuscleSets = new Map();
  for (const entry of volume) sets.set(entry.muscle_group, (sets.get(entry.muscle_group) ?? 0) + entry.weekly_sets);
  return sets;
}
