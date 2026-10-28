import { describe, expect, it } from 'vitest';

import { averageLoggedDays } from '@/hooks/useWeeklyNutrition';
import { buildCoachingCall, coachMuscles } from '@/lib/volumeCoaching';
import type { MuscleVolume } from '@/types';

// Progress's rules are shared by the web Coaching page and native Progress.

const landmark = { mv: 4, mev: 8, mav_low: 12, mav_high: 18, mrv: 22 };
const volume = (muscle_group: string, weekly_sets: number, status: MuscleVolume['status'], withLandmark = true) =>
  ({ muscle_group, weekly_sets, status, landmark: withLandmark ? landmark : undefined }) as unknown as MuscleVolume;

describe('coaching calls', () => {
  it('asks for the missing sets below MEV, at least one', () => {
    expect(buildCoachingCall(volume('chest', 5, 'below_mev')).headline).toBe('Add ~3 sets this week');
    expect(buildCoachingCall(volume('chest', 7.5, 'below_mev')).headline).toBe('Add ~1 set this week');
    expect(buildCoachingCall(volume('chest', 0, 'below_mev', false)).headline).toBe('Add ~1 set this week');
  });

  it('orders under, over, near, zone, building, then by sets', () => {
    const order = coachMuscles([
      volume('a', 14, 'mav'),
      volume('b', 10, 'mev_mav'),
      volume('c', 25, 'above_mrv'),
      volume('d', 3, 'below_mev'),
      volume('e', 20, 'approaching_mrv'),
      volume('f', 6, 'below_mev'),
    ]).map(({ mv }) => mv.muscle_group);
    expect(order).toEqual(['f', 'd', 'c', 'e', 'a', 'b']);
  });
});

describe('averageLoggedDays', () => {
  it('averages only days with something logged', () => {
    const days = [
      { date: '2026-10-20', calories: 2000, protein: 150 },
      { date: '2026-10-21', calories: 0, protein: 0 },
      { date: '2026-10-22', calories: 2400, protein: 0 },
    ];
    expect(averageLoggedDays(days, 'calories')).toBe(2200);
    expect(averageLoggedDays(days, 'protein')).toBe(150);
    expect(averageLoggedDays([], 'protein')).toBe(0);
  });
});
