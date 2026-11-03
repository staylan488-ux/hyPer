// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as widgetRules from '../native/src/lib/widgetPlan';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DAY = '2026-11-03';
const setSnapshot = vi.fn<(json: string) => Promise<void>>();
const clear = vi.fn<() => Promise<void>>();
const auth = create<{ user: { id: string } | null }>(() => ({ user: { id: 'user-1' } }));
const app = create(() => ({
  hydratedForUserId: 'user-1' as string | null,
  macroTargetLoadedForUserId: 'user-1' as string | null,
  nutritionProfileLoadedForUserId: 'user-1' as string | null,
  activeSplit: null,
  workoutMode: 'flexible',
  macroTarget: { calories: 2000, protein: 150 } as { calories: number; protein: number } | null,
  nutritionProfile: null,
}));
const fuel = create(() => ({
  todayKey: DAY,
  todayLoadedForUserId: null as string | null,
  todayLoadedKey: null as string | null,
  todayTotals: { calories: 0, protein: 0 },
}));

let root: Root;
let host: HTMLDivElement;
let useWidgetSnapshot: () => void;
function Probe() {
  useWidgetSnapshot();
  return null;
}
const render = async () => {
  await act(async () => { root.render(createElement(Probe)); });
};
const settle = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(601); });
};

describe('home-screen widget snapshot readiness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSnapshot.mockReset().mockResolvedValue();
    clear.mockReset().mockResolvedValue();
    auth.setState({ user: { id: 'user-1' } });
    app.setState({
      hydratedForUserId: 'user-1', macroTargetLoadedForUserId: 'user-1', nutritionProfileLoadedForUserId: 'user-1',
      macroTarget: { calories: 2000, protein: 150 },
    });
    fuel.setState({ todayKey: DAY, todayLoadedForUserId: null, todayLoadedKey: null, todayTotals: { calories: 0, protein: 0 } });
    ({ useWidgetSnapshot } = loadNativeModule<{ useWidgetSnapshot: () => void }>('lib/widgets.ts', {
      '@/stores/appStore': { useAppStore: app },
      '@/stores/authStore': { useAuthStore: auth },
      '../../modules/hyper-widget-data': { setSnapshot, clear },
      './accountData': { useAccountDay: () => ({ dayKey: DAY, loading: false }) },
      './fuel': { useFuelStore: fuel },
      './today': { useTodayPlan: () => ({ hero: { kind: 'flexible' }, schedule: null, scheduleWorkouts: [], adaptiveSchedulingEnabled: false }) },
      './widgetPlan': widgetRules,
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('keeps the old widget when training loaded but food failed, then writes a genuinely empty day', async () => {
    await render();
    await settle();
    expect(setSnapshot).not.toHaveBeenCalled();

    await act(async () => { fuel.setState({ todayLoadedForUserId: 'user-1', todayLoadedKey: DAY }); });
    await settle();
    expect(setSnapshot).toHaveBeenCalledTimes(1);
    expect(JSON.parse(setSnapshot.mock.calls[0][0]).fuel).toMatchObject({ calories: 0, calorieTarget: 2000 });
  });

  it.each(['macroTargetLoadedForUserId', 'nutritionProfileLoadedForUserId'] as const)(
    'does not replace a saved widget before %s succeeds, including a successful empty result',
    async (field) => {
      fuel.setState({ todayLoadedForUserId: 'user-1', todayLoadedKey: DAY });
      app.setState({ [field]: null, macroTarget: null });
      await render();
      await settle();
      expect(setSnapshot).not.toHaveBeenCalled();

      await act(async () => { app.setState({ [field]: 'user-1' }); });
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);
      expect(JSON.parse(setSnapshot.mock.calls[0][0]).fuel).toBeNull();
    },
  );

  it('does not label yesterday’s totals as today when the new day failed to load', async () => {
    fuel.setState({ todayLoadedForUserId: 'user-1', todayLoadedKey: '2026-11-02', todayTotals: { calories: 1800, protein: 120 } });
    await render();
    await settle();
    expect(setSnapshot).not.toHaveBeenCalled();
  });

  it('requires nutrition from the signed-in account and clears the snapshot on sign-out', async () => {
    fuel.setState({ todayLoadedForUserId: 'user-2', todayLoadedKey: DAY });
    await render();
    await settle();
    expect(setSnapshot).not.toHaveBeenCalled();
    await act(async () => { root.render(null); });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending write when the account signs out', async () => {
    fuel.setState({ todayLoadedForUserId: 'user-1', todayLoadedKey: DAY });
    await render();
    await act(async () => { root.render(null); });
    await settle();
    expect(setSnapshot).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});
