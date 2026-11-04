import * as dates from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { sortNutritionGroups } from '@/lib/nutritionGroups';
import { sumMacros } from '@/lib/nutritionMacros';
import * as repeatEntries from '@/lib/repeatEntries';
import type { NutritionGroup } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

type FuelModule = {
  loadDayGroups: (key: string) => Promise<NutritionGroup[]>;
  useFuelStore: { getState: () => { copyToToday: (entries: unknown[], group: NutritionGroup | null) => Promise<boolean> }; setState: (state: object) => void };
  today: () => string;
};

const LABELS = ['breakfast', 'lunch', 'dinner'] as const;
const meal = (id: string, date: string, label: NutritionGroup['label'], sort_order: number): NutritionGroup =>
  ({ id, user_id: 'user-a', date, kind: 'meal', label, sort_order }) as NutritionGroup;

// nutrition_groups as the database holds them
let table: NutritionGroup[];
let dayReads: number;
let failOrder: boolean;
const saveRepeatedEntries = vi.fn<(userId: string, rows: Array<{ group_id: string | null }>, ids: string[]) => Promise<{ ok: true }>>(async () => ({ ok: true }));

/** The shared ensureDefaultGroups, against the table: the missing named meals, made once. */
const ensureDefaultGroups = vi.fn(async (_userId: string, date: string, dayGroups: NutritionGroup[]) => {
  const missing = LABELS.filter((label) => !dayGroups.some((group) => group.label === label));
  if (missing.length === 0) return null;
  const made = missing.map((label, index) => meal(`${date}-${label}`, date, label, dayGroups.length + index));
  table.push(...made);
  return failOrder ? { ok: false, inserted: true } : { ok: true, groups: [...dayGroups, ...made] };
});

function loadFuel(): FuelModule {
  const supabase = {
    from: (table_: string) => {
      expect(table_).toBe('nutrition_groups');
      const chain = {
        select: () => chain,
        gte: () => chain,
        lte: () => chain,
        // the month read
        order: () => Promise.resolve({ data: [...table], error: null }),
        eq: (column: string, value: string) => {
          if (column !== 'date') return chain;
          dayReads += 1;
          return Promise.resolve({ data: table.filter((group) => group.date === value), error: null });
        },
      };
      return chain;
    },
  };
  return loadNativeModule<FuelModule>('lib/fuel.ts', {
    'date-fns': dates,
    zustand: { create },
    '@/lib/accountScope': { captureAccountScope: () => () => true },
    '@/lib/nutritionLogQueries': { fetchNutritionLogsWithFoods: async () => ({ data: [], error: null }) },
    '@/lib/nutritionDay': { ensureDefaultGroups, mergeGroups: (a: NutritionGroup[], b: NutritionGroup[]) => [...a, ...b] },
    '@/lib/nutritionGroups': { sortNutritionGroups },
    '@/lib/nutritionMacros': { sumMacros },
    '@/lib/repeatEntries': { ...repeatEntries, saveRepeatedEntries },
    '@/lib/sessionUser': { getSessionUserId: async () => 'user-a' },
    '@/lib/supabase': { supabase },
    './meals': { mealForTime: () => 'breakfast' },
  });
}

describe("a day outside Fuel's loaded month", () => {
  beforeEach(() => {
    table = [];
    dayReads = 0;
    failOrder = false;
    ensureDefaultGroups.mockClear();
    saveRepeatedEntries.mockClear();
  });

  it('gets its Breakfast, Lunch and Dinner, so Log food from Today never falls to Unassigned', async () => {
    const fuel = loadFuel();
    const key = fuel.today();
    // Fuel shows a previous month, so today's groups are read directly
    fuel.useFuelStore.setState({ loadedMonth: '2020-01' });

    const groups = await fuel.loadDayGroups(key);
    expect(groups.map((group) => group.label)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(ensureDefaultGroups).toHaveBeenCalledWith('user-a', key, []);
    // the next look at the day finds them there and makes nothing
    expect(await fuel.loadDayGroups(key)).toEqual(groups);
    expect(table).toHaveLength(3);
  });

  it('reads the day again when its meals were made but could not be put in order', async () => {
    const fuel = loadFuel();
    const key = fuel.today();
    failOrder = true;

    const groups = await fuel.loadDayGroups(key);
    expect(groups.map((group) => group.label)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(dayReads).toBe(2);
  });

  it("copies a past meal into today's matching meal, making today's meals once", async () => {
    const fuel = loadFuel();
    const key = fuel.today();
    fuel.useFuelStore.setState({ loadedMonth: '2020-01' });
    const pastBreakfast = meal('past-breakfast', '2020-01-02', 'breakfast', 0);
    const entry = { id: 'oats', food_id: 'oats-food', food: { id: 'oats-food' }, servings: 1, source: 'manual', date: '2020-01-02', logged_at: '2020-01-02T08:00:00Z', group_id: pastBreakfast.id };

    expect(await fuel.useFuelStore.getState().copyToToday([entry], pastBreakfast)).toBe(true);
    const [, rows] = saveRepeatedEntries.mock.calls[0];
    expect(rows[0].group_id).toBe(`${key}-breakfast`);
    expect(table.filter((group) => group.date === key)).toHaveLength(3);
  });
});
