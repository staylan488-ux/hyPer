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
  restoreEntry: vi.fn(),
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
  restoreNutritionEntry: reads.restoreEntry,
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
  todayTotalsShown,
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
  reads.restoreEntry.mockReset().mockResolvedValue(true);
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

  it('shows the copy’s figures on Today for the copy’s own day only', async () => {
    restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: null });
    expect(todayTotalsShown(useFuelStore.getState())).toEqual(copyTotals);
    // Past midnight the new day's read fails: the copy's figures are not the new day's.
    reads.food.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await useFuelStore.getState().loadToday('2026-11-05');
    expect(useFuelStore.getState().todayTotals).toEqual(copyTotals);
    expect(todayTotalsShown(useFuelStore.getState())).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
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

describe('deleting while the loaded month refreshes', () => {
  beforeEach(async () => {
    reads.food.mockResolvedValue({ data: copyMonth().logs, error: null });
    await useFuelStore.getState().loadToday(DAY);
  });

  it.each([true, false])('keeps the entry gone when a stale refresh arrives (delete settled: %s)', async (settled) => {
    const stale = deferred<{ data: FoodLog[]; error: null }>();
    const deletion = deferred<boolean>();
    reads.food.mockReturnValueOnce(stale.promise);
    reads.deleteEntry.mockReturnValueOnce(deletion.promise);
    const refresh = useFuelStore.getState().refresh();
    await vi.waitFor(() => expect(reads.food).toHaveBeenCalledTimes(2));
    const removing = useFuelStore.getState().deleteEntry('b');
    if (settled) {
      deletion.resolve(true);
      await removing;
    }
    stale.resolve({ data: copyMonth().logs, error: null });
    await refresh;
    expect(useFuelStore.getState().logs.map((entry) => entry.id)).not.toContain('b');
    expect(useFuelStore.getState().todayTotals.calories).toBe(500);
    deletion.resolve(true);
    expect(await removing).toBe(true);
  });

  it('restores a failed deletion once, even after a refresh', async () => {
    const deletion = deferred<boolean>();
    reads.deleteEntry.mockReturnValueOnce(deletion.promise);
    const removing = useFuelStore.getState().deleteEntry('b');
    await useFuelStore.getState().refresh();
    expect(useFuelStore.getState().logs.map((entry) => entry.id)).not.toContain('b');
    deletion.resolve(false);
    expect(await removing).toBe(false);
    expect(useFuelStore.getState().logs.filter((entry) => entry.id === 'b')).toHaveLength(1);
    expect(useFuelStore.getState().todayTotals.calories).toBe(800);
  });

  it('does not restore a failed deletion into another month', async () => {
    const deletion = deferred<boolean>();
    reads.deleteEntry.mockReturnValueOnce(deletion.promise);
    const removing = useFuelStore.getState().deleteEntry('b');
    reads.food.mockResolvedValue({ data: [], error: null });
    useFuelStore.getState().select('2026-10-01');
    await useFuelStore.getState().refresh();
    deletion.resolve(false);
    await removing;
    expect(useFuelStore.getState().logs).toEqual([]);
  });

  it('does not restore a failed deletion after the account is reset', async () => {
    const deletion = deferred<boolean>();
    reads.deleteEntry.mockReturnValueOnce(deletion.promise);
    const removing = useFuelStore.getState().deleteEntry('b');
    resetFuel();
    deletion.resolve(false);
    await removing;
    expect(useFuelStore.getState().logs).toEqual([]);
  });

  it('puts a deleted entry back with Undo, once its delete has landed', async () => {
    const deletion = deferred<boolean>();
    reads.deleteEntry.mockReturnValueOnce(deletion.promise);
    const entry = useFuelStore.getState().logs.find((candidate) => candidate.id === 'b')!;
    const removing = useFuelStore.getState().deleteEntry('b');
    const undoing = useFuelStore.getState().restoreEntry(entry);
    await Promise.resolve();
    // The row is written back only after the delete finishes.
    expect(reads.restoreEntry).not.toHaveBeenCalled();
    deletion.resolve(true);
    await removing;
    expect(await undoing).toBe(true);
    expect(reads.restoreEntry).toHaveBeenCalledWith(entry);
    expect(useFuelStore.getState().logs.filter((candidate) => candidate.id === 'b')).toHaveLength(1);
    expect(useFuelStore.getState().todayTotals.calories).toBe(800);
  });

  it('leaves the entry gone when Undo cannot write it back', async () => {
    const entry = useFuelStore.getState().logs.find((candidate) => candidate.id === 'b')!;
    await useFuelStore.getState().deleteEntry('b');
    // The server no longer has it, and the write back fails.
    reads.food.mockResolvedValue({ data: copyMonth().logs.filter((candidate) => candidate.id !== 'b'), error: null });
    reads.restoreEntry.mockResolvedValueOnce(false);
    expect(await useFuelStore.getState().restoreEntry(entry)).toBe(false);
    expect(useFuelStore.getState().logs.map((candidate) => candidate.id)).not.toContain('b');
    // The month read again after the failure agrees.
    await vi.waitFor(() => expect(reads.food).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(useFuelStore.getState().totalsNeedRefresh).toBe(false));
    expect(useFuelStore.getState().logs.map((candidate) => candidate.id)).not.toContain('b');
    expect(useFuelStore.getState().todayTotals.calories).toBe(500);
  });

  it('shows an entry Undo put back when only its answer was lost, once the month is read again', async () => {
    const entry = useFuelStore.getState().logs.find((candidate) => candidate.id === 'b')!;
    await useFuelStore.getState().deleteEntry('b');
    // The server wrote it back, but the answer never arrived.
    reads.restoreEntry.mockResolvedValueOnce(false);
    expect(await useFuelStore.getState().restoreEntry(entry)).toBe(false);
    await useFuelStore.getState().refresh();
    expect(useFuelStore.getState().logs.filter((candidate) => candidate.id === 'b')).toHaveLength(1);
    expect(useFuelStore.getState().todayTotals.calories).toBe(800);
  });

  it('lets Undo try again after a failure, and shares one write between two taps', async () => {
    const entry = useFuelStore.getState().logs.find((candidate) => candidate.id === 'b')!;
    await useFuelStore.getState().deleteEntry('b');
    reads.restoreEntry.mockRejectedValueOnce(new Error('offline'));
    expect(await useFuelStore.getState().restoreEntry(entry)).toBe(false);
    reads.restoreEntry.mockClear();
    const [first, second] = await Promise.all([useFuelStore.getState().restoreEntry(entry), useFuelStore.getState().restoreEntry(entry)]);
    expect([first, second]).toEqual([true, true]);
    expect(reads.restoreEntry).toHaveBeenCalledOnce();
    expect(useFuelStore.getState().logs.filter((candidate) => candidate.id === 'b')).toHaveLength(1);
  });

  it('keeps an entry Undo put back when a read that left before it answers late', async () => {
    const entry = useFuelStore.getState().logs.find((candidate) => candidate.id === 'b')!;
    await useFuelStore.getState().deleteEntry('b');
    const stale = deferred<{ data: FoodLog[]; error: null }>();
    reads.food.mockReturnValueOnce(stale.promise);
    const refresh = useFuelStore.getState().refresh();
    await vi.waitFor(() => expect(reads.food).toHaveBeenCalledTimes(2));
    expect(await useFuelStore.getState().restoreEntry(entry)).toBe(true);
    // It read the month between the delete and the Undo.
    stale.resolve({ data: copyMonth().logs.filter((candidate) => candidate.id !== 'b'), error: null });
    await refresh;
    await vi.waitFor(() => expect(reads.food).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(useFuelStore.getState().todayLoadedForUserId).toBe(USER));
    expect(useFuelStore.getState().logs.filter((candidate) => candidate.id === 'b')).toHaveLength(1);
    expect(useFuelStore.getState().todayTotals.calories).toBe(800);
  });

  it('puts today’s totals right after Undo while Fuel shows another month', async () => {
    const entry = useFuelStore.getState().logs.find((candidate) => candidate.id === 'b')!;
    await useFuelStore.getState().deleteEntry('b');
    expect(useFuelStore.getState().todayTotals.calories).toBe(500);
    reads.food.mockImplementation(async (_user: string, range: { from: string; to: string }) => ({
      data: copyMonth().logs.filter((candidate) => candidate.date >= range.from && candidate.date <= range.to),
      error: null,
    }));
    useFuelStore.getState().select('2026-10-01');
    await vi.waitFor(() => expect(useFuelStore.getState().loadedMonth).toBe('2026-10'));
    expect(await useFuelStore.getState().restoreEntry(entry)).toBe(true);
    await vi.waitFor(() => expect(useFuelStore.getState().todayTotals.calories).toBe(800));
    expect(todayTotalsShown(useFuelStore.getState()).calories).toBe(800);
    expect(useFuelStore.getState().totalsNeedRefresh).toBe(false);
  });

  it('keeps a stale day-only total from counting a deleted entry', async () => {
    await useFuelStore.getState().deleteEntry('b');
    useFuelStore.setState({ selected: '2026-10-01' });
    reads.food.mockResolvedValue({ data: copyMonth().logs.filter((entry) => entry.date === DAY), error: null });
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState().todayTotals.calories).toBe(500);
    resetFuel();
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState().todayTotals.calories).toBe(800);
  });

  it('shares simultaneous deletes and restores a thrown failure', async () => {
    reads.deleteEntry.mockRejectedValueOnce(new Error('offline'));
    const first = useFuelStore.getState().deleteEntry('b');
    const second = useFuelStore.getState().deleteEntry('b');
    expect(await Promise.all([first, second])).toEqual([false, false]);
    expect(reads.deleteEntry).toHaveBeenCalledOnce();
    expect(useFuelStore.getState().logs.filter((entry) => entry.id === 'b')).toHaveLength(1);
  });
});

describe('while Fuel shows the copy', () => {
  beforeEach(() => {
    restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month: copyMonth() });
  });

  it('makes no meals from the copy and reads the day’s meals straight from the server', async () => {
    await useFuelStore.getState().ensureDayGroups(DAY);
    expect(reads.ensureDefaultGroups).not.toHaveBeenCalled();
    reads.dayGroups = { data: [group('server-dinner', DAY, 'dinner', 2), todayLunch], error: null };
    const groups = await loadDayGroups(DAY);
    expect(reads.directGroupReads).toBe(1);
    expect(groups.map((entry) => entry.id)).toEqual(['t-lunch', 'server-dinner']);
    // #178's direct read makes the missing meals, from the server's meals only.
    expect(reads.ensureDefaultGroups).toHaveBeenCalledTimes(1);
    expect(reads.ensureDefaultGroups).toHaveBeenCalledWith(USER, DAY, [todayLunch, group('server-dinner', DAY, 'dinner', 2)]);
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
    expect(useFuelStore.getState()).toMatchObject({ logs: fresh, todayLoadedForUserId: USER, todayLoadedKey: DAY, todayTotals: { calories: 500 }, todayCopyKey: null });
    expect(isFuelMonthFromCopy()).toBe(false);
    await vi.waitFor(() => expect(reads.ensureDefaultGroups).toHaveBeenCalledWith(USER, DAY, []));
  });

  it('keeps the copy on screen when the read fails', async () => {
    const month = copyMonth();
    restoreFuelCopy({ todayKey: DAY, totals: copyTotals, month });
    reads.food.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await useFuelStore.getState().loadToday(DAY);
    expect(useFuelStore.getState()).toMatchObject({ status: 'ready', loadedMonth: '2026-11', todayTotals: copyTotals, todayLoadedForUserId: null });
    expect(todayTotalsShown(useFuelStore.getState())).toEqual(copyTotals);
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
