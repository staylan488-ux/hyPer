import { describe, expect, it } from 'vitest';

import { computeWeeklyVolume, trainingWeekRange, volumeSets, type WeeklyVolumeWorkoutRow } from '@/lib/weeklyVolume';
import type { MuscleGroup } from '@/types';

function sets(
  count: number,
  muscle_group: MuscleGroup,
  muscle_group_secondary: MuscleGroup | null = null,
  completed = true
): WeeklyVolumeWorkoutRow['sets'] {
  return Array.from({ length: count }, () => ({ completed, exercise: { muscle_group, muscle_group_secondary } }));
}

describe('computeWeeklyVolume', () => {
  it('counts a half set for the secondary muscle and skips incomplete sets', () => {
    const workouts: WeeklyVolumeWorkoutRow[] = [
      { sets: [...sets(3, 'chest', 'triceps'), ...sets(2, 'chest', 'triceps', false)] },
      { sets: [{ completed: true, exercise: null }, ...sets(1, 'triceps')] },
    ];
    expect(computeWeeklyVolume(workouts)).toEqual([
      { muscle_group: 'chest', weekly_sets: 3 },
      { muscle_group: 'triceps', weekly_sets: 2.5 },
    ]);
  });

  it('counts shoulders as front delts, and names the live library’s other values as the app does', () => {
    const workouts: WeeklyVolumeWorkoutRow[] = [
      { sets: [...sets(3, 'shoulders', 'triceps'), ...sets(2, 'front_delts'), ...sets(2, 'abs' as MuscleGroup), ...sets(1, 'forearms' as MuscleGroup)] },
    ];
    expect(computeWeeklyVolume(workouts)).toEqual([
      { muscle_group: 'front_delts', weekly_sets: 5 },
      { muscle_group: 'triceps', weekly_sets: 1.5 },
      { muscle_group: 'core', weekly_sets: 2 },
      { muscle_group: 'forearms', weekly_sets: 1 },
    ]);
  });

  it('keeps muscles in first-seen order', () => {
    const workouts: WeeklyVolumeWorkoutRow[] = [
      { sets: [...sets(1, 'back', 'biceps'), ...sets(1, 'chest')] },
      { sets: sets(4, 'biceps') },
    ];
    expect(computeWeeklyVolume(workouts).map((entry) => entry.muscle_group)).toEqual(['back', 'biceps', 'chest']);
  });

  it('reads back as counts per muscle', () => {
    expect([...volumeSets([{ muscle_group: 'chest', weekly_sets: 3 }, { muscle_group: 'back', weekly_sets: 2.5 }])]).toEqual([['chest', 3], ['back', 2.5]]);
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
