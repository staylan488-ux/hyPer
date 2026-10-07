import { describe, expect, it } from 'vitest';

import { byMevDeficit, pickInsight } from '@/lib/volumeInsight';
import type { MuscleVolume, VolumeLandmark } from '@/types';

const landmark = (muscle_group: VolumeLandmark['muscle_group'], mev: number): VolumeLandmark => ({
  id: muscle_group, user_id: 'u', muscle_group, mv: 0, mev, mav_low: mev + 2, mav_high: mev + 6, mrv: mev + 10,
});
const under = (muscle_group: VolumeLandmark['muscle_group'], sets: number, mev: number): MuscleVolume => ({
  muscle_group, weekly_sets: sets, status: 'below_mev', landmark: landmark(muscle_group, mev),
});

describe("Today's volume insight", () => {
  it('names the muscle needing the most sets to reach MEV, as Progress counts them', () => {
    const insight = pickInsight([under('glutes', 3, 6), under('calves', 3, 8), under('chest', 4, 10)]);
    expect(insight?.volume.muscle_group).toBe('chest'); // add 6, before calves 5 and glutes 3
    expect(insight?.headline).toBe('Chest is under-stimulated');
    expect(insight?.detail).toBe('4 sets this week — about 6 more to reach your minimum effective volume.');
  });

  it('orders Progress rows by the same key as the headline', () => {
    const rows = [under('quads', 6, 8), under('chest', 4, 10), under('calves', 3, 8), under('glutes', 3, 6)].sort(byMevDeficit);
    expect(rows.map((mv) => mv.muscle_group)).toEqual(['chest', 'calves', 'glutes', 'quads']);
  });

  it('breaks a tie in sets needed by the lowest share of MEV', () => {
    const insight = pickInsight([under('glutes', 1, 6), under('calves', 3, 8)]);
    expect(insight?.volume.muscle_group).toBe('glutes'); // both add 5: 17% of MEV before 38%
  });

  it('still prefers an under-MEV muscle over one past its ceiling', () => {
    const over: MuscleVolume = { muscle_group: 'back', weekly_sets: 30, status: 'above_mrv', landmark: landmark('back', 12) };
    expect(pickInsight([over, under('chest', 9, 10)])?.volume.muscle_group).toBe('chest');
  });
});
