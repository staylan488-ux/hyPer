import { endOfWeek, format, startOfWeek } from 'date-fns';

import type { MuscleGroup, MuscleVolume, VolumeLandmark } from '@/types';
import { classifyVolume } from '@/lib/volumeStatus';
import { TRAINING_WEEK } from '@/lib/workoutSessions';

export type CompletedSetRow = {
  exercise: {
    muscle_group: MuscleGroup;
    muscle_group_secondary: MuscleGroup | null;
  } | null;
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

type LandmarkValues = Pick<VolumeLandmark, 'mv' | 'mev' | 'mav_low' | 'mav_high' | 'mrv'>;

/**
 * The default landmarks from the schema's seed (supabase/schema.sql). Only
 * accounts that existed when the seed ran have rows, so a newer account, or a
 * muscle missing from its rows, is graded against these. Traps has no
 * default anywhere, so it is counted but not graded.
 */
export const DEFAULT_VOLUME_LANDMARKS: Partial<Record<MuscleGroup, LandmarkValues>> = {
  chest: { mv: 0, mev: 8, mav_low: 10, mav_high: 16, mrv: 22 },
  back: { mv: 0, mev: 8, mav_low: 12, mav_high: 18, mrv: 25 },
  shoulders: { mv: 0, mev: 4, mav_low: 6, mav_high: 10, mrv: 16 },
  side_delts: { mv: 0, mev: 6, mav_low: 10, mav_high: 16, mrv: 22 },
  rear_delts: { mv: 0, mev: 4, mav_low: 6, mav_high: 10, mrv: 14 },
  front_delts: { mv: 0, mev: 2, mav_low: 4, mav_high: 6, mrv: 10 },
  biceps: { mv: 0, mev: 6, mav_low: 10, mav_high: 14, mrv: 20 },
  triceps: { mv: 0, mev: 6, mav_low: 10, mav_high: 14, mrv: 20 },
  quads: { mv: 0, mev: 6, mav_low: 8, mav_high: 14, mrv: 20 },
  hamstrings: { mv: 0, mev: 4, mav_low: 6, mav_high: 10, mrv: 16 },
  glutes: { mv: 0, mev: 4, mav_low: 6, mav_high: 10, mrv: 16 },
  calves: { mv: 0, mev: 4, mav_low: 6, mav_high: 10, mrv: 16 },
  core: { mv: 0, mev: 4, mav_low: 6, mav_high: 10, mrv: 16 },
};

function landmarkFor(muscle_group: MuscleGroup, volumeLandmarks: VolumeLandmark[]): VolumeLandmark | undefined {
  const own = volumeLandmarks.find((landmark) => landmark.muscle_group === muscle_group);
  if (own) return own;
  const fallback = DEFAULT_VOLUME_LANDMARKS[muscle_group];
  return fallback ? { id: `default-${muscle_group}`, user_id: '', muscle_group, ...fallback } : undefined;
}

// Counts this week's completed sets per muscle (1 for the primary muscle,
// 0.5 for the secondary) and grades each muscle against its landmark, or the
// default one.
// Muscles keep the order they were first seen in; the heat map and the
// Today insight's tie-breaking rely on it.
export function computeWeeklyVolume(
  workouts: WeeklyVolumeWorkoutRow[],
  volumeLandmarks: VolumeLandmark[]
): MuscleVolume[] {
  const volumeMap = new Map<MuscleGroup, number>();

  for (const workout of workouts) {
    for (const set of workout.sets) {
      if (!set.completed || !set.exercise) continue;

      const primaryMuscle = set.exercise.muscle_group;
      const secondaryMuscle = set.exercise.muscle_group_secondary;

      volumeMap.set(primaryMuscle, (volumeMap.get(primaryMuscle) ?? 0) + 1);
      if (secondaryMuscle) {
        volumeMap.set(secondaryMuscle, (volumeMap.get(secondaryMuscle) ?? 0) + 0.5);
      }
    }
  }

  const weeklyVolume: MuscleVolume[] = [];

  for (const [muscle_group, weekly_sets] of volumeMap) {
    const landmark = landmarkFor(muscle_group, volumeLandmarks);
    // Nothing to grade against: counted, not graded.
    const status = landmark ? classifyVolume(weekly_sets, landmark) : null;

    weeklyVolume.push({ muscle_group, weekly_sets, landmark, status });
  }

  return weeklyVolume;
}
