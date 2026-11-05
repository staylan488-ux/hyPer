// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import type { PlanSchedule } from '@/lib/planSchedule';
import type { Split, SplitDay } from '@/types';

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
  activeSplit: null as Split | null,
  workoutMode: 'flexible' as 'flexible' | 'split',
  macroTarget: { calories: 2000, protein: 150 } as { calories: number; protein: number } | null,
  nutritionProfile: null,
}));
const fuel = create(() => ({
  todayKey: DAY,
  todayLoadedForUserId: null as string | null,
  todayLoadedKey: null as string | null,
  todayTotals: { calories: 0, protein: 0 },
}));
const account = create(() => ({ dayKey: DAY, loading: false }));
const FLEXIBLE = { hero: { kind: 'flexible' }, schedule: null, scheduleWorkouts: [], adaptiveSchedulingEnabled: false, aheadKnown: true };
// Only the launch-copy cases set `seeded`; the other cases' plan has no seeded field.
const todayPlan = create<Record<string, unknown>>(() => FLEXIBLE);

const split = {
  id: 'split-1',
  name: 'Upper Lower',
  days_per_week: 3,
  days: ['Upper A', 'Lower A', 'Upper B'].map((name, index) => ({
    id: `day-${index + 1}`, split_id: 'split-1', day_name: name, day_order: index + 1, exercises: [],
  }) as unknown as SplitDay),
} as unknown as Split;
const schedule: PlanSchedule = { splitId: 'split-1', startDate: '2026-10-26', mode: 'fixed', weekdays: [1, 3, 5] };

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
    app.setState({ workoutMode: 'flexible', activeSplit: null });
    fuel.setState({ todayKey: DAY, todayLoadedForUserId: null, todayLoadedKey: null, todayTotals: { calories: 0, protein: 0 } });
    account.setState({ dayKey: DAY, loading: false });
    todayPlan.setState(FLEXIBLE, true);
    ({ useWidgetSnapshot } = loadNativeModule<{ useWidgetSnapshot: () => void }>('lib/widgets.ts', {
      '@/stores/appStore': { useAppStore: app },
      '@/stores/authStore': { useAuthStore: auth },
      '../../modules/hyper-widget-data': { setSnapshot, clear },
      './accountData': { useAccountDay: () => account() },
      './fuel': { useFuelStore: fuel },
      './today': { useTodayPlan: () => todayPlan() },
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

  it('never writes a plan shown from the phone’s copy', async () => {
    fuel.setState({ todayLoadedForUserId: 'user-1', todayLoadedKey: DAY });
    todayPlan.setState({ seeded: true });
    await render();
    await settle();
    expect(setSnapshot).not.toHaveBeenCalled();

    await act(async () => { todayPlan.setState({ seeded: false }); });
    await settle();
    expect(setSnapshot).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending write when the account signs out', async () => {
    fuel.setState({ todayLoadedForUserId: 'user-1', todayLoadedKey: DAY });
    await render();
    await act(async () => { root.render(null); });
    await settle();
    expect(setSnapshot).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  describe('while the days ahead are unknown', () => {
    // A trained day in program mode whose completions read then failed.
    const trained = (aheadKnown: boolean) => todayPlan.setState({
      hero: { kind: 'done', title: 'Upper A' }, schedule, scheduleWorkouts: [], adaptiveSchedulingEnabled: false, aheadKnown,
    }, true);
    const written = (call: number) => JSON.parse(setSnapshot.mock.calls[call][0]) as widgetRules.WidgetSnapshot;
    beforeEach(() => {
      app.setState({ workoutMode: 'split', activeSplit: split });
      fuel.setState({ todayLoadedForUserId: 'user-1', todayLoadedKey: DAY, todayTotals: { calories: 500, protein: 40 } });
      trained(true);
    });

    it('keeps updating Fuel beside the plan last written today', async () => {
      await render();
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);
      const plan = written(0).plan;
      expect(plan[0]).toMatchObject({ day: DAY, kind: 'done' });
      expect(plan).toHaveLength(widgetRules.WIDGET_PLAN_DAYS);

      await act(async () => { trained(false); });
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);

      await act(async () => { fuel.setState({ todayTotals: { calories: 1250, protein: 90 } }); });
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(2);
      expect(written(1).fuel).toMatchObject({ calories: 1250, protein: 90 });
      expect(written(1).plan).toEqual(plan);
    });

    it('still turns today to trained when a session ends, keeping the days after it', async () => {
      todayPlan.setState({ hero: { kind: 'resume', dayName: 'Upper A' }, aheadKnown: true });
      await render();
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);
      const live = written(0).plan;
      expect(live[0]).toEqual({ day: DAY, title: 'Upper A', detail: 'In progress', kind: 'live' });

      // Finishing changes the completions key; their re-read then fails.
      await act(async () => { trained(false); });
      await settle();
      await act(async () => { fuel.setState({ todayTotals: { calories: 1250, protein: 90 } }); });
      await settle();
      const last = written(setSnapshot.mock.calls.length - 1);
      expect(last.fuel).toMatchObject({ calories: 1250, protein: 90 });
      expect(last.plan[0]).toMatchObject({ day: DAY, title: 'Trained today', kind: 'done' });
      expect(last.plan[0].detail).toMatch(/^Next: Tomorrow · /);
      expect(last.plan.slice(1)).toEqual(live.slice(1));
    });

    it('keeps the plan last written while a plan from the phone’s copy shows', async () => {
      await render();
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);
      const plan = written(0).plan;

      // A re-read puts the copy's plan back on screen (lib/today.ts): its hero is not known.
      await act(async () => {
        todayPlan.setState({ hero: { kind: 'planned', day: split.days[1] }, seeded: true, aheadKnown: false });
      });
      await settle();
      await act(async () => { fuel.setState({ todayTotals: { calories: 1250, protein: 90 } }); });
      await settle();
      const last = written(setSnapshot.mock.calls.length - 1);
      expect(last.fuel).toMatchObject({ calories: 1250, protein: 90 });
      expect(last.plan).toEqual(plan);
    });

    it('never reuses another day’s plan', async () => {
      await render();
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);

      const NEXT = '2026-11-04';
      await act(async () => {
        account.setState({ dayKey: NEXT });
        fuel.setState({ todayKey: NEXT, todayLoadedKey: NEXT, todayTotals: { calories: 0, protein: 0 } });
        todayPlan.setState({ hero: { kind: 'rest' }, aheadKnown: false });
      });
      await settle();
      await act(async () => { fuel.setState({ todayTotals: { calories: 300, protein: 20 } }); });
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);
    });

    it('writes nothing without an earlier plan, including after sign-out', async () => {
      await render();
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);
      await act(async () => { root.render(null); });
      expect(clear).toHaveBeenCalledTimes(1);

      trained(false);
      await render();
      await act(async () => { fuel.setState({ todayTotals: { calories: 900, protein: 60 } }); });
      await settle();
      expect(setSnapshot).toHaveBeenCalledTimes(1);
    });
  });
});
