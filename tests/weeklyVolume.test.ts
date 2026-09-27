import { describe, expect, it } from 'vitest';

import { computeWeeklyVolume, type WeeklyVolumeWorkoutRow } from '@/lib/weeklyVolume';
import type { MuscleGroup, VolumeLandmark } from '@/types';

function landmark(muscle_group: MuscleGroup): VolumeLandmark {
  return { id: `lm-${muscle_group}`, user_id: 'user-1', muscle_group, mv: 4, mev: 6, mav_low: 10, mav_high: 16, mrv: 20 };
}

function sets(
  count: number,
  muscle_group: MuscleGroup,
  muscle_group_secondary: MuscleGroup | null = null,
  completed = true
): WeeklyVolumeWorkoutRow['sets'] {
  return Array.from({ length: count }, () => ({ completed, exercise: { muscle_group, muscle_group_secondary } }));
}

describe('computeWeeklyVolume', () => {
  it('grades every status band with the existing thresholds', () => {
    const workouts: WeeklyVolumeWorkoutRow[] = [
      {
        sets: [
          ...sets(5, 'chest'),
          ...sets(6, 'back'),
          ...sets(16, 'quads'),
          ...sets(19, 'hamstrings'),
          ...sets(20, 'glutes'),
        ],
      },
    ];
    const landmarks = (['chest', 'back', 'quads', 'hamstrings', 'glutes'] as MuscleGroup[]).map(landmark);

    expect(computeWeeklyVolume(workouts, landmarks).map(({ muscle_group, status }) => [muscle_group, status])).toEqual([
      ['chest', 'below_mev'],
      ['back', 'mev_mav'],
      ['quads', 'mav'],
      ['hamstrings', 'approaching_mrv'],
      ['glutes', 'above_mrv'],
    ]);
  });

  it('counts a half set for the secondary muscle and skips incomplete sets', () => {
    const workouts: WeeklyVolumeWorkoutRow[] = [
      { sets: [...sets(3, 'chest', 'triceps'), ...sets(2, 'chest', 'triceps', false)] },
      { sets: [{ completed: true, exercise: null }, ...sets(1, 'triceps')] },
    ];

    expect(computeWeeklyVolume(workouts, [landmark('chest')])).toEqual([
      { muscle_group: 'chest', weekly_sets: 3, landmark: landmark('chest'), status: 'below_mev' },
      { muscle_group: 'triceps', weekly_sets: 2.5, landmark: undefined, status: 'below_mev' },
    ]);
  });

  it('defaults to below_mev with no landmark when none exists for a muscle', () => {
    const [entry] = computeWeeklyVolume([{ sets: sets(30, 'biceps') }], []);
    expect(entry).toEqual({ muscle_group: 'biceps', weekly_sets: 30, landmark: undefined, status: 'below_mev' });
  });

  it('keeps muscles in first-seen order', () => {
    const workouts: WeeklyVolumeWorkoutRow[] = [
      { sets: [...sets(1, 'back', 'biceps'), ...sets(1, 'chest')] },
      { sets: sets(4, 'biceps') },
    ];
    expect(computeWeeklyVolume(workouts, []).map((entry) => entry.muscle_group)).toEqual(['back', 'biceps', 'chest']);
  });
});
