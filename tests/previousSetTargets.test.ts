import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => {
  type Result = { data: unknown; error: { message: string } | null };
  const state = {
    results: {} as Record<string, Result>,
    rows: null as Record<string, Record<string, unknown>[]> | null,
    cap: 1000,
    between: null as ((table: string) => void) | null,
    calls: [] as Array<{ table: string; chain: Array<[string, ...unknown[]]> }>,
  };

  class Query implements PromiseLike<Result> {
    private chain: Array<[string, ...unknown[]]> = [];

    constructor(private table: string) {
      state.calls.push({ table, chain: this.chain });
    }
    private record(method: string, ...args: unknown[]) { this.chain.push([method, ...args]); return this; }
    select(...args: unknown[]) { return this.record('select', ...args); }
    eq(...args: unknown[]) { return this.record('eq', ...args); }
    neq(...args: unknown[]) { return this.record('neq', ...args); }
    lte(...args: unknown[]) { return this.record('lte', ...args); }
    lt(...args: unknown[]) { return this.record('lt', ...args); }
    in(...args: unknown[]) { return this.record('in', ...args); }
    order(...args: unknown[]) { return this.record('order', ...args); }
    limit(...args: unknown[]) { return this.record('limit', ...args); }
    gt(...args: unknown[]) { return this.record('gt', ...args); }
    then<TResult1 = Result, TResult2 = never>(
      onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      if (!state.rows) return Promise.resolve(state.results[this.table] ?? { data: [], error: null }).then(onfulfilled, onrejected);
      let rows = [...(state.rows[this.table] ?? [])];
      for (const [method, column, value] of this.chain) {
        const key = String(column);
        if (method === 'eq') rows = rows.filter((row) => row[key] === value);
        if (method === 'neq') rows = rows.filter((row) => row[key] !== value);
        if (method === 'in') rows = rows.filter((row) => (value as unknown[]).includes(row[key]));
        if (method === 'gt') rows = rows.filter((row) => row[key] != null && String(row[key]) > String(value));
        if (method === 'lt') rows = rows.filter((row) => row[key] != null && String(row[key]) < String(value));
        if (method === 'lte') rows = rows.filter((row) => row[key] != null && String(row[key]) <= String(value));
      }
      const orders = this.chain.filter(([method]) => method === 'order');
      rows.sort((a, b) => {
        for (const [, column, options] of orders) {
          const comparison = String(a[String(column)]).localeCompare(String(b[String(column)]));
          if (comparison) return (options as { ascending: boolean }).ascending ? comparison : -comparison;
        }
        return 0;
      });
      const limit = this.chain.find(([method]) => method === 'limit')?.[1];
      if (typeof limit === 'number') rows = rows.slice(0, limit);
      // The API's own cap: one reply holds at most this many rows.
      rows = rows.slice(0, state.cap);
      const answer = Promise.resolve({ data: rows, error: null });
      // As a write between two requests would.
      state.between?.(this.table);
      return answer.then(onfulfilled, onrejected);
    }
  }

  return { state, from: vi.fn((table: string) => new Query(table)) };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: database.from } }));

import {
  buildPreviousSetTargets,
  exerciseIdsFromKey,
  fetchPreviousSetTargets,
  previousTargetExerciseKey,
  previousTargetRetrySignal,
} from '@/lib/previousSetTargets';
import { previousSetTarget } from '@/lib/setAutofill';
import type { PreviousSetSummary } from '@/lib/workoutProgress';

const set = (exercise_id: string) => ({ exercise_id });

function row(overrides: Partial<PreviousSetSummary> & Pick<PreviousSetSummary, 'workout_id'>): PreviousSetSummary {
  return { exercise_id: 'bench', set_number: 1, weight: 185, reps: 8, rpe: 8, ...overrides };
}

describe('previousTargetExerciseKey', () => {
  it('stays the same when sets are added or updated for existing exercises', () => {
    const before = previousTargetExerciseKey([set('bench'), set('bench'), set('row')]);
    const after = previousTargetExerciseKey([set('bench'), set('bench'), set('bench'), set('row'), set('row')]);
    expect(after).toBe(before);
  });

  it('ignores exercise order', () => {
    expect(previousTargetExerciseKey([set('row'), set('bench')])).toBe(previousTargetExerciseKey([set('bench'), set('row')]));
  });

  it('changes when an exercise is added, substituted or removed', () => {
    const base = previousTargetExerciseKey([set('bench'), set('row')]);
    expect(previousTargetExerciseKey([set('bench'), set('row'), set('squat')])).not.toBe(base);
    expect(previousTargetExerciseKey([set('incline'), set('row')])).not.toBe(base);
    expect(previousTargetExerciseKey([set('row')])).not.toBe(base);
  });

  it('round-trips to the unique exercise ids', () => {
    const ids = ['8a1c2f7e-0000-4000-8000-000000000002', '8a1c2f7e-0000-4000-8000-000000000001'];
    const key = previousTargetExerciseKey([set(ids[0]), set(ids[1]), set(ids[0])]);
    expect(exerciseIdsFromKey(key)).toEqual([...ids].sort());
  });

  it('is empty for a session with no sets', () => {
    expect(previousTargetExerciseKey([])).toBe('');
    expect(exerciseIdsFromKey('')).toEqual([]);
  });
});

describe('previousTargetRetrySignal', () => {
  const sets = (...completed: boolean[]) => completed.map((flag) => ({ completed: flag }));

  it('changes when a set is logged, added or removed', () => {
    const base = previousTargetRetrySignal(sets(true, false));
    expect(previousTargetRetrySignal(sets(true, true))).not.toBe(base);
    expect(previousTargetRetrySignal(sets(true, false, false))).not.toBe(base);
    expect(previousTargetRetrySignal(sets(true))).not.toBe(base);
  });

  it('stays the same when nothing about set count or completion changed', () => {
    expect(previousTargetRetrySignal(sets(true, false))).toBe(previousTargetRetrySignal(sets(false, true)));
    expect(previousTargetRetrySignal([])).toBe('0:0');
  });
});

describe('buildPreviousSetTargets', () => {
  it('numbers each movement from its first set even when last time was a swapped superset', () => {
    const targets = buildPreviousSetTargets(['new', 'old'], [
      row({ workout_id: 'new', set_number: 3, weight: 175 }),
      row({ workout_id: 'old', set_number: 1, weight: 100 }),
      row({ workout_id: 'new', set_number: 2, weight: 185 }),
      row({ workout_id: 'old', set_number: 2, weight: 95 }),
      row({ workout_id: 'new', exercise_id: 'row', set_number: 1, weight: 135 }),
    ]);
    expect(targets.bench).toEqual({
      1: { weight: 185, reps: 8, rpe: 8 },
      2: { weight: 175, reps: 8, rpe: 8 },
    });
    expect(targets.row[1].weight).toBe(135);
  });

  it('uses the same positions for duplicate set numbers in history and the current session', () => {
    const sets = [
      row({ workout_id: 'w1', set_number: 2, weight: 185 }),
      row({ workout_id: 'w1', set_number: 2, weight: 185 }),
      row({ workout_id: 'w1', set_number: 3, weight: 175 }),
    ];
    const targets = buildPreviousSetTargets(['w1'], sets);
    expect(targets.bench).toEqual({
      1: { weight: 185, reps: 8, rpe: 8 },
      2: { weight: 175, reps: 8, rpe: 8 },
    });
    const current = sets.map((set) => ({ ...set, set_number: Number(set.set_number) }));
    expect(previousSetTarget(current[2], current, targets)?.weight).toBe(175);
  });

  it('keeps the most recent workout for each exercise and set number', () => {
    const targets = buildPreviousSetTargets(['newest', 'middle', 'oldest'], [
      row({ workout_id: 'oldest', weight: 175 }),
      row({ workout_id: 'newest', weight: 195 }),
      row({ workout_id: 'middle', weight: 185 }),
      row({ workout_id: 'middle', set_number: 2, weight: 180 }),
      row({ workout_id: 'oldest', exercise_id: 'row', weight: 135 }),
    ]);

    expect(targets).toEqual({
      bench: {
        1: { weight: 195, reps: 8, rpe: 8 },
        2: { weight: 180, reps: 8, rpe: 8 },
      },
      row: { 1: { weight: 135, reps: 8, rpe: 8 } },
    });
  });

  it('parses a string set number and skips a non-numeric one', () => {
    const targets = buildPreviousSetTargets(['w1'], [
      row({ workout_id: 'w1', set_number: '3', weight: 200 }),
      row({ workout_id: 'w1', set_number: 'warmup', weight: 95 }),
    ]);

    expect(targets).toEqual({ bench: { 1: { weight: 200, reps: 8, rpe: 8 } } });
  });

  it('normalizes string, null and NaN metrics to a number or null', () => {
    const targets = buildPreviousSetTargets(['w1'], [
      row({ workout_id: 'w1', weight: ' 102.5 ', reps: null, rpe: Number.NaN }),
      row({ workout_id: 'w1', set_number: 2, weight: 'heavy', reps: '10', rpe: '7.5' }),
    ]);

    expect(targets.bench[1]).toEqual({ weight: 102.5, reps: null, rpe: null });
    expect(targets.bench[2]).toEqual({ weight: null, reps: 10, rpe: 7.5 });
  });

  it('ranks an unknown workout last', () => {
    const targets = buildPreviousSetTargets(['known'], [
      row({ workout_id: 'unknown', weight: 225 }),
      row({ workout_id: 'known', weight: 185 }),
    ]);
    expect(targets.bench[1].weight).toBe(185);

    const onlyUnknown = buildPreviousSetTargets(['known'], [row({ workout_id: 'unknown', weight: 225 })]);
    expect(onlyUnknown.bench[1].weight).toBe(225);
  });

  it('returns an empty map for empty input', () => {
    expect(buildPreviousSetTargets([], [])).toEqual({});
    expect(buildPreviousSetTargets(['w1'], [])).toEqual({});
  });
});

describe('fetchPreviousSetTargets', () => {
  const params = { userId: 'user-1', workoutId: 'current', date: '2026-09-26', exerciseIds: ['bench', 'row'] };

  beforeEach(() => {
    database.state.results = {};
    database.state.rows = null;
    database.state.cap = 1000;
    database.state.between = null;
    database.state.calls = [];
  });

  it('uses only strictly earlier sessions for morning and evening history, before the query limit', async () => {
    const workout = (id: string, date: string, time: string) => ({ id, user_id: 'user-1', date, created_at: `${date}T${time}:00.000Z` });
    const workouts = [
      ...Array.from({ length: 31 }, (_, index) => workout(`later-${index}`, params.date, '21:00')),
      workout('evening', params.date, '19:00'),
      workout('morning', params.date, '08:00'),
      workout('a-simultaneous', params.date, '08:00'),
      workout('yesterday', '2026-09-25', '20:00'),
      workout('older', '2026-09-24', '20:00'),
    ];
    database.state.rows = {
      workouts,
      sets: workouts.map((workout) => ({ ...row({ workout_id: workout.id, weight: workout.id === 'yesterday' ? 180 : workout.id === 'morning' ? 190 : 220 }), completed: true })),
    };
    const morning = await fetchPreviousSetTargets({ ...params, workoutId: 'morning', beforeCreatedAt: '2026-09-26T08:00:00.000Z' });
    expect(morning?.bench[1].weight).toBe(180);
    const evening = await fetchPreviousSetTargets({ ...params, workoutId: 'evening', beforeCreatedAt: '2026-09-26T19:00:00.000Z' });
    expect(evening?.bench[1].weight).toBe(190);
    // Equal start times keep the same deterministic order regardless of database row order.
    database.state.rows.workouts.reverse();
    const reordered = await fetchPreviousSetTargets({ ...params, workoutId: 'evening', beforeCreatedAt: '2026-09-26T19:00:00.000Z' });
    expect(reordered).toEqual(evening);
  });

  it('uses earlier dates only when a historical session has no recorded start time', async () => {
    database.state.rows = {
      workouts: [
        { id: 'evening', user_id: 'user-1', date: params.date, created_at: '2026-09-26T19:00:00.000Z' },
        { id: 'yesterday', user_id: 'user-1', date: '2026-09-25', created_at: '2026-09-25T19:00:00.000Z' },
      ],
      sets: [row({ workout_id: 'evening', weight: 220 }), row({ workout_id: 'yesterday', weight: 180 })].map((set) => ({ ...set, completed: true })),
    };
    const targets = await fetchPreviousSetTargets({ ...params, beforeCreatedAt: null });
    expect(targets?.bench[1].weight).toBe(180);
  });

  it('keeps unlogged slots in position without using their values as targets', async () => {
    database.state.results.workouts = { data: [{ id: 'w1' }], error: null };
    database.state.results.sets = { data: [
      { ...row({ workout_id: 'w1', set_number: 2, weight: 200 }), completed: false },
      { ...row({ workout_id: 'w1', set_number: 3, weight: 185 }), completed: true },
    ], error: null };
    await expect(fetchPreviousSetTargets(params)).resolves.toEqual({ bench: {
      2: { weight: 185, reps: 8, rpe: 8 },
    } });
  });

  it('keeps the query shape and groups the returned sets', async () => {
    database.state.results.workouts = { data: [{ id: 'w2' }, { id: 'w1' }], error: null };
    database.state.results.sets = {
      data: [
        { workout_id: 'w1', exercise_id: 'bench', set_number: 1, weight: 180, reps: 8, rpe: null, completed: true },
        { workout_id: 'w2', exercise_id: 'bench', set_number: 1, weight: 185, reps: 8, rpe: 8, completed: true },
      ],
      error: null,
    };

    await expect(fetchPreviousSetTargets(params)).resolves.toEqual({ bench: { 1: { weight: 185, reps: 8, rpe: 8 } } });
    expect(database.state.calls).toEqual([
      {
        table: 'workouts',
        chain: [
          ['select', 'id'],
          ['eq', 'user_id', 'user-1'],
          ['lte', 'date', '2026-09-26'],
          ['neq', 'id', 'current'],
          ['order', 'date', { ascending: false }],
          ['order', 'created_at', { ascending: false }],
          ['order', 'id', { ascending: false }],
          ['limit', 30],
        ],
      },
      {
        table: 'sets',
        chain: [
          ['select', 'id, workout_id, exercise_id, set_number, weight, reps, rpe, completed'],
          ['in', 'workout_id', ['w2', 'w1']],
          ['in', 'exercise_id', ['bench', 'row']],
          ['order', 'id', { ascending: true }],
          ['limit', 1000],
        ],
      },
    ]);
  });

  it('reads every set of the last 30 workouts, past the API\'s row cap, so last time is never cut off', async () => {
    // Forty bench sets in each of 30 workouts: 1,200 rows, the newest stored last.
    const workouts = Array.from({ length: 30 }, (_, index) => ({
      id: `w${String(index).padStart(2, '0')}`, user_id: 'user-1', date: `2026-08-${String(index + 1).padStart(2, '0')}`, created_at: `2026-08-${String(index + 1).padStart(2, '0')}T18:00:00.000Z`,
    }));
    database.state.rows = {
      workouts,
      sets: workouts.flatMap((workout, index) => Array.from({ length: 40 }, (_, set) => ({
        ...row({ workout_id: workout.id, set_number: set + 1, weight: 100 + index }), id: `${workout.id}-${String(set).padStart(2, '0')}`, completed: true,
      }))),
    };
    const targets = await fetchPreviousSetTargets(params);
    // The newest workout's sets, though the first reply could not hold them.
    expect(targets?.bench[1].weight).toBe(129);
    expect(targets?.bench[40].weight).toBe(129);
    expect(database.state.calls.filter((call) => call.table === 'sets')).toHaveLength(2);
  });

  it('skips no set when an earlier one is deleted between pages', async () => {
    // 25 older workouts fill the first page exactly; the newest one's sets come next.
    const workout = (id: string, day: number) => ({ id, user_id: 'user-1', date: `2026-08-${String(day).padStart(2, '0')}`, created_at: `2026-08-${String(day).padStart(2, '0')}T18:00:00.000Z` });
    const older = Array.from({ length: 25 }, (_, index) => workout(`a${String(index).padStart(2, '0')}`, index + 1));
    const newest = workout('b00', 30);
    const setsOf = (id: string, weight: (set: number) => number) => Array.from({ length: 40 }, (_, set) => ({
      ...row({ workout_id: id, set_number: set + 1, weight: weight(set) }), id: `${id}-${String(set).padStart(2, '0')}`, completed: true,
    }));
    database.state.rows = {
      workouts: [...older, newest],
      sets: [...older.flatMap((entry) => setsOf(entry.id, () => 150)), ...setsOf('b00', (set) => 200 + set)],
    };
    // An old workout's set is deleted once the first page has been read.
    let pages = 0;
    database.state.between = (table) => {
      if (table !== 'sets' || ++pages !== 1) return;
      database.state.rows!.sets = database.state.rows!.sets.filter((set) => set.id !== 'a00-00');
    };
    const targets = await fetchPreviousSetTargets(params);
    expect(targets?.bench[1].weight).toBe(200);
    expect(targets?.bench[2].weight).toBe(201);
    expect(pages).toBe(2);
  });

  it('skips the sets query when there are no earlier workouts', async () => {
    database.state.results.workouts = { data: [], error: null };
    await expect(fetchPreviousSetTargets(params)).resolves.toEqual({});
    expect(database.state.calls.map((call) => call.table)).toEqual(['workouts']);
  });

  it('reports no history as an empty map, not a failure', async () => {
    database.state.results.workouts = { data: [{ id: 'w1' }], error: null };
    database.state.results.sets = { data: [], error: null };
    await expect(fetchPreviousSetTargets(params)).resolves.toEqual({});
  });

  it('logs and reports a failure as null on query errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    database.state.results.workouts = { data: null, error: { message: 'offline' } };
    await expect(fetchPreviousSetTargets(params)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith('Error loading previous workouts for target-to-beat:', { message: 'offline' });

    database.state.results.workouts = { data: [{ id: 'w1' }], error: null };
    database.state.results.sets = { data: null, error: { message: 'timeout' } };
    await expect(fetchPreviousSetTargets(params)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith('Error loading previous sets for target-to-beat:', { message: 'timeout' });
    consoleError.mockRestore();
  });
});
