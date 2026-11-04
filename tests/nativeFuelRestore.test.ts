import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown[] | null; error: { message: string } | null };
const reads = vi.hoisted(() => ({
  user: 'user-1',
  food: vi.fn(),
  monthGroups: { data: [], error: null } as Result,
  dayGroups: { data: [], error: null } as Result,
  directGroupReads: 0,
  ensureDefaultGroups: vi.fn(),
  deleteEntry: vi.fn(),
  moveEntry: vi.fn(),
  deleteGroup: vi.fn(),
  saveRepeated: vi.fn(),
}));
vi.mock('@/lib/sessionUser', () => ({ getSessionUserId: async () => reads.user }));
vi.mock('@/lib/nutritionLogQueries', () => ({ fetchNutritionLogsWithFoods: reads.food }));
vi.mock('@/lib/nutritionDay', async (original) => ({
  ...(await original<typeof import('@/lib/nutritionDay')>()),
  ensureDefaultGroups: reads.ensureDefaultGroups,
  deleteNutritionEntry: reads.deleteEntry,
  moveEntryToGroup: reads.moveEntry,
  deleteNutritionGroup: reads.deleteGroup,
}));
vi.mock('@/lib/repeatEntries', async (original) => ({
  ...(await original<typeof import('@/lib/repeatEntries')>()),
  saveRepeatedEntries: reads.saveRepeated,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      // The month read ends in order(); loadDayGroups' direct read ends in eq().
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        lte: () => chain,
        order: async () => reads.monthGroups,
        then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => {
          reads.directGroupReads += 1;
          return Promise.resolve(reads.dayGroups).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

import type { FoodLog } from '../native/src/lib/fuel';
import {
  isFuelMonthFromCopy,
  loadDayGroups,
  resetFuel,
  restoreFuelCopy,
  todayLogsInMatchingMeal,
  useFuelStore,
} from '../native/src/lib/fuel';
import type { NutritionGroup } from '@/types';

const DAY = '2026-11-04';
const USER = 'user-1';
const group = (id: string, date: string, label: NutritionGroup['label'], sort_order = 0): NutritionGroup => ({
  id, user_id: USER, date, kind: 'meal', label, sort_order,
});
const log = (id: string, date: string, calories: number, group_id: string | null = null): FoodLog => ({
  id, user_id: USER, date, logged_at: `${date}T12:30:00`, food_id: `food-${id}`, servings: 1, group_id,
  food: { id: `food-${id}`, user_id: USER, name: id, description: null, calories, protein: 10, carbs: 5, fat: 2, serving_size: 1, serving_unit: 'g', source: 'manual', fdc_id: null } as unknown as FoodLog['food'],
});
const yesterdayLunch = group('y-lunch', '2026-11-03', 'lunch');
const todayLunch = group('t-lunch', DAY, 'lunch', 1);
const copyMonth = () => ({
  month: '2026-11',
  logs: [log('a', DAY, 500, 't-lunch'), log('b', DAY, 300), log('y', '2026-11-03', 700, 'y-lunch')],
  groups: [todayLunch, yesterdayLunch],
});
const copyTotals = { calories: 800, protein: 20, carbs: 10, fat: 4 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 13, 0));
  resetFuel();
  reads.user = USER;
  reads.monthGroups = { data: [], error: null };
  reads.dayGroups = { data: [], error: null };
  reads.directGroupReads = 0;
  reads.food.mockReset().mockResolvedValue({ data: [], error: null });
  reads.ensureDefaultGroups.mockReset().mockResolvedValue(null);
  reads.deleteEntry.mockReset().mockResolvedValue(true);
  reads.moveEntry.mockReset().mockResolvedValue({ group_id: 't-lunch', sort_order: 1, meal_type: 'lunch' });
  reads.deleteGroup.mockReset().mockResolvedValue(true);
  reads.saveRepeated.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('restoring today from the phone’s copy', () => {
  it('shows today’s month from the copy without any loaded marker', () => {
    const month = copyMonth();
    expect(restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month })).toBe(true);
    expect(useFuelStore.getState()).toMatchObject({
      selected: DAY, todayKey: DAY, todayTotals: copyTotals, loadedMonth: '2026-11', status: 'ready',
      todayLoadedForUserId: null, todayLoadedKey: null,
    });
    expect(useFuelStore.getState().logs).toBe(month.logs);
    expect(useFuelStore.getState().groups).toBe(month.groups);
    expect(isFuelMonthFromCopy()).toBe(true);
  });

  it('shows only today’s figures when the month is not known', () => {
    expect(restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: null })).toBe(true);
    expect(useFuelStore.getState()).toMatchObject({ todayKey: DAY, todayTotals: copyTotals, loadedMonth: null, status: 'idle', logs: [] });
    expect(isFuelMonthFromCopy()).toBe(false);
  });

  it('is refused for another day, or once anything has loaded', () => {
    expect(restoreFuelCopy({ todayKey: '2026-11-03', totals: copyTotals, month: null })).toBe(false);
    useFuelStore.setState({ todayLoadedForUserId: USER });
    expect(restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: null })).toBe(false);
    resetFuel();
    useFuelStore.setState({ loadedMonth: '2026-11', status: 'ready' });
    expect(restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: copyMonth() })).toBe(false);
    expect(useFuelStore.getState().todayTotals.calories).toBe(0);
  });
});

describe('while Fuel shows the copy', () => {
  beforeEach(() => {
    restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: copyMonth() });
  });

  it('makes no meals and reads the day’s meals straight from the server', async () => {
    await useFuelStore.getState().ensureDayGroups(DAY);
    expect(reads.ensureDefaultGroups).not.toHaveBeenCalled();
    reads.dayGroups = { data: [group('server-dinner', DAY, 'dinner', 2), todayLunch], error: null };
    const groups = await loadDayGroups(DAY);
    expect(reads.directGroupReads).toBe(1);
    expect(groups.map((entry) => entry.id)).toEqual(['t-lunch', 'server-dinner']);
    expect(reads.ensureDefaultGroups).not.toHaveBeenCalled();
    expect(todayLogsInMatchingMeal(yesterdayLunch)).toBeNull();
  });

  it('copies a past meal into today’s matching meal, made from the server’s meals', async () => {
    const serverLunch = group('server-lunch', DAY, 'lunch', 1);
    const made = [group('server-breakfast', DAY, 'breakfast', 0), serverLunch, group('server-dinner', DAY, 'dinner', 2)];
    reads.dayGroups = { data: [], error: null };
    reads.ensureDefaultGroups.mockResolvedValue({ ok: true, groups: made });
    const entries = useFuelStore.getState().logs.filter((entry) => entry.date === '2026-11-03');
    expect(await useFuelStore.getState().copyToToday(entries, yesterdayLunch)).toBe(true);
    expect(reads.ensureDefaultGroups).toHaveBeenCalledWith(USER, DAY, []);
    const rows = reads.saveRepeated.mock.calls[0][1] as { group_id: string | null; date: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ group_id: 'server-lunch', date: DAY });
  });
});

describe('an edit made while the first read is still on its way', () => {
  const edits = [
    ['deletes an entry', () => useFuelStore.getState().deleteEntry('b'), (logs: FoodLog[]) => !logs.some((entry) => entry.id === 'b')],
    ['moves an entry', () => useFuelStore.getState().moveEntry('b', 't-lunch'), (logs: FoodLog[]) => logs.find((entry) => entry.id === 'b')?.group_id === 't-lunch'],
    ['deletes a meal', () => useFuelStore.getState().deleteGroup(todayLunch), (logs: FoodLog[]) => logs.find((entry) => entry.id === 'a')?.group_id === null],
  ] as const;

  it.each(edits)('keeps the change when the old answer arrives (%s), then reads the month again', async (_name, edit, changed) => {
    restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: copyMonth() });
    const first = deferred<{ data: FoodLog[]; error: null }>();
    const again = deferred<{ data: FoodLog[]; error: null }>();
    reads.food.mockReturnValueOnce(first.promise).mockReturnValueOnce(again.promise);
    const load = useFuelStore.getState().loadToday(DAY);
    await vi.waitFor(() => expect(reads.food).toHaveBeenCalledTimes(1));

    expect(await edit()).toBe(true);
    expect(changed(useFuelStore.getState().logs)).toBe(true);

    // The first read left before the edit and answers with the old rows.
    first.resolve({ data: copyMonth().logs, error: null });
    await load;
    expect(changed(useFuelStore.getState().logs)).toBe(true);
    expect(useFuelStore.getState().todayLoadedForUserId).toBeNull();

    await vi.waitFor(() => expect(reads.food).toHaveBeenCalledTimes(2));
    const fresh = [log('a', DAY, 500, null), log('fresh', DAY, 120)];
    again.resolve({ data: fresh, error: null });
    await vi.waitFor(() => expect(useFuelStore.getState().todayLoadedForUserId).toBe(USER));
    expect(useFuelStore.getState()).toMatchObject({ todayLoadedKey: DAY, logs: fresh, todayTotals: { calories: 620 } });
    expect(isFuelMonthFromCopy()).toBe(false);
  });

  it('leaves an edit with no copy on screen as it was', async () => {
    useFuelStore.setState({ loadedMonth: '2026-11', logs: copyMonth().logs, groups: copyMonth().groups, status: 'ready' });
    expect(await useFuelStore.getState().deleteEntry('b')).toBe(true);
    expect(reads.food).not.toHaveBeenCalled();
  });
});

describe('the real read', () => {
  it('replaces the copy, marks today loaded, and only then makes today’s meals', async () => {
    restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: copyMonth() });
    const fresh = [log('a', DAY, 500)];
    reads.food.mockResolvedValue({ data: fresh, error: null });
    reads.monthGroups = { data: [], error: null };
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState()).toMatchObject({ logs: fresh, todayLoadedForUserId: USER, todayLoadedKey: DAY, todayTotals: { calories: 500 } });
    expect(isFuelMonthFromCopy()).toBe(false);
    await vi.waitFor(() => expect(reads.ensureDefaultGroups).toHaveBeenCalledWith(USER, DAY, []));
  });

  it('keeps the copy on screen when the read fails', async () => {
    const month = copyMonth();
    restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month });
    reads.food.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState()).toMatchObject({ status: 'ready', loadedMonth: '2026-11', todayTotals: copyTotals, todayLoadedForUserId: null });
    expect(useFuelStore.getState().logs).toBe(month.logs);
    expect(isFuelMonthFromCopy()).toBe(true);
  });

  it('forgets the copy on reset', () => {
    restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: copyMonth() });
    resetFuel();
    expect(isFuelMonthFromCopy()).toBe(false);
    expect(useFuelStore.getState()).toMatchObject({ loadedMonth: null, logs: [], status: 'idle' });
  });
});
