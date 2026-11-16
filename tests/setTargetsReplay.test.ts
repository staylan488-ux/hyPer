// The set-target replay. Always runs over the preview sample data. Point
// HYPER_REPLAY_FILE at a real history export (kept outside the repo) to print
// its report:
//   HYPER_REPLAY_FILE=/path/to/history.json npx vitest run tests/setTargetsReplay.test.ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { previewHistoryWorkouts, previewSplit } from '@/preview/previewData';

import { checkSetTargetReplay, replaySetTargets, summarizeReplay, type ReplayInput } from './helpers/setTargetReplay';

function previewInput(): ReplayInput {
  const sets = previewHistoryWorkouts.flatMap((workout) => workout.sets);
  const exercises = [...new Map(sets.flatMap((set) => (set.exercise ? [[set.exercise.id, set.exercise] as const] : []))).values()];
  const program = previewSplit.days.flatMap((day) => day.exercises.map((item) => ({
    split_day_id: day.id,
    exercise_id: item.exercise_id,
    target_reps_min: item.target_reps_min,
    target_reps_max: item.target_reps_max,
    is_active: true,
  })));
  return { workouts: previewHistoryWorkouts, sets, exercises, program };
}

describe('set target replay', () => {
  it('runs over the preview history without a bad target', () => {
    const report = replaySetTargets(previewInput());
    expect(report.targets).toBeGreaterThan(0);
    expect(checkSetTargetReplay(report)).toEqual([]);
  });

  const file = process.env.HYPER_REPLAY_FILE;
  it.runIf(Boolean(file))('reports on a real history export', () => {
    const data = JSON.parse(readFileSync(file!, 'utf8')) as ReplayInput;
    for (const options of [
      {},
      { extraRep: 'lowest' as const },
      { margin: 0 },
      { margin: 2 },
      { extraRep: 'lowest' as const, margin: 0 },
      { follow: 'latest' as const },
    ]) {
      const report = replaySetTargets(data, options);
      expect(checkSetTargetReplay(report)).toEqual([]);
      console.log(`\n${summarizeReplay(report)}`);
    }
  });
});
