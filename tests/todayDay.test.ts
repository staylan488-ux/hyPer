import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };

// Each table answers with the next queued result; filters are recorded.
const supabaseMock = vi.hoisted(() => {
  const state = {
    user: { id: 'user-1' } as { id: string } | null,
    results: new Map<string, Result>(),
    filters: [] as Array<[string, string, unknown]>,
  };
  const from = (table: string) => {
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { state.filters.push([table, column, value]); return query; },
      gte: (column: string, value: unknown) => { state.filters.push([table, `${column}>=`, value]); return query; },
      lte: (column: string, value: unknown) => { state.filters.push([table, `${column}<=`, value]); return query; },
      in: () => query,
      limit: () => query,
      then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(state.results.get(table) ?? { data: [], error: null }).then(resolve, reject),
    };
    return query;
  };
  return {
    state,
    client: {
      from,
      auth: { getSession: async () => ({ data: { session: state.user ? { user: state.user } : null }, error: null }) },
    },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock.client }));

import { EMPTY_TOTALS, readTodayDay, recallTodayDay, rememberTodayDay } from '@/lib/todayDay';

const DAY = '2026-09-30';

beforeEach(() => {
  supabaseMock.state.user = { id: 'user-1' };
  supabaseMock.state.results = new Map();
  supabaseMock.state.filters = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('readTodayDay', () => {
  it('sums the day\'s logged food and reports a completed session', async () => {
    supabaseMock.state.results.set('nutrition_logs', {
      data: [{ food_id: 'oats', servings: 2 }, { food_id: 'egg', servings: 1 }],
      error: null,
    });
    supabaseMock.state.results.set('foods', {
      data: [
        { id: 'oats', calories: 150, protein: 5, carbs: 27, fat: 3 },
        { id: 'egg', calories: 70, protein: 6, carbs: 0, fat: 5 },
      ],
      error: null,
    });
    supabaseMock.state.results.set('workouts', { data: [{ id: 'w1', split_day_id: null }], error: null });

    await expect(readTodayDay(DAY)).resolves.toEqual({
      nutritionTotals: { calories: 370, protein: 16, carbs: 54, fat: 11 },
      todayDone: { title: 'Session complete' },
    });
    // The shared log loader pins the range to exactly this day.
    expect(supabaseMock.state.filters).toContainEqual(['nutrition_logs', 'date>=', DAY]);
    expect(supabaseMock.state.filters).toContainEqual(['nutrition_logs', 'date<=', DAY]);
    expect(supabaseMock.state.filters).toContainEqual(['workouts', 'date', DAY]);
  });

  it('reads an empty day as zero, not as a failure', async () => {
    await expect(readTodayDay(DAY)).resolves.toEqual({ nutritionTotals: EMPTY_TOTALS, todayDone: null });
  });

  it.each([
    ['food logs', 'nutrition_logs'],
    ['foods', 'foods'],
    ['workouts', 'workouts'],
  ])('fails the whole day when the %s read errors, so the refresh keeps the old day', async (_label, table) => {
    supabaseMock.state.results.set('nutrition_logs', { data: [{ food_id: 'oats', servings: 1 }], error: null });
    supabaseMock.state.results.set('foods', { data: [{ id: 'oats', calories: 150, protein: 5, carbs: 27, fat: 3 }], error: null });
    supabaseMock.state.results.set(table, { data: null, error: { message: 'Failed to fetch' } });

    await expect(readTodayDay(DAY)).resolves.toBeNull();
  });

  it('fails when there is no signed-in user', async () => {
    supabaseMock.state.user = null;
    await expect(readTodayDay(DAY)).resolves.toBeNull();
  });
});

describe('remembered Today', () => {
  const day = { nutritionTotals: { calories: 1800, protein: 140, carbs: 180, fat: 60 }, todayDone: null };

  it('returns the last read for the same account, day and live workout', () => {
    rememberTodayDay('user-1', DAY, day, 'workout-1', 4);

    expect(recallTodayDay('user-1', DAY, 'workout-1', 4)).toEqual(day);
  });

  it('misses for another account, another day, or no account', () => {
    rememberTodayDay('user-1', DAY, day, null, 4);

    expect(recallTodayDay('user-2', DAY, null, 4)).toBeNull();
    expect(recallTodayDay('user-1', '2026-10-01', null, 4)).toBeNull();
    expect(recallTodayDay(undefined, DAY, null, 4)).toBeNull();
  });

  it('keeps the totals but leaves done unknown once the live workout changed', () => {
    rememberTodayDay('user-1', DAY, day, 'workout-1', 4);

    // Finished since the read: whether today is done must be read again.
    expect(recallTodayDay('user-1', DAY, null, 4)).toEqual({ nutritionTotals: day.nutritionTotals, todayDone: undefined });
  });

  it('leaves done unknown after a workout write even with no live workout on either side', () => {
    rememberTodayDay('user-1', DAY, day, null, 4);

    // Started and finished since the read: the live workout is null again.
    expect(recallTodayDay('user-1', DAY, null, 8)).toEqual({ nutritionTotals: day.nutritionTotals, todayDone: undefined });
  });
});
