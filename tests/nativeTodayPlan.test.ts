// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as zustand from 'zustand';

import type { PlanSchedule, ScheduleWorkout } from '@/lib/planSchedule';
import * as todayModel from '@/lib/todayModel';
import type { Split, SplitDay } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// useTodayPlan (native/src/lib/today.ts): on a day already trained, the next
// session is planned from the completions, so it waits for them.

const day = (id: string, name: string): SplitDay => ({ id, split_id: 'split-1', day_name: name, day_order: Number(id.slice(-1)), exercises: [] });
const days = [day('day-1', 'Upper A'), day('day-2', 'Lower A'), day('day-3', 'Upper B')];
const split = { id: 'split-1', name: 'Upper Lower', days_per_week: 3, is_active: true, days } as unknown as Split;
// In order from Upper A, saved before this week's sessions.
const schedule: PlanSchedule = { splitId: 'split-1', startDate: '2026-11-02', mode: 'flex', weekdays: [], anchorDay: 0, flexAnchorIndex: 0, updatedAt: '2026-11-02T06:00:00.000Z' };
const done = (id: string, date: string, dayId: string): ScheduleWorkout => ({ id, date, split_day_id: dayId, completed: true, created_at: `${date}T17:00:00.000Z` });

const app = zustand.create(() => ({
  activeSplit: split, currentWorkout: null, currentWorkoutDayPlan: null, splits: [split], workoutMode: 'split', hydratedForUserId: 'user-1',
}));
const completions = zustand.create(() => ({ workouts: [] as ScheduleWorkout[], loading: true, error: false, retry: () => {} }));
let trainedToday: { title: string } | null = { title: 'Lower A' };
let saved: PlanSchedule | null = schedule;

type Plan = { next: string | null; upNext: SplitDay | null | undefined; aheadKnown: boolean; hero: todayModel.HeroState };
let plan: Plan | null = null;
let root: Root;
let host: HTMLDivElement;

async function render() {
  const { useTodayPlan } = loadNativeModule<{ useTodayPlan: () => Plan }>('lib/today.ts', {
    zustand,
    '@/lib/todayModel': todayModel,
    '@/hooks/useAdaptiveSplitScheduling': { useAdaptiveSplitScheduling: () => true },
    '@/hooks/usePlanSchedule': { usePlanSchedule: () => ({ schedule: saved, loading: false }) },
    '@/hooks/useScheduleWorkouts': { useScheduleWorkouts: () => completions() },
    '@/hooks/useWeekSessions': { useWeekSessions: () => ({ dates: [] }) },
    '@/lib/todayDay': { readTodayDone: async () => trainedToday },
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore: zustand.create(() => ({ user: { id: 'user-1' } })) },
    './accountData': {
      useAccountDay: () => ({ dayKey: '2026-11-04', refreshedAt: Date.parse('2026-11-04T18:00:00Z'), loading: false }),
      useWorkoutsRevision: zustand.create(() => ({ revision: 0 })),
    },
  });
  const Probe = () => {
    const current = useTodayPlan();
    useEffect(() => { plan = current; });
    return null;
  };
  await act(async () => { root.render(createElement(Probe)); });
}

beforeEach(() => {
  plan = null;
  trainedToday = { title: 'Lower A' };
  saved = schedule;
  completions.setState({ workouts: [], loading: true, error: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Today’s plan on a day already trained', () => {
  it('names the next session only once the completions load', async () => {
    await render();
    expect(plan?.hero.kind).toBe('done');
    expect(plan).toMatchObject({ next: null, upNext: undefined, aheadKnown: false });

    // Upper A yesterday, Lower A today: Upper B is next.
    await act(async () => {
      completions.setState({ workouts: [done('w-1', '2026-11-03', 'day-1'), done('w-2', '2026-11-04', 'day-2')], loading: false });
    });
    expect(plan).toMatchObject({ next: 'Tomorrow · Upper B', upNext: days[2], aheadKnown: true });
  });

  it('leaves the session up next unknown when the completions fail, rather than one planned without them', async () => {
    completions.setState({ workouts: [], loading: false, error: true });
    await render();
    expect(plan?.hero.kind).toBe('done');
    expect(plan).toMatchObject({ next: null, upNext: undefined, aheadKnown: false });
  });
});

describe('Today’s plan before a session', () => {
  it('leaves the session up next unknown, so the schedule sheet does not check the saved day', async () => {
    trainedToday = null;
    completions.setState({ workouts: [], loading: false, error: true });
    await render();
    expect(plan?.hero.kind).toBe('schedule-error');
    expect(plan).toMatchObject({ next: null, upNext: undefined, aheadKnown: false });
  });

  it('still names none without a schedule', async () => {
    trainedToday = null;
    saved = null;
    completions.setState({ workouts: [], loading: false, error: false });
    await render();
    expect(plan?.hero.kind).toBe('no-schedule');
    expect(plan).toMatchObject({ upNext: null });
  });
});
