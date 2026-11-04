// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as todayRefresh from '@/lib/todayRefresh';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// useCurrentDayKey (native/src/lib/accountData.ts): the clock's day, and a new
// render when the account's day moves on at midnight, so a sheet left open
// overnight follows without being touched.

type AccountData = {
  useAccountDay: { setState: (state: { dayKey: string }) => void };
  useCurrentDayKey: () => string;
};

const accountData = loadNativeModule<AccountData>('lib/accountData.ts', {
  zustand: { create },
  '@/hooks/useTodayRefresh': { useTodayRefresh: vi.fn() },
  '@/lib/todayRefresh': todayRefresh,
  '@/stores/appStore': { useAppStore: { getState: () => ({}) } },
  './fuel': { useFuelStore: { getState: () => ({}) } },
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
});

describe('the current day key', () => {
  it("is the clock's day, and moves on at midnight with nothing else changing", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 23, 58));
    const host = document.createElement('div');
    const Day = () => createElement('span', null, accountData.useCurrentDayKey());
    root = createRoot(host);
    await act(async () => { root!.render(createElement(Day)); });
    expect(host.textContent).toBe('2026-11-04');

    vi.setSystemTime(new Date(2026, 10, 5, 0, 1));
    // the account's midnight refresh moves its day on
    await act(async () => { accountData.useAccountDay.setState({ dayKey: '2026-11-05' }); });
    expect(host.textContent).toBe('2026-11-05');
  });
});
