import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '@/preview/mockSupabase';
import { previewTables } from '@/preview/previewData';

const calls = { foodsIn: [] as number[], failFoods: false };

vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: () => client.auth.getUser(), getSession: () => client.auth.getSession() },
  from: (table: string) => {
    const builder = client.from(table);
    if (table !== 'foods') return builder;
    const select = builder.select.bind(builder);
    return Object.assign(builder, {
      select: (columns: string) => {
        const selected = select(columns);
        const within = selected.in.bind(selected);
        return Object.assign(selected, {
          in: (column: string, values: unknown[]) => {
            calls.foodsIn.push(values.length);
            if (calls.failFoods) {
              return Promise.resolve({ data: null, error: { message: 'foods unavailable', code: '503' } });
            }
            return within(column, values);
          },
        });
      },
    });
  },
} }));
vi.mock('@/preview/flag', () => ({ isPreviewActive: () => true, isAppSandboxActive: () => false }));

import { FOOD_ID_CHUNK_SIZE, fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
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
  calls.failFoods = false;
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
