import { describe, expect, it, vi } from 'vitest';

import { createMockClient } from '@/preview/mockSupabase';
import { previewTables } from '@/preview/previewData';

vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => client.from(table) } }));

import {
  buildMovementHistory,
  estimatedMax,
  fetchMovementSets,
  fetchPriorRecords,
  findNewRecords,
  type MovementRecords,
  type MovementSetRow,
} from '@/lib/movementHistory';
import type { Exercise, Split, Workout, WorkoutSet } from '@/types';

import { summarize } from '../native/src/lib/finished';
import { latestFigure, recordRows, sessionDate, setsLine, trendPointLabel, trendSummary } from '../native/src/lib/movementLines';
import { buildSessionModel } from '../native/src/lib/sessionModel';

const client = createMockClient();

// Each movement's history: every finished session, its records and whether it
// is going up, and the records a finished session broke (Session complete).

let id = 0;
/** One workout's sets of a movement: [weight, reps] each, in order. */
function session(workoutId: string, day: string, sets: Array<[number | null, number | null]>, opts: { completed?: boolean; exercise?: string; hour?: number } = {}): MovementSetRow[] {
  return sets.map(([weight, reps], index) => ({
    id: `set-${++id}`,
    workout_id: workoutId,
    exercise_id: opts.exercise ?? 'bench',
    set_number: index + 1,
    weight,
    reps,
    completed: true,
    workout: { date: day, created_at: `${day}T${String(opts.hour ?? 17).padStart(2, '0')}:00:00`, completed: opts.completed ?? true },
  }));
}

describe('a movement\'s estimated max', () => {
  it('uses the shared estimate, but a single is its own weight', () => {
    expect(estimatedMax({ weight: 225, reps: 1 })).toBe(225);
    expect(estimatedMax({ weight: 225, reps: 5 })).toBeCloseTo(262.5);
  });

  it('has none without a load or without a rep', () => {
    expect(estimatedMax({ weight: 0, reps: 12 })).toBeNull();
    expect(estimatedMax({ weight: 225, reps: 0 })).toBeNull();
  });
});

describe('a movement\'s history', () => {
  it('lists finished sessions newest first, with every logged set in order', () => {
    const history = buildMovementHistory([
      ...session('w1', '2026-10-01', [[185, 8], [185, 7]]),
      ...session('w3', '2026-10-15', [[205, 5], [195, 6], [195, 6]]),
      ...session('w2', '2026-10-08', [[195, 6]]),
      // Still live, or abandoned: not a session yet.
      ...session('live', '2026-10-20', [[225, 5]], { completed: false }),
    ]);
    expect(history.sessions.map((entry) => entry.workoutId)).toEqual(['w3', 'w2', 'w1']);
    expect(history.sessions[0].sets).toEqual([{ weight: 205, reps: 5 }, { weight: 195, reps: 6 }, { weight: 195, reps: 6 }]);
  });

  it('orders two workouts on one day by when they started', () => {
    const history = buildMovementHistory([...session('am', '2026-10-01', [[100, 5]], { hour: 7 }), ...session('pm', '2026-10-01', [[100, 5]], { hour: 18 })]);
    expect(history.sessions.map((entry) => entry.workoutId)).toEqual(['pm', 'am']);
  });

  it('leaves out the workout asked (the live one, at Finish)', () => {
    const history = buildMovementHistory([...session('w1', '2026-10-01', [[185, 8]]), ...session('w2', '2026-10-08', [[205, 8]])], { excludeWorkoutId: 'w2' });
    expect(history.sessions.map((entry) => entry.workoutId)).toEqual(['w1']);
  });

  it('keeps the records: the best estimated max, the heaviest load and when each was first reached', () => {
    const history = buildMovementHistory([
      ...session('w1', '2026-10-01', [[225, 5]]),
      // The same max again later: the record stays with the first.
      ...session('w2', '2026-10-08', [[225, 5], [245, 1]]),
      ...session('w3', '2026-10-15', [[215, 6]]),
    ]);
    expect(history.records.estMax).toMatchObject({ weight: 225, reps: 5, day: '2026-10-01', workoutId: 'w1' });
    expect(history.records.estMax?.value).toBeCloseTo(262.5);
    expect(history.records.heaviest).toMatchObject({ weight: 245, reps: 1, day: '2026-10-08' });
    expect(history.records.mostReps).toBeNull();
  });

  it('measures bodyweight work by its reps, and a 0 × 0 set by nothing', () => {
    const history = buildMovementHistory([
      ...session('w1', '2026-10-01', [[0, 8], [0, 0]], { exercise: 'pullup' }),
      ...session('w2', '2026-10-08', [[0, 11], [0, 9]], { exercise: 'pullup' }),
      ...session('w3', '2026-10-15', [[0, 0]], { exercise: 'pullup' }),
    ]);
    expect(history.mode).toBe('reps');
    expect(history.records).toMatchObject({ estMax: null, heaviest: null, mostReps: { weight: 0, reps: 11, day: '2026-10-08' } });
    // The hold-only session is still listed as logged, but draws no point.
    expect(history.sessions).toHaveLength(3);
    expect(history.sessions[0].sets).toEqual([{ weight: 0, reps: 0 }]);
    expect(history.trend.map((point) => point.value)).toEqual([8, 11]);
  });

  it('reads a set with no weight as bodyweight, and skips one with no reps', () => {
    const history = buildMovementHistory(session('w1', '2026-10-01', [[null, 10], [50, null]]));
    expect(history.sessions[0].sets).toEqual([{ weight: 0, reps: 10 }]);
  });

  it('follows the load when most sessions moved one, so a weighted movement charts its estimated max', () => {
    const history = buildMovementHistory([
      ...session('w1', '2026-10-01', [[185, 8]]),
      ...session('w2', '2026-10-08', [[0, 12]]),
      ...session('w3', '2026-10-15', [[205, 6]]),
    ]);
    expect(history.mode).toBe('load');
    expect(history.trend.map((point) => point.workoutId)).toEqual(['w1', 'w3']);
    // Bodyweight sets keep their own record beside the load's.
    expect(history.records.mostReps).toMatchObject({ reps: 12 });
  });
});

describe('records a session broke', () => {
  const bench = (weight: number, reps: number, completed = true) => ({ exercise_id: 'bench', weight, reps, completed, exercise: { name: 'Bench Press' } });
  const pullup = (reps: number) => ({ exercise_id: 'pullup', weight: 0, reps, completed: true, exercise: { name: 'Pull-up' } });
  const prior = (rows: MovementSetRow[]): MovementRecords => buildMovementHistory(rows).records;

  it('calls a higher estimated max a record, naming the set that made it', () => {
    const before = { bench: prior(session('w1', '2026-10-01', [[225, 5]])) };
    expect(findNewRecords([bench(225, 5), bench(225, 7)], before)).toEqual([{ exerciseId: 'bench', name: 'Bench Press', kind: 'max', set: { weight: 225, reps: 7 } }]);
  });

  it('calls a heavier load a record when the estimated max held', () => {
    const before = { bench: prior(session('w1', '2026-10-01', [[225, 5]])) };
    expect(findNewRecords([bench(235, 2)], before)).toEqual([{ exerciseId: 'bench', name: 'Bench Press', kind: 'heaviest', set: { weight: 235, reps: 2 } }]);
  });

  it('calls more bodyweight reps a record', () => {
    const before = { pullup: prior(session('w1', '2026-10-01', [[0, 10]], { exercise: 'pullup' })) };
    expect(findNewRecords([pullup(9), pullup(12)], before)).toEqual([{ exerciseId: 'pullup', name: 'Pull-up', kind: 'reps', set: { weight: 0, reps: 12 } }]);
  });

  it('breaks nothing on a movement\'s first session, a tie, a rounding, an unlogged set or before the read lands', () => {
    const before = { bench: prior(session('w1', '2026-10-01', [[225, 5]])), pullup: prior([]) };
    // First time: nothing to beat.
    expect(findNewRecords([pullup(20)], before)).toEqual([]);
    // Equal, and below.
    expect(findNewRecords([bench(225, 5), bench(200, 5)], before)).toEqual([]);
    // Not logged.
    expect(findNewRecords([bench(275, 5, false)], before)).toEqual([]);
    // Not read yet.
    expect(findNewRecords([bench(275, 5)], {})).toEqual([]);
  });

  it('names one record per movement, in the order the session did them', () => {
    const before = {
      bench: prior(session('w1', '2026-10-01', [[225, 5]])),
      pullup: prior(session('w1', '2026-10-01', [[0, 10]], { exercise: 'pullup' })),
    };
    const records = findNewRecords([pullup(11), bench(245, 5), bench(250, 3)], before);
    expect(records.map((record) => [record.name, record.kind])).toEqual([
      ['Pull-up', 'reps'],
      ['Bench Press', 'max'],
    ]);
  });
});

describe('the movement read', () => {
  it('reads each set with its workout\'s day and whether it finished, from the sample backend too', async () => {
    const someSet = previewTables.sets.find((row) => String(row.id).startsWith('wsh'))!;
    const rows = await fetchMovementSets([String(someSet.exercise_id)]);
    expect(rows!.length).toBeGreaterThan(0);
    expect(rows!.every((row) => row.exercise_id === someSet.exercise_id && row.completed)).toBe(true);
    const finished = rows!.find((row) => row.id === someSet.id)!;
    expect(finished.workout).toMatchObject({ completed: true });
    expect(typeof finished.workout?.date).toBe('string');
    expect(buildMovementHistory(rows!).sessions.length).toBeGreaterThan(0);
  });

  it('gives each movement its records before a workout, an empty one for a movement never done', async () => {
    const someSet = previewTables.sets.find((row) => String(row.id).startsWith('wsh'))!;
    const records = await fetchPriorRecords([String(someSet.exercise_id), 'never-done'], 'w_current');
    expect(records![String(someSet.exercise_id)].estMax).not.toBeNull();
    expect(records!['never-done']).toEqual({ estMax: null, heaviest: null, mostReps: null });
  });
});

describe('the movement page\'s words', () => {
  it('writes a session\'s sets on one line, bodyweight as reps', () => {
    expect(setsLine([{ weight: 225, reps: 5 }, { weight: 215, reps: 6 }])).toBe('225 × 5 · 215 × 6');
    expect(setsLine([{ weight: 0, reps: 12 }, { weight: 0, reps: 10 }])).toBe('12 · 10 reps');
    expect(setsLine([{ weight: 0, reps: 1 }])).toBe('1 rep');
    expect(setsLine([{ weight: 25, reps: 8 }, { weight: 0, reps: 12 }])).toBe('25 × 8 · 12 reps');
  });

  it('dates a session by how long ago it was', () => {
    expect(sessionDate('2026-11-08', '2026-11-08')).toBe('Today');
    expect(sessionDate('2026-11-07', '2026-11-08')).toBe('Sat, Nov 7');
    expect(sessionDate('2025-11-07', '2026-11-08')).toBe('Nov 7, 2025');
  });

  it('says how far the line has come since the first session', () => {
    const load = buildMovementHistory([...session('w1', '2026-03-04', [[185, 5]]), ...session('w2', '2026-11-01', [[205, 5]])]);
    expect(trendSummary(load, '2026-11-08')).toBe('+23 lb since Mar 4');
    const reps = buildMovementHistory([...session('w1', '2025-12-01', [[0, 10]]), ...session('w2', '2026-11-01', [[0, 9]])]);
    expect(trendSummary(reps, '2026-11-08')).toBe('−1 rep since Dec 1, 2025');
    const level = buildMovementHistory([...session('w1', '2026-10-01', [[185, 5]]), ...session('w2', '2026-11-01', [[185, 5]])]);
    expect(trendSummary(level, '2026-11-08')).toBe('Level since Oct 1');
    expect(trendSummary(buildMovementHistory(session('w1', '2026-10-01', [[185, 5]])), '2026-11-08')).toBe('');
  });

  it('reads a chart point as the set and its estimate, a single as itself', () => {
    expect(trendPointLabel({ set: { weight: 225, reps: 5 }, value: 262.5 }, 'load')).toBe('225 lb × 5 · est. max 263 lb');
    expect(trendPointLabel({ set: { weight: 245, reps: 1 }, value: 245 }, 'load')).toBe('245 lb × 1');
    expect(trendPointLabel({ set: { weight: 0, reps: 14 }, value: 14 }, 'reps')).toBe('14 reps');
  });

  it('lists the records once each: the heaviest is left out when it is the max\'s own set', () => {
    const same = buildMovementHistory(session('w1', '2026-10-01', [[225, 5], [205, 8]]));
    expect(recordRows(same.records, '2026-11-08').map((row) => [row.title, row.value, row.detail])).toEqual([['Est. max', '263 lb', '225 lb × 5 · Thu, Oct 1']]);
    const apart = buildMovementHistory([...session('w1', '2026-10-01', [[225, 5]]), ...session('w2', '2026-10-08', [[245, 1], [0, 15]])]);
    expect(recordRows(apart.records, '2026-11-08').map((row) => [row.title, row.value, row.detail])).toEqual([
      ['Est. max', '263 lb', '225 lb × 5 · Thu, Oct 1'],
      ['Heaviest', '245 lb × 1', 'Thu, Oct 8'],
      ['Most reps', '15 reps', 'Thu, Oct 8'],
    ]);
  });

  it('leads with the latest session\'s figure', () => {
    const load = buildMovementHistory([...session('w1', '2026-10-01', [[225, 5]]), ...session('w2', '2026-10-08', [[205, 5]])]);
    expect(latestFigure(load)).toEqual({ figure: '239', unit: 'lb', what: 'Est. max' });
    const reps = buildMovementHistory(session('w1', '2026-10-01', [[0, 1]], { exercise: 'pullup' }));
    expect(latestFigure(reps)).toEqual({ figure: '1', unit: 'rep', what: 'Most reps' });
  });
});

describe('Session complete\'s records', () => {
  const exercise = (exerciseId: string, name: string): Exercise => ({ id: exerciseId, name, muscle_group: 'chest', muscle_group_secondary: null, equipment: null, is_compound: true });
  const benchPress = exercise('bench', 'Bench Press');
  const split: Split = {
    id: 'split-1',
    user_id: 'user-1',
    name: 'Upper',
    description: null,
    days_per_week: 3,
    is_active: true,
    days: [
      {
        id: 'day-1',
        split_id: 'split-1',
        day_name: 'Upper A',
        day_order: 1,
        exercises: [{ id: 'plan-bench', split_day_id: 'day-1', exercise_id: 'bench', exercise: benchPress, target_sets: 2, target_reps_min: 5, target_reps_max: 8, exercise_order: 1, notes: null }],
      },
    ],
  };
  const set = (number: number, weight: number, reps: number): WorkoutSet => ({
    id: `live-${number}`,
    workout_id: 'live',
    exercise_id: 'bench',
    exercise: benchPress,
    set_number: number,
    weight,
    reps,
    rpe: null,
    completed: true,
    completed_at: `2026-11-08T17:${10 + number}:00.000Z`,
  });
  const workout: Workout = {
    id: 'live',
    user_id: 'user-1',
    split_day_id: 'day-1',
    date: '2026-11-08',
    notes: null,
    completed: false,
    created_at: '2026-11-08T17:00:00.000Z',
    sets: [set(1, 235, 5), set(2, 225, 5)],
  };

  it('names the records the finished session broke, and none before the read lands', () => {
    const model = buildSessionModel(workout, { split }, null)!;
    const prior = { bench: buildMovementHistory(session('w1', '2026-10-01', [[225, 5]])).records };
    expect(summarize(model, {}, new Date('2026-11-08T18:00:00.000Z'), prior).records).toEqual([
      { exerciseId: 'bench', name: 'Bench Press', kind: 'max', set: { weight: 235, reps: 5 } },
    ]);
    expect(summarize(model, {}, new Date('2026-11-08T18:00:00.000Z')).records).toEqual([]);
  });
});
