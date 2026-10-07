import { describe, expect, it } from 'vitest';

import { pickInsight } from '@/lib/volumeInsight';
import type { MuscleVolume, VolumeLandmark } from '@/types';

const landmark = (muscle_group: VolumeLandmark['muscle_group'], mev: number): VolumeLandmark => ({
  id: muscle_group, user_id: 'u', muscle_group, mv: 0, mev, mav_low: mev + 2, mav_high: mev + 6, mrv: mev + 10,
});
const under = (muscle_group: VolumeLandmark['muscle_group'], sets: number, mev: number): MuscleVolume => ({
  muscle_group, weekly_sets: sets, status: 'below_mev', landmark: landmark(muscle_group, mev),
});

describe("Today's volume insight", () => {
  it('names the muscle furthest under its MEV (sets / MEV), not the one with the fewest sets', () => {
    const insight = pickInsight([under('glutes', 3, 6), under('calves', 3, 8), under('chest', 4, 10)]);
    expect(insight?.volume.muscle_group).toBe('calves'); // 38% of MEV, before chest 40% and glutes 50%
    expect(insight?.detail).toBe('3 sets this week — about 5 more to clear your minimum effective volume.');
  });

  it('still prefers an under-MEV muscle over one past its ceiling', () => {
    const over: MuscleVolume = { muscle_group: 'back', weekly_sets: 30, status: 'above_mrv', landmark: landmark('back', 12) };
    expect(pickInsight([over, under('chest', 9, 10)])?.volume.muscle_group).toBe('chest');
  });
});
