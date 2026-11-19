import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Add list's week: finished sets in the week's other workouts, per muscle.

const calls: Array<[string, ...unknown[]]> = [];
let answer: { data: unknown; error: { message: string } | null } = { data: [], error: null };

vi.mock('@/lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'gte', 'lte']) {
    query[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return query;
    };
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer).then(resolve);
  return { supabase: { from: (table: string) => { calls.push(['from', table]); return query; } } };
});

import { readWeekSetsBesides } from '@/lib/weekSetsRead';

const set = (muscle: string, secondary: string | null, completed: boolean | null) => ({ completed, exercise: { muscle_group: muscle, muscle_group_secondary: secondary } });

describe('readWeekSetsBesides', () => {
  beforeEach(() => {
    calls.length = 0;
    answer = { data: [], error: null };
  });

  it('reads the training week’s workouts but the live one', async () => {
    // A Wednesday: the week runs Monday the 16th to Sunday the 22nd.
    await readWeekSetsBesides('me', 'live', new Date(2026, 10, 18, 9));
    expect(calls).toContainEqual(['from', 'workouts']);
    expect(calls).toContainEqual(['eq', 'user_id', 'me']);
    expect(calls).toContainEqual(['neq', 'id', 'live']);
    expect(calls).toContainEqual(['gte', 'date', '2026-11-16']);
    expect(calls).toContainEqual(['lte', 'date', '2026-11-22']);
  });

  it('counts finished sets only: 1 for the main muscle, half for the second', async () => {
    answer = {
      data: [
        { id: 'a', sets: [set('quads', 'glutes', true), set('quads', 'glutes', true), set('quads', 'glutes', false), set('hamstrings', null, null)] },
        { id: 'b', sets: [set('hamstrings', null, true), { completed: true, exercise: null }] },
        { id: 'c', sets: null },
      ],
      error: null,
    };
    expect(Object.fromEntries(await readWeekSetsBesides('me', 'live'))).toEqual({ quads: 2, glutes: 1, hamstrings: 1 });
  });

  it('throws when the read fails, so a failure never reads as an empty week', async () => {
    answer = { data: null, error: { message: 'offline' } };
    await expect(readWeekSetsBesides('me', 'live')).rejects.toThrow('offline');
  });
});
