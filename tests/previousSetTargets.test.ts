import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => {
  type Result = { data: unknown; error: { message: string } | null };
  const state = {
    results: {} as Record<string, Result>,
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
    in(...args: unknown[]) { return this.record('in', ...args); }
    order(...args: unknown[]) { return this.record('order', ...args); }
    limit(...args: unknown[]) { return this.record('limit', ...args); }
    then<TResult1 = Result, TResult2 = never>(
      onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(state.results[this.table] ?? { data: [], error: null }).then(onfulfilled, onrejected);
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
} from '@/lib/previousSetTargets';
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

describe('buildPreviousSetTargets', () => {
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

    expect(targets).toEqual({ bench: { 3: { weight: 200, reps: 8, rpe: 8 } } });
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
    database.state.calls = [];
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
          ['limit', 30],
        ],
      },
      {
        table: 'sets',
        chain: [
          ['select', 'workout_id, exercise_id, set_number, weight, reps, rpe, completed'],
          ['in', 'workout_id', ['w2', 'w1']],
          ['in', 'exercise_id', ['bench', 'row']],
          ['eq', 'completed', true],
        ],
      },
    ]);
  });

  it('skips the sets query when there are no earlier workouts', async () => {
    database.state.results.workouts = { data: [], error: null };
    await expect(fetchPreviousSetTargets(params)).resolves.toEqual({});
    expect(database.state.calls.map((call) => call.table)).toEqual(['workouts']);
  });

  it('logs and returns an empty map on query errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    database.state.results.workouts = { data: null, error: { message: 'offline' } };
    await expect(fetchPreviousSetTargets(params)).resolves.toEqual({});
    expect(consoleError).toHaveBeenCalledWith('Error loading previous workouts for target-to-beat:', { message: 'offline' });

    database.state.results.workouts = { data: [{ id: 'w1' }], error: null };
    database.state.results.sets = { data: null, error: { message: 'timeout' } };
    await expect(fetchPreviousSetTargets(params)).resolves.toEqual({});
    expect(consoleError).toHaveBeenCalledWith('Error loading previous sets for target-to-beat:', { message: 'timeout' });
    consoleError.mockRestore();
  });
});
