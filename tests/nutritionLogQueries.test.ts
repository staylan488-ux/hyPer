import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '@/preview/mockSupabase';
import { previewTables } from '@/preview/previewData';

const calls = {
  foodsIn: [] as number[],
  foodIds: [] as string[][],
  failFoods: false,
  failNextFoods: 0,
  failLogs: false,
  // while set, the logs request has not answered yet
  logsGate: null as Promise<void> | null,
};

vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: () => client.auth.getUser(), getSession: () => client.auth.getSession() },
  from: (table: string) => {
    const builder = client.from(table);
    const select = builder.select.bind(builder);
    if (table === 'nutrition_logs') {
      return Object.assign(builder, {
        select: (columns: string) => {
          const selected = select(columns);
          const answer = selected.then.bind(selected);
          return Object.assign(selected, {
            then: (...args: Parameters<typeof answer>) => (calls.logsGate ?? Promise.resolve()).then(() => (
              calls.failLogs
                ? Promise.resolve({ data: null, error: { message: 'logs unavailable', code: '503' } } as never).then(...args)
                : answer(...args)
            )),
          });
        },
      });
    }
    if (table !== 'foods') return builder;
    return Object.assign(builder, {
      select: (columns: string) => {
        const selected = select(columns);
        const within = selected.in.bind(selected);
        return Object.assign(selected, {
          in: (column: string, values: unknown[]) => {
            calls.foodsIn.push(values.length);
            calls.foodIds.push(values as string[]);
            if (calls.failFoods || calls.failNextFoods > 0) {
              calls.failNextFoods = Math.max(0, calls.failNextFoods - 1);
              return Promise.resolve({ data: null, error: { message: 'foods unavailable', code: '503' } });
            }
            return within(column, values);
          },
        });
      },
    });
  },
} }));
vi.mock('@/preview/flag', () => ({ isPreviewActive: () => true }));

import { FOOD_ID_CHUNK_SIZE, fetchNutritionLogsWithFoods, type NutritionLogDateRange } from '@/lib/nutritionLogQueries';
import { getDailyIntake } from '@/lib/nutritionIntake';

let client = createMockClient();
const fixture = structuredClone(previewTables);

const food = (id: string, calories: number | string) => ({
  id, user_id: 'u1', name: id, description: null, calories, protein: 10, carbs: 20, fat: 5,
  serving_size: 1, serving_unit: 'serving',
});
const log = (id: string, date: string, foodId: string, servings: number | string, userId = 'u1') => ({
  id, user_id: userId, date, food_id: foodId, servings, logged_at: null,
});

beforeEach(() => {
  for (const key of Object.keys(previewTables)) delete previewTables[key];
  Object.assign(previewTables, structuredClone(fixture));
  previewTables.foods = [food('oats', 150), food('eggs', '72.5')];
  previewTables.nutrition_logs = [
    log('l1', '2026-09-01', 'oats', 1),
    log('l2', '2026-09-01', 'eggs', '2'),
    log('l3', '2026-09-02', 'missing', 1),
    log('l4', '2026-09-03', 'oats', 0.5),
    log('l5', '2026-09-02', 'oats', 1, 'someone-else'),
  ];
  client = createMockClient();
  calls.foodsIn = [];
  calls.foodIds = [];
  calls.failFoods = false;
  calls.failNextFoods = 0;
  calls.failLogs = false;
  calls.logsGate = null;
});

describe('shared nutrition log query', () => {
  it('returns each log with its food, and food: null when the food row is missing', async () => {
    const { data, error } = await fetchNutritionLogsWithFoods<{ id: string; food_id: string }, { id: string; name: string }>(
      'u1', { from: '2026-09-01', to: '2026-09-02' }, '*', 'id, name, description, calories',
    );

    expect(error).toBeNull();
    expect(data?.map((row) => [row.id, row.food?.name ?? null])).toEqual([
      ['l1', 'oats'],
      ['l2', 'eggs'],
      ['l3', null],
    ]);
  });

  it('treats a single-day range like an equality filter', async () => {
    const { data } = await fetchNutritionLogsWithFoods<{ id: string; food_id: string }, { id: string }>(
      'u1', { from: '2026-09-03', to: '2026-09-03' }, 'id, food_id', 'id',
    );
    expect(data?.map((row) => row.id)).toEqual(['l4']);
  });

  it('skips the foods request when there are no logs', async () => {
    const { data, error } = await fetchNutritionLogsWithFoods('u1', { from: '2027-01-01' }, 'food_id', 'id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(calls.foodsIn).toEqual([]);
  });

  it('asks for food ids in chunks of 200', async () => {
    const foods = Array.from({ length: 450 }, (_, index) => food(`f${index}`, 100));
    previewTables.foods = foods;
    previewTables.nutrition_logs = foods.map((row, index) => log(`x${index}`, '2026-09-10', row.id, 1));

    const { data } = await fetchNutritionLogsWithFoods<{ food_id: string }, { id: string }>(
      'u1', { from: '2026-09-01', to: '2026-09-30' }, 'food_id', 'id',
    );

    expect(FOOD_ID_CHUNK_SIZE).toBe(200);
    expect(calls.foodsIn).toEqual([200, 200, 50]);
    expect(data?.every((row) => row.food?.id === row.food_id)).toBe(true);
  });

  it('reports a failed foods request as the query error', async () => {
    calls.failFoods = true;
    const { data, error } = await fetchNutritionLogsWithFoods('u1', { from: '2026-09-01' }, 'food_id', 'id');
    expect(data).toBeNull();
    expect(error?.message).toBe('foods unavailable');
  });
});

describe('shared nutrition log query with expected food ids', () => {
  type Row = { id: string; food_id: string; servings: number | string };
  type FoodRow = { id: string; name: string; calories: number | string };
  const september = { from: '2026-09-01', to: '2026-09-30' };
  const read = (expected?: string[], range: NutritionLogDateRange = september) => (
    fetchNutritionLogsWithFoods<Row, FoodRow>('u1', range, '*', 'id, name, calories', expected)
  );

  it('reads the expected foods before the logs answer, then only the foods still missing', async () => {
    let answerLogs = () => {};
    calls.logsGate = new Promise((resolve) => { answerLogs = resolve; });

    const pending = read(['oats', 'eggs']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.foodIds).toEqual([['oats', 'eggs']]);

    answerLogs();
    const { data, error } = await pending;
    expect(error).toBeNull();
    // 'missing' has no food row, so it is asked for again once the logs name it
    expect(calls.foodIds).toEqual([['oats', 'eggs'], ['missing']]);
    expect(data?.map((row) => [row.id, row.food?.name ?? null])).toEqual([
      ['l1', 'oats'], ['l2', 'eggs'], ['l3', null], ['l4', 'oats'],
    ]);
  });

  it('needs no second read when the expected foods cover the logs', async () => {
    await read(['eggs', 'oats', 'oats'], { from: '2026-09-01', to: '2026-09-01' });
    expect(calls.foodIds).toEqual([['eggs', 'oats']]);
  });

  it('returns the same answer as without a hint, for missing, stale and unknown ids', async () => {
    previewTables.foods.push(food('stale', 999));
    const plain = await read();
    for (const expected of [[], ['oats'], ['eggs', 'oats', 'missing'], ['stale', 'eggs'], ['nope', ''], ['stale']]) {
      expect(await read(expected)).toEqual(plain);
    }
  });

  it('uses the food rows read now, never an earlier answer', async () => {
    const before = await read();
    previewTables.foods[0].name = 'steel-cut oats';
    const { data } = await read(before.data?.map((row) => row.food_id));
    expect(data?.find((row) => row.id === 'l1')?.food?.name).toBe('steel-cut oats');
  });

  it('reads a failed early chunk again instead of failing', async () => {
    const plain = await read();
    calls.foodIds = [];
    calls.failNextFoods = 1;
    expect(await read(['oats', 'eggs'])).toEqual(plain);
    expect(calls.foodIds).toEqual([['oats', 'eggs'], ['oats', 'eggs', 'missing']]);
  });

  it('keeps the error behaviour: a failed foods read or logs read is the query error', async () => {
    calls.failFoods = true;
    expect(await read(['oats'])).toEqual({ data: null, error: { message: 'foods unavailable', code: '503' } });
    calls.failFoods = false;
    calls.failLogs = true;
    expect(await read(['oats'])).toEqual({ data: null, error: { message: 'logs unavailable', code: '503' } });
  });

  it('answers no logs with an empty list, whatever the hint', async () => {
    expect(await read(['oats'], { from: '2027-01-01' })).toEqual({ data: [], error: null });
    expect(calls.foodIds).toEqual([['oats']]);
  });

  it('chunks the expected ids and the missing ones', async () => {
    const foods = Array.from({ length: 450 }, (_, index) => food(`f${index}`, 100));
    previewTables.foods = foods;
    previewTables.nutrition_logs = foods.map((row, index) => log(`x${index}`, '2026-09-10', row.id, 1));

    const { data } = await read(foods.slice(0, 300).map((row) => row.id));

    expect(calls.foodsIn).toEqual([200, 100, 150]);
    expect(data?.every((row) => row.food?.id === row.food_id)).toBe(true);
  });
});

describe('adaptive daily intake', () => {
  it('matches the previous two-request totals, leaving out days with nothing countable', async () => {
    expect(await getDailyIntake('u1', '2026-09-01')).toEqual([
      { date: '2026-09-01', calories: 150 + 72.5 * 2 },
      { date: '2026-09-03', calories: 75 },
    ]);
  });

  it('still throws when a request fails', async () => {
    calls.failFoods = true;
    await expect(getDailyIntake('u1', '2026-09-01')).rejects.toThrow('foods unavailable');
  });
});
