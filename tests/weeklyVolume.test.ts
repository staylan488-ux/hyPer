import { describe, expect, it } from 'vitest';

import { computeWeeklyVolume, DEFAULT_VOLUME_LANDMARKS, trainingWeekRange, type WeeklyVolumeWorkoutRow } from '@/lib/weeklyVolume';
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
      { muscle_group: 'triceps', weekly_sets: 2.5, landmark: expect.objectContaining({ muscle_group: 'triceps', mev: 6 }), status: 'below_mev' },
    ]);
  });

  // A new account has no landmark rows (only the schema's one-time seed made
  // them), so every muscle used to read "Under-stimulated · Add ~1 set".
  it('grades a muscle with no landmark row against the schema seed’s defaults', () => {
    const [biceps] = computeWeeklyVolume([{ sets: sets(30, 'biceps') }], []);
    expect(biceps).toMatchObject({
      muscle_group: 'biceps', weekly_sets: 30, status: 'above_mrv',
      landmark: { muscle_group: 'biceps', mv: 0, mev: 6, mav_low: 10, mav_high: 14, mrv: 20 },
    });
    const [quads] = computeWeeklyVolume([{ sets: sets(10, 'quads') }], []);
    expect(quads).toMatchObject({ status: 'mav' });
  });

  it('keeps the account’s own landmark over the default', () => {
    const [chest] = computeWeeklyVolume([{ sets: sets(9, 'chest') }], [landmark('chest')]);
    expect(chest).toMatchObject({ status: 'mev_mav', landmark: landmark('chest') });
  });

  it('leaves a muscle with no landmark anywhere ungraded', () => {
    const [traps] = computeWeeklyVolume([{ sets: sets(4, 'traps') }], []);
    expect(traps).toEqual({ muscle_group: 'traps', weekly_sets: 4, landmark: undefined, status: null });
  });

  it('has the schema seed’s defaults for every muscle but traps', () => {
    expect(Object.keys(DEFAULT_VOLUME_LANDMARKS).sort()).toEqual([
      'back', 'biceps', 'calves', 'chest', 'core', 'front_delts', 'glutes', 'hamstrings', 'quads', 'rear_delts', 'shoulders', 'side_delts', 'triceps',
    ]);
  });

  it('keeps muscles in first-seen order', () => {
    const workouts: WeeklyVolumeWorkoutRow[] = [
      { sets: [...sets(1, 'back', 'biceps'), ...sets(1, 'chest')] },
      { sets: sets(4, 'biceps') },
    ];
    expect(computeWeeklyVolume(workouts, []).map((entry) => entry.muscle_group)).toEqual(['back', 'biceps', 'chest']);
  });
});

describe('trainingWeekRange', () => {
  it('runs Monday to Sunday, keeping Sunday in the week that ends that day', () => {
    // Local-time dates so the machine's time zone cannot shift the day.
    expect(trainingWeekRange(new Date(2026, 8, 27, 23, 59))).toEqual({ weekStart: '2026-09-21', weekEnd: '2026-09-27' });
    expect(trainingWeekRange(new Date(2026, 8, 28, 0, 0))).toEqual({ weekStart: '2026-09-28', weekEnd: '2026-10-04' });
    expect(trainingWeekRange(new Date(2026, 9, 3, 12))).toEqual({ weekStart: '2026-09-28', weekEnd: '2026-10-04' });
  });
});
