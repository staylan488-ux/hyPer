import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msUntilNextLocalDay, shouldRefreshToday, TODAY_REFRESH_INTERVAL_MS, todayKey } from '@/lib/todayRefresh';
import { useTodayRefresh, type TodayRefreshState } from '@/hooks/useTodayRefresh';

// Drive the hook without a DOM: slots keep state across explicit renders, and
// effects run once on commit (the hook's deps are stable in Dashboard).
const hooks = vi.hoisted(() => {
  const state = { slots: [] as unknown[], cursor: 0, cleanups: [] as Array<() => void>, pending: [] as Array<() => void | (() => void)> };
  return {
    state,
    reset() { state.slots = []; state.cursor = 0; state.cleanups = []; state.pending = []; },
    commit() { for (const setup of state.pending.splice(0)) { const cleanup = setup(); if (cleanup) state.cleanups.push(cleanup); } },
    unmount() { for (const cleanup of state.cleanups.splice(0)) cleanup(); },
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === 'function' ? value(state.slots[index]) : value; }];
    },
    useEffect(setup: () => void | (() => void)) {
      const index = state.cursor++;
      if (index in state.slots) return;
      state.slots[index] = true;
      state.pending.push(setup);
    },
  };
});

vi.mock('react', () => ({ useState: hooks.useState, useEffect: hooks.useEffect }));

function browser() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  vi.stubGlobal('document', doc);
  return {
    doc,
    show() { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); },
    hide() { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); },
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = () => res(); reject = rej; });
  return { promise, resolve, reject };
}

function mount<T>(load: (day: string) => Promise<T>, onNewDay: () => void, seed?: (day: string) => T | null) {
  hooks.reset();
  const render = (): TodayRefreshState<T> => {
    hooks.state.cursor = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- renders the hook against the mocked React above
    return useTodayRefresh(load, onNewDay, seed);
  };
  const first = render();
  hooks.commit();
  return { first, render };
}

// Mounted at 23:59 local time on Sep 29.
const LATE = new Date(2026, 8, 29, 23, 59, 0);

let page: ReturnType<typeof browser>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(LATE);
  page = browser();
});

afterEach(() => {
  hooks.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('todayRefresh helpers', () => {
  it('refreshes on a new day or once the last load is stale', () => {
    const at = LATE.getTime();
    expect(shouldRefreshToday(at, '2026-09-29', null)).toBe(true);
    expect(shouldRefreshToday(at + 30_000, '2026-09-29', { dayKey: '2026-09-29', at })).toBe(false);
    expect(shouldRefreshToday(at + TODAY_REFRESH_INTERVAL_MS, '2026-09-29', { dayKey: '2026-09-29', at })).toBe(true);
    expect(shouldRefreshToday(at + 60_000, '2026-09-30', { dayKey: '2026-09-29', at })).toBe(true);
  });

  it('aims just past the next local midnight', () => {
    expect(msUntilNextLocalDay(LATE)).toBe(61_000);
    expect(todayKey(new Date(LATE.getTime() + msUntilNextLocalDay(LATE)))).toBe('2026-09-30');
  });
});

describe('useTodayRefresh', () => {
  it('reloads for the new date on return the next morning, without going back to loading', async () => {
    const load = vi.fn(async () => undefined);
    const onNewDay = vi.fn();
    const today = mount(load, onNewDay);
    expect(today.first).toMatchObject({ loading: true, dayKey: '2026-09-29' });

    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenLastCalledWith('2026-09-29');
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-29' });

    page.hide();
    vi.setSystemTime(new Date(2026, 8, 30, 7, 0, 0));
    page.show();
    // In flight: the screen keeps showing the old data, never the shimmer.
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-29' });
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith('2026-09-30');
    const after = today.render();
    expect(after).toMatchObject({ loading: false, dayKey: '2026-09-30' });
    expect(after.refreshedAt).toBe(new Date(2026, 8, 30, 7, 0, 0).getTime());
    expect(onNewDay).toHaveBeenCalledTimes(1);
  });

  it('does not refetch on a quick return within five minutes', async () => {
    const load = vi.fn(async () => undefined);
    const onNewDay = vi.fn();
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0, 0));
    mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);

    page.hide();
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0, 30));
    page.show();
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(1);
    expect(onNewDay).not.toHaveBeenCalled();
  });

  it('refreshes the elapsed-time anchor after five minutes away, same day', async () => {
    const load = vi.fn(async () => undefined);
    const onNewDay = vi.fn();
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0, 0));
    const today = mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);

    const back = new Date(2026, 8, 29, 12, 6, 0);
    vi.setSystemTime(back);
    page.show();
    await vi.advanceTimersByTimeAsync(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-29', refreshedAt: back.getTime() });
    expect(onNewDay).not.toHaveBeenCalled();
  });

  it('starts only one load for back-to-back foreground events', async () => {
    let pending = deferred();
    const load = vi.fn(() => pending.promise);
    const onNewDay = vi.fn();
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0, 0));
    mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);

    pending = deferred();
    vi.setSystemTime(new Date(2026, 8, 29, 12, 10, 0));
    page.show();
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);

    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ignores the event when the app goes to the background', async () => {
    const load = vi.fn(async () => undefined);
    mount(load, vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    vi.setSystemTime(new Date(2026, 8, 30, 7, 0, 0));
    page.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rolls over at midnight while the screen stays open', async () => {
    const load = vi.fn(async () => undefined);
    const onNewDay = vi.fn();
    const today = mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(61_000);

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith('2026-09-30');
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-30' });
    expect(onNewDay).toHaveBeenCalledTimes(1);
  });

  it('keeps the old day and its data together when a refresh fails, and retries on the next return', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn(async (day: string) => ({ kcal: day === '2026-09-29' ? 1_800 : 0 }));
    const onNewDay = vi.fn();
    const today = mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);
    expect(today.render()).toMatchObject({ dayKey: '2026-09-29', data: { kcal: 1_800 } });

    load.mockRejectedValueOnce(new Error('offline'));
    vi.setSystemTime(new Date(2026, 8, 30, 7, 0, 0));
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    // Yesterday's date stays above yesterday's numbers, never a mix.
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-29', data: { kcal: 1_800 } });
    expect(onNewDay).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(2026, 8, 30, 7, 0, 10));
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-30', data: { kcal: 0 } });
    expect(onNewDay).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('ends the first-load shimmer even when it fails, and loads on the next return', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn(async () => ({ kcal: 500 }));
    load.mockRejectedValueOnce(new Error('offline'));
    const onNewDay = vi.fn();
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0, 0));
    const today = mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-29', data: null });

    vi.setSystemTime(new Date(2026, 8, 29, 12, 0, 20));
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-29', data: { kcal: 500 } });
    expect(onNewDay).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('still re-reads the schedule when the first successful load is on a later day', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn(async () => undefined);
    load.mockRejectedValueOnce(new Error('offline'));
    const onNewDay = vi.fn();
    const today = mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-29' });

    vi.setSystemTime(new Date(2026, 8, 30, 7, 0, 0));
    page.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(today.render()).toMatchObject({ dayKey: '2026-09-30' });
    expect(onNewDay).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('does not retry a failed refresh on its own', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn(async () => undefined);
    mount(load, vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    load.mockRejectedValue(new Error('offline'));
    vi.setSystemTime(new Date(2026, 8, 30, 7, 0, 0));
    page.show();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('runs the midnight rollover that fired while a load was in flight', async () => {
    let pending = deferred();
    const load = vi.fn(() => pending.promise);
    const onNewDay = vi.fn();
    vi.setSystemTime(new Date(2026, 8, 29, 23, 50, 0));
    const today = mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);

    // A foreground refresh for Sep 29 starts just before midnight...
    pending = deferred();
    vi.setSystemTime(new Date(2026, 8, 29, 23, 59, 59));
    page.show();
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith('2026-09-29');

    // ...the midnight timer fires while it is still running...
    await vi.advanceTimersByTimeAsync(2_000);
    expect(load).toHaveBeenCalledTimes(2);

    // ...and once it lands, Today reloads for Sep 30 instead of waiting a day.
    const late = pending;
    pending = deferred();
    late.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    expect(load).toHaveBeenLastCalledWith('2026-09-30');
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(today.render()).toMatchObject({ loading: false, dayKey: '2026-09-30' });
    expect(onNewDay).toHaveBeenCalledTimes(1);
  });

  it('reloads for the new day when a load straddles midnight with nothing else pending', async () => {
    let pending = deferred();
    const load = vi.fn(() => pending.promise);
    const onNewDay = vi.fn();
    const today = mount(load, onNewDay);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenLastCalledWith('2026-09-29');

    // The first load is slow and lands after midnight, before the timer fires.
    const first = pending;
    pending = deferred();
    vi.setSystemTime(new Date(2026, 8, 30, 0, 0, 0));
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith('2026-09-30');
    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(today.render()).toMatchObject({ dayKey: '2026-09-30' });
    expect(onNewDay).toHaveBeenCalledTimes(1);
  });

  it('stops listening after unmount', async () => {
    const load = vi.fn(async () => undefined);
    mount(load, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    hooks.unmount();

    vi.setSystemTime(new Date(2026, 8, 30, 7, 0, 0));
    page.show();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows the seed for the mount day until the first load replaces it', async () => {
    vi.setSystemTime(new Date(2026, 8, 29, 12, 0, 0));
    const gate = deferred();
    const load = vi.fn(async () => { await gate.promise; return 'fresh'; });
    const seed = vi.fn((day: string) => (day === '2026-09-29' ? 'remembered' : null));
    const today = mount(load, vi.fn(), seed);

    expect(seed).toHaveBeenCalledWith('2026-09-29');
    expect(today.first).toMatchObject({ loading: true, data: 'remembered' });
    await vi.advanceTimersByTimeAsync(0);
    expect(today.render()).toMatchObject({ loading: true, data: 'remembered' });

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(today.render()).toMatchObject({ loading: false, data: 'fresh' });
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('keeps the seed when the first load fails', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn(async () => { throw new Error('offline'); });
    const today = mount(load, vi.fn(), () => 'remembered');
    await vi.advanceTimersByTimeAsync(0);

    expect(today.render()).toMatchObject({ loading: false, data: 'remembered' });
    quiet.mockRestore();
  });
});
