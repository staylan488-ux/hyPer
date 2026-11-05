import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodLog } from '../native/src/lib/fuel';
import { nativeFuelStore } from './helpers/nativeFuelStore';

const DAY = '2026-11-04';
const log: FoodLog = {
  id: 'entry', user_id: 'user-1', date: DAY, food_id: 'food', servings: 1, logged_at: null,
  food: { id: 'food', name: 'Meal', calories: 1950, protein: 120, carbs: 0, fat: 0 } as FoodLog['food'],
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 4, 13));
});
afterEach(() => vi.useRealTimers());

describe('reconciling nutrition writes', () => {
  it.each([false, true])('drops a pre-write response, including a day-only read (%s)', async (dayOnly) => {
    const real = nativeFuelStore();
    const store = real.useFuelStore;
    if (dayOnly) store.setState({ selected: '2026-10-01' });
    real.read.mockResolvedValue({ data: [log], error: null });
    await store.getState().loadToday(DAY);
    let finish!: (value: { data: FoodLog[]; error: null }) => void;
    real.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = store.getState().loadToday(DAY);
    await vi.waitFor(() => expect(finish).toBeDefined());

    real.read.mockResolvedValue({ data: null, error: new Error('offline') });
    await store.getState().refreshAfterWrite();
    finish({ data: [log], error: null });
    await pending;
    expect(store.getState().totalsNeedRefresh).toBe(true);
    expect(store.getState().todayTotals.calories).toBe(1950);

    real.read.mockResolvedValue({ data: [{ ...log, servings: 2 }], error: null });
    await store.getState().refresh();
    expect(store.getState().totalsNeedRefresh).toBe(false);
    expect(store.getState().todayTotals.calories).toBe(3900);
  });

  it('keeps a confirmed move successful when the refresh throws, with reminders invalidated', async () => {
    const real = nativeFuelStore();
    real.read.mockResolvedValue({ data: [log], error: null });
    await real.useFuelStore.getState().loadToday(DAY);
    real.read.mockRejectedValue(new Error('offline'));
    expect(await real.useFuelStore.getState().moveEntryToYesterday(log.id)).toBe(true);
    expect(real.useFuelStore.getState().totalsNeedRefresh).toBe(true);
  });

  it('does not invalidate a failed copy, and resets invalidation with the account', async () => {
    const real = nativeFuelStore();
    real.read.mockResolvedValue({ data: [log], error: null });
    await real.useFuelStore.getState().loadToday(DAY);
    real.copy.mockResolvedValue({ ok: false });
    expect(await real.useFuelStore.getState().copyToToday([log], null)).toBe(false);
    expect(real.useFuelStore.getState().totalsNeedRefresh).toBe(false);
    real.read.mockRejectedValue(new Error('offline'));
    await real.useFuelStore.getState().refreshAfterWrite();
    real.resetFuel();
    expect(real.useFuelStore.getState().totalsNeedRefresh).toBe(false);
  });
});
