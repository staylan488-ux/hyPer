import type { MuscleGroup, MuscleVolume, VolumeLandmark } from '@/types';
import { classifyVolume } from '@/lib/volumeStatus';

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

// Counts this week's completed sets per muscle (1 for the primary muscle,
// 0.5 for the secondary) and grades each muscle against its landmark.
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
    const landmark = volumeLandmarks.find(l => l.muscle_group === muscle_group);

    // A muscle without landmarks stays 'below_mev'.
    let status: MuscleVolume['status'] = 'below_mev';
    if (landmark) status = classifyVolume(weekly_sets, landmark);

    weeklyVolume.push({ muscle_group, weekly_sets, landmark, status });
  }

  return weeklyVolume;
}
