// The first-time replay. For each movement's first session in a history, the
// targets its later sets would have shown (each worked out from the set
// before it, unrated: older ratings were carried over, not chosen), set
// beside what was logged; and the start a close relative would have given.
// Always runs over the preview sample data. Point HYPER_REPLAY_FILE at a real
// history export (kept outside the repo) to print its report:
//   HYPER_REPLAY_FILE=/path/to/history.json npx vitest run tests/firstTimeReplay.test.ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { closeRelatives, startFromRelatives } from '@/lib/firstTimeTargets';
import { buildMovementHistory } from '@/lib/previousSetTargets';
import { liveSetTarget, planFirstTime, setReachesTarget, type LoggedSet, type RepRange, type SetTarget } from '@/lib/setTargets';
import { previewHistoryWorkouts, previewSplit } from '@/preview/previewData';

import type { ReplayInput } from './helpers/setTargetReplay';

type Row = {
  date: string;
  exercise: string;
  range: RepRange | null;
  /** The relative's start, beside set 1 as logged. */
  start: { weight: number; reps: number; from: string } | null;
  done: Array<{ weight: number; reps: number }>;
  /** Targets for sets 2 on, each from the set logged before it. */
  targets: Array<SetTarget | null>;
};

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

function replayFirstTimes(input: ReplayInput): Row[] {
  const workouts = [...input.workouts].sort((a, b) => b.date.localeCompare(a.date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const history = buildMovementHistory(workouts, input.sets.filter((set) => set.completed).map((set) => ({ ...set, completed: true })));
  const ranges = new Map<string, RepRange>();
  for (const item of input.program) {
    if (ranges.has(item.exercise_id) && !item.is_active) continue;
    if (typeof item.target_reps_min === 'number' && typeof item.target_reps_max === 'number' && item.target_reps_min > 0) {
      ranges.set(item.exercise_id, { min: item.target_reps_min, max: item.target_reps_max });
    }
  }
  const rows: Row[] = [];
  for (const exercise of input.exercises) {
    const sessions = history[exercise.id];
    if (!sessions || sessions.length === 0) continue;
    const first = sessions[sessions.length - 1];
    const range = ranges.get(exercise.id) ?? null;
    const logged: LoggedSet[] = first.sets.map((set) => (set && typeof set.weight === 'number' && typeof set.reps === 'number' && set.reps > 0 ? { weight: set.weight, reps: set.reps } : null));
    const relatives = closeRelatives(exercise, input.exercises).flatMap((relative) => {
      const before = (history[relative.id] ?? []).filter((session) => session.date < first.date);
      return before.length > 0 ? [{ exercise: relative, history: before }] : [];
    });
    const start = startFromRelatives({ range, today: first.date, relatives });
    const plan = planFirstTime({ setCount: logged.length, range, equipment: exercise.equipment, start, step: start?.step });
    rows.push({
      date: first.date,
      exercise: exercise.name,
      range,
      start,
      done: logged.flatMap((set) => (set ? [{ weight: set.weight, reps: set.reps }] : [])),
      targets: logged.map((_, index) => (index === 0 ? null : liveSetTarget(plan, logged, index + 1))),
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Nothing the card could not show: a weight at or above zero and whole reps of one or more. */
function badTargets(rows: Row[]): string[] {
  return rows.flatMap((row) => row.targets.flatMap((target) => (
    target && (!(target.weight >= 0) || !Number.isInteger(target.reps) || target.reps < 1) ? [`${row.exercise}: ${target.weight} × ${target.reps}`] : []
  )));
}

function report(rows: Row[]): string {
  const figures = (set: { weight: number; reps: number }) => `${set.weight} × ${set.reps}`;
  let compared = 0;
  let reached = 0;
  let sameWeight = 0;
  let sameWeightReached = 0;
  const lines = rows.map((row) => {
    const sets = row.done.map((done, index) => {
      const target = row.targets[index];
      if (!target || index === 0) return figures(done);
      compared += 1;
      const hit = setReachesTarget(done, target);
      if (hit) reached += 1;
      if (Math.abs(done.weight - target.weight) < 0.01) {
        sameWeight += 1;
        if (hit) sameWeightReached += 1;
      }
      const why = target.why.kind === 'found' ? target.why.move : target.why.kind;
      return `${figures(done)} (target ${figures(target)}, ${why}${hit ? '' : ', short'})`;
    });
    const range = row.range ? `${row.range.min}–${row.range.max}` : 'no range';
    const start = row.start ? ` | start ${figures(row.start)} from ${row.start.from}` : '';
    return `${row.date} ${row.exercise} [${range}]${start}: ${sets.join(' · ')}`;
  });
  return [
    ...lines,
    `${rows.length} first sessions; ${rows.filter((row) => row.start).length} with a start from a relative`,
    `${compared} later sets with a target: ${reached} reached it`,
    `${sameWeight} of them done at the target's weight: ${sameWeightReached} reached it`,
  ].join('\n');
}

describe('first-time replay', () => {
  it('runs over the preview history without a bad target', () => {
    const rows = replayFirstTimes(previewInput());
    expect(rows.length).toBeGreaterThan(0);
    expect(badTargets(rows)).toEqual([]);
  });

  const file = process.env.HYPER_REPLAY_FILE;
  it.runIf(Boolean(file))('reports on a real history export', () => {
    const rows = replayFirstTimes(JSON.parse(readFileSync(file!, 'utf8')) as ReplayInput);
    expect(badTargets(rows)).toEqual([]);
    console.log(`\n${report(rows)}`);
  });
});
