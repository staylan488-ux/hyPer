import { describe, expect, it } from 'vitest';

import { classifyVolume } from '@/lib/volumeStatus';
import { previewWeeklyVolume } from '@/preview/previewData';

// The preview once typed Side Delts as "over ceiling" at 21 sets against an
// MRV of 22, a status the app's own rule never produces. Preview volume must
// be graded by the same rule as live data.
describe('preview weekly volume', () => {
  it('grades every muscle with the live volume rule', () => {
    for (const entry of previewWeeklyVolume) {
      expect(entry.landmark).toBeDefined();
      expect(entry.status, entry.muscle_group).toBe(classifyVolume(entry.weekly_sets, entry.landmark!));
    }
  });

  it('only calls a muscle over its ceiling at or past its MRV', () => {
    const over = previewWeeklyVolume.filter((entry) => entry.status === 'above_mrv');
    expect(over.length).toBeGreaterThan(0);
    for (const entry of over) expect(entry.weekly_sets).toBeGreaterThanOrEqual(entry.landmark!.mrv);
  });
});
