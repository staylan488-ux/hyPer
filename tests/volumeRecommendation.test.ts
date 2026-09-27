import { describe, expect, it } from 'vitest';

import { classifyVolume, getVolumeRecommendation } from '@/lib/volumeStatus';
import { computeWeeklyVolume, type WeeklyVolumeWorkoutRow } from '@/lib/weeklyVolume';
import type { VolumeLandmark } from '@/types';

describe('getVolumeRecommendation', () => {
  const landmark = { mev: 6, mav_low: 10, mav_high: 16, mrv: 20 };

  it('flags below MEV volumes', () => {
    expect(getVolumeRecommendation(5, landmark).status).toBe('below_mev');
  });

  it('flags maintenance-to-MAV-low volumes', () => {
    expect(getVolumeRecommendation(8, landmark).status).toBe('mev_mav');
  });

  it('flags MAV range volumes', () => {
    expect(getVolumeRecommendation(12, landmark).status).toBe('mav');
  });

  it('flags approaching MRV volumes', () => {
    expect(getVolumeRecommendation(18, landmark).status).toBe('approaching_mrv');
  });

  it('flags above MRV volumes', () => {
    expect(getVolumeRecommendation(21, landmark).status).toBe('above_mrv');
  });

  it.each([
    [5.5, 'below_mev'],
    [6, 'mev_mav'],
    [9.5, 'mev_mav'],
    [10, 'mav'],
    [16, 'mav'],
    [16.5, 'approaching_mrv'],
    [19.5, 'approaching_mrv'],
    [20, 'above_mrv'],
  ])('classifies the exact boundary %s as %s', (weeklySets, status) => {
    expect(getVolumeRecommendation(weeklySets, landmark).status).toBe(status);
  });

  it('keeps the recommendation messages', () => {
    expect(getVolumeRecommendation(5.5, landmark).message).toBe(
      'Below minimum effective volume (5.5/6 sets). Add more sets to stimulate growth.'
    );
    expect(getVolumeRecommendation(8, landmark).message).toBe(
      'In maintenance range. Consider adding sets to optimize hypertrophy.'
    );
    expect(getVolumeRecommendation(12, landmark).message).toBe(
      'Optimal volume range! Keep consistent for best results.'
    );
    expect(getVolumeRecommendation(18, landmark).message).toBe(
      'High volume zone. Monitor fatigue and consider a deload if recovery suffers.'
    );
    expect(getVolumeRecommendation(21, landmark).message).toBe(
      'Exceeding recoverable volume. Reduce sets or take a deload week to prevent overtraining.'
    );
  });
});

describe('volume status parity', () => {
  const landmark: VolumeLandmark = {
    id: 'lm-chest',
    user_id: 'user-1',
    muscle_group: 'chest',
    mv: 4,
    mev: 6,
    mav_low: 10,
    mav_high: 16,
    mrv: 20,
  };

  it('gives the weekly volume chip and the recommendation caption the same status', () => {
    for (let halfSets = 0; halfSets <= 50; halfSets += 1) {
      const primary = Math.floor(halfSets / 2);
      const secondary = halfSets % 2;
      const workouts: WeeklyVolumeWorkoutRow[] = [
        {
          sets: [
            ...Array.from({ length: primary }, () => ({
              completed: true,
              exercise: { muscle_group: 'chest' as const, muscle_group_secondary: null },
            })),
            ...Array.from({ length: secondary }, () => ({
              completed: true,
              exercise: { muscle_group: 'back' as const, muscle_group_secondary: 'chest' as const },
            })),
          ],
        },
      ];
      const chest = computeWeeklyVolume(workouts, [landmark]).find((mv) => mv.muscle_group === 'chest');
      const weeklySets = halfSets / 2;
      const expected = classifyVolume(weeklySets, landmark);

      if (weeklySets === 0) {
        expect(chest).toBeUndefined();
        continue;
      }
      expect(chest?.weekly_sets).toBe(weeklySets);
      expect(chest?.status).toBe(expected);
      expect(getVolumeRecommendation(weeklySets, landmark).status).toBe(expected);
    }
  });
});
