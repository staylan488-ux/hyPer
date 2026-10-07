import { describe, expect, it } from 'vitest';

import { classifyVolume } from '@/lib/volumeStatus';
import { trainingWeekRange } from '@/lib/weeklyVolume';
import { previewCurrentWorkout, previewHistoryWorkouts, previewWeeklyVolume } from '@/preview/previewData';

// The preview once typed Side Delts as "over ceiling" at 21 sets against an
// MRV of 22, a status the app's own rule never produces, and later showed
// about 70 sets in a week of 1.1 lifting hours. Preview volume must be
// counted from the seeded sessions and graded by the same rule as live data.
describe('preview weekly volume', () => {
  it('grades every muscle with the live volume rule', () => {
    for (const entry of previewWeeklyVolume) {
      expect(entry.landmark, entry.muscle_group).toBeDefined();
      expect(entry.status, entry.muscle_group).toBe(classifyVolume(entry.weekly_sets, entry.landmark!));
    }
  });

  it("counts only this week's completed sets from the seeded sessions", () => {
    const { weekStart, weekEnd } = trainingWeekRange(new Date());
    const sets = [...previewHistoryWorkouts, previewCurrentWorkout]
      .filter((workout) => workout.date >= weekStart && workout.date <= weekEnd)
      .flatMap((workout) => workout.sets ?? [])
      .filter((set) => set.completed && set.exercise);
    const primary = previewWeeklyVolume.reduce((total, entry) => total + entry.weekly_sets, 0);
    const secondary = sets.filter((set) => set.exercise!.muscle_group_secondary).length * 0.5;
    expect(primary).toBe(sets.length + secondary);
  });
});
