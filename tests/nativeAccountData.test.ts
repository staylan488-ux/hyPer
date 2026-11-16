// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as zustand from 'zustand';
import { create } from 'zustand';

import * as todayRefresh from '@/lib/todayRefresh';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = '2026-11-04';
const refreshAdaptiveTargets = vi.fn(async () => 'skipped');
const noop = async () => {};
const app = create(() => ({
  nutritionProfile: { user_id: 'user-1' } as { user_id: string } | null,
  nutritionProfileLoadedForUserId: 'user-1' as string | null,
  macroTargetLoadedForUserId: 'user-1' as string | null,
  fetchSplits: noop,
  fetchMacroTarget: noop,
  fetchTargetChange: noop,
  calculateWeeklyVolume: noop,
  fetchCurrentWorkout: noop,
  fetchWorkoutMode: noop,
  fetchNutritionProfile: noop,
  refreshAdaptiveTargets,
}));
const fuel = create(() => ({ loadToday: async () => {} }));

let loaded: Promise<unknown> = Promise.resolve();
// The shared refresh hook, reduced to one load on mount.
function useTodayRefresh(load: (day: string) => Promise<string>) {
  useEffect(() => {
    loaded = load(DAY);
  }, [load]);
  return { dayKey: DAY, refreshedAt: 1, loading: true };
}

let root: Root;
let host: HTMLDivElement;
let useAccountData: () => void;
function Probe() {
  useAccountData();
  return null;
}
const mountAndLoad = async () => {
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { await loaded; });
};

beforeEach(() => {
  refreshAdaptiveTargets.mockClear();
  app.setState({ nutritionProfile: { user_id: 'user-1' }, nutritionProfileLoadedForUserId: 'user-1', macroTargetLoadedForUserId: 'user-1' });
  ({ useAccountData } = loadNativeModule<{ useAccountData: () => void }>('lib/accountData.ts', {
    zustand,
    '@/hooks/useTodayRefresh': { useTodayRefresh },
    '@/lib/todayRefresh': todayRefresh,
    '@/stores/appStore': { useAppStore: app },
    './fuel': { useFuelStore: fuel },
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('adaptive targets after the account load', () => {
  it('re-learns from this launch’s own profile and target reads', async () => {
    await mountAndLoad();
    expect(refreshAdaptiveTargets).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the profile came from the phone’s copy', { nutritionProfileLoadedForUserId: null }],
    ['the target read failed', { macroTargetLoadedForUserId: null }],
    ['the reads belong to another account', { nutritionProfileLoadedForUserId: 'user-2', macroTargetLoadedForUserId: 'user-2' }],
    ['there is no profile', { nutritionProfile: null }],
  ])('skips when %s', async (_name, state) => {
    app.setState(state);
    await mountAndLoad();
    expect(refreshAdaptiveTargets).not.toHaveBeenCalled();
  });
});
