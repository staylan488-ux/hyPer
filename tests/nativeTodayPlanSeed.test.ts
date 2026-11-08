// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as zustand from 'zustand';
import { create } from 'zustand';

import type { PlanSchedule } from '@/lib/planSchedule';
import * as todayModel from '@/lib/todayModel';
import type { HeroState } from '@/lib/todayModel';
import type { Split, Workout, WorkoutMode } from '@/types';
import * as launchSnapshot from '../native/src/lib/launchSnapshot';
import type { TodaySeed } from '../native/src/lib/launchSnapshot';
import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = '2026-11-04';
const USER = 'user-1';
const ppl: Split = {
  id: 'ppl', user_id: USER, name: 'PPL', description: null, days_per_week: 4, is_active: true,
  days: [
    { id: 'push', split_id: 'ppl', day_name: 'Push', day_order: 0, exercises: [] },
    { id: 'legs', split_id: 'ppl', day_name: 'Legs', day_order: 1, exercises: [] },
  ],
};
// In order from Push, saved this morning.
const SCHEDULE: PlanSchedule = { splitId: 'ppl', startDate: DAY, mode: 'flex', weekdays: [], flexAnchorIndex: 0, updatedAt: `${DAY}T08:00:00.000Z` };
const BASIS = launchSnapshot.planBasis({ activeSplit: ppl, schedule: null, adaptiveSchedulingEnabled: false });
const plannedSeed = (overrides: Partial<TodaySeed> = {}): TodaySeed => ({
  dayKey: DAY, splitId: 'ppl', mode: 'split', basis: BASIS, hero: { kind: 'planned', dayId: 'push' }, next: null, weekDone: 2, ...overrides,
});
const liveWorkout = { id: 'w1', user_id: USER, split_day_id: 'push', date: DAY, notes: null, completed: false, created_at: `${DAY}T12:00:00Z`, sets: [] } as Workout;

const auth = create<{ user: { id: string } | null }>(() => ({ user: { id: USER } }));
const accountDay = create(() => ({ dayKey: DAY, refreshedAt: 1, loading: true }));
const app = create(() => ({
  activeSplit: ppl as Split | null,
  currentWorkout: null as Workout | null,
  currentWorkoutDayPlan: null,
  workoutMode: 'split' as WorkoutMode,
  hydratedForUserId: null as string | null,
  workoutLoadedForUserId: null as string | null,
}));
const hint = create<{ seed: TodaySeed | null; holdPlan: boolean }>(() => ({ seed: null, holdPlan: false }));
const retry = () => {};
const reads = create(() => ({
  adaptive: false,
  schedule: null as PlanSchedule | null,
  scheduleLoading: false,
  scheduleWorkouts: [] as never[],
  scheduleWorkoutsLoading: false,
  scheduleError: false,
  weekDates: null as string[] | null,
  tick: 0,
}));
const readTodayDone = vi.fn<(userId: string, dayKey: string) => Promise<{ title: string } | null>>();
const noteTodayPlan = vi.fn<(seed: TodaySeed) => void>();

type Plan = { hero: HeroState; next: string | null; upNext?: unknown; weekDone: number | null; seeded: boolean };
let useTodayPlan: () => Plan;
let latest: Plan;
const renders: Plan[] = [];
const record = (plan: Plan) => {
  latest = plan;
  renders.push(plan);
};
function Probe({ onPlan }: { onPlan: (plan: Plan) => void }) {
  reads((state) => state.tick);
  const plan = useTodayPlan();
  useEffect(() => onPlan(plan));
  return null;
}

let root: Root;
let host: HTMLDivElement;
const render = async () => {
  await act(async () => { root.render(createElement(Probe, { onPlan: record })); });
};
const update = async (change: () => void) => {
  await act(async () => { change(); });
};
const ready = () => app.setState({ hydratedForUserId: USER, workoutLoadedForUserId: USER });

beforeEach(() => {
  renders.length = 0;
  auth.setState({ user: { id: USER } });
  accountDay.setState({ dayKey: DAY, refreshedAt: 1, loading: true });
  app.setState({ activeSplit: ppl, currentWorkout: null, workoutMode: 'split', hydratedForUserId: null, workoutLoadedForUserId: null });
  hint.setState({ seed: plannedSeed(), holdPlan: false });
  reads.setState({ adaptive: false, schedule: null, scheduleLoading: false, scheduleWorkouts: [], scheduleWorkoutsLoading: false, scheduleError: false, weekDates: null, tick: 0 });
  readTodayDone.mockReset().mockReturnValue(new Promise(() => {}));
  noteTodayPlan.mockReset();
  ({ useTodayPlan } = loadNativeModule<{ useTodayPlan: () => Plan }>('lib/today.ts', {
    zustand,
    '@/lib/todayModel': todayModel,
    '@/hooks/useAdaptiveSplitScheduling': { useAdaptiveSplitScheduling: () => reads((state) => state.adaptive) },
    '@/hooks/usePlanSchedule': {
      usePlanSchedule: () => {
        const state = reads();
        return { schedule: state.schedule, loading: state.scheduleLoading };
      },
    },
    '@/hooks/useScheduleWorkouts': {
      useScheduleWorkouts: () => {
        const state = reads();
        return { workouts: state.scheduleWorkouts, loading: state.scheduleWorkoutsLoading, error: state.scheduleError, retry };
      },
    },
    '@/hooks/useWeekSessions': { useWeekSessions: () => ({ dates: reads((state) => state.weekDates), failed: false }) },
    '@/lib/todayDay': { readTodayDone },
    '@/stores/appStore': { useAppStore: app },
    '@/stores/authStore': { useAuthStore: auth },
    './accountData': { useAccountDay: accountDay, useWorkoutsRevision: create(() => ({ revision: 0 })) },
    './launchCache': { useLaunchHint: hint, noteTodayPlan },
    './launchSnapshot': launchSnapshot,
    // useFinishedToday's imports; useTodayPlan reads none of them.
    'date-fns': {},
    '@/lib/historyMonth': {},
    '@/lib/workoutSessions': {},
    './history': {},
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('today’s plan from the phone’s copy', () => {
  it('shows the seeded planned day from the live program while the reads load', async () => {
    await render();
    expect(latest.seeded).toBe(true);
    expect(latest.hero).toEqual({ kind: 'planned', day: ppl.days[0] });
    expect(latest.hero.kind === 'planned' && latest.hero.day).toBe(ppl.days[0]);
    expect(noteTodayPlan).not.toHaveBeenCalled();
  });

  it('gives the seed’s next session, with the session up next unknown (Schedule waits for the reads)', async () => {
    hint.setState({ seed: plannedSeed({ hero: { kind: 'rest' }, next: 'Tomorrow · Legs' }) });
    await render();
    expect(latest).toMatchObject({ seeded: true, hero: { kind: 'rest' }, next: 'Tomorrow · Legs' });
    expect('upNext' in latest).toBe(true);
    expect(latest.upNext).toBeUndefined();
  });

  it('gives way to the real plan once the store is ready and the reads land', async () => {
    readTodayDone.mockResolvedValue({ title: 'Push' });
    await render();
    expect(latest.seeded).toBe(true);
    await update(() => {
      ready();
      accountDay.setState({ loading: false });
    });
    expect(latest).toMatchObject({ seeded: false, hero: { kind: 'done', title: 'Push' } });
  });

  it.each([
    ['another day', () => hint.setState({ seed: plannedSeed({ dayKey: '2026-11-03' }) })],
    ['another program', () => hint.setState({ seed: plannedSeed({ splitId: 'other' }) })],
    ['another mode', () => hint.setState({ seed: plannedSeed({ mode: 'flexible' }) })],
    ['a day no longer in the program', () => hint.setState({ seed: plannedSeed({ hero: { kind: 'planned', dayId: 'gone' } }) })],
    ['another schedule', () => reads.setState({ schedule: SCHEDULE })],
    ['adaptive scheduling turned on', () => reads.setState({ adaptive: true })],
    ['the program’s days in another order', () => app.setState({ activeSplit: { ...ppl, days: [...ppl.days].reverse() } })],
    ['a workout on screen', () => app.setState({ currentWorkout: liveWorkout })],
    ['the plan held for the workout read', () => hint.setState({ holdPlan: true })],
  ])('shows no seed for %s', async (_name, change) => {
    change();
    await render();
    expect(latest.seeded).toBe(false);
    expect(latest.hero.kind === 'planned').toBe(false);
  });

  it('shows a real schedule error once the store is ready, not the seed', async () => {
    readTodayDone.mockResolvedValue(null);
    ready();
    accountDay.setState({ loading: false });
    reads.setState({ scheduleError: true });
    await render();
    expect(latest.seeded).toBe(false);
    expect(latest.hero.kind).toBe('schedule-error');
  });

  it('keeps the seeded hero’s reference across renders with unchanged inputs', async () => {
    await render();
    const first = latest.hero;
    await update(() => reads.setState({ tick: 1 }));
    expect(renders.length).toBeGreaterThan(1);
    expect(latest.hero).toBe(first);
  });

  it('counts the week from the seed until the week’s read lands', async () => {
    await render();
    expect(latest.weekDone).toBe(2);
    await update(() => reads.setState({ weekDates: ['2026-11-02', '2026-11-03', '2026-11-04'] }));
    expect(latest.weekDone).toBe(3);
  });
});

describe('holding the plan for the workout read', () => {
  it('stays loading until this launch’s workout read lands', async () => {
    readTodayDone.mockResolvedValue({ title: 'Push' });
    hint.setState({ seed: null, holdPlan: true });
    await render();
    expect(latest.hero.kind).toBe('loading');
    await update(() => app.setState({ workoutLoadedForUserId: 'user-2' }));
    expect(latest.hero.kind).toBe('loading');
    await update(() => accountDay.setState({ loading: false }));
    await update(() => app.setState({ workoutLoadedForUserId: USER }));
    expect(latest.hero).toEqual({ kind: 'done', title: 'Push' });
  });

  it('offers Retry, not an empty place, once the account load ends without the workout read', async () => {
    readTodayDone.mockResolvedValue({ title: 'Push' });
    hint.setState({ seed: null, holdPlan: true });
    accountDay.setState({ loading: false });
    await render();
    expect(latest.hero.kind).toBe('schedule-error');
    await update(() => app.setState({ workoutLoadedForUserId: USER }));
    expect(latest.hero).toEqual({ kind: 'done', title: 'Push' });
  });
});

describe('noting today’s plan for the next cold start', () => {
  it('notes a stable plan once, from a successful done read', async () => {
    readTodayDone.mockResolvedValue({ title: 'Push' });
    ready();
    accountDay.setState({ loading: false });
    reads.setState({ weekDates: ['2026-11-02'] });
    await render();
    await update(() => reads.setState({ tick: 1 }));
    expect(noteTodayPlan).toHaveBeenCalledTimes(1);
    expect(noteTodayPlan).toHaveBeenCalledWith({
      dayKey: DAY, splitId: 'ppl', mode: 'split', basis: BASIS, hero: { kind: 'done', title: 'Push' }, next: null, weekDone: 1,
    });
  });

  it('does not note a plan when the done read failed', async () => {
    readTodayDone.mockRejectedValue(new Error('offline'));
    ready();
    accountDay.setState({ loading: false });
    await render();
    expect(latest.hero.kind).not.toBe('loading');
    expect(noteTodayPlan).not.toHaveBeenCalled();
  });

  it('does not note a plan before the store is ready', async () => {
    readTodayDone.mockResolvedValue(null);
    hint.setState({ seed: null });
    accountDay.setState({ loading: false });
    await render();
    expect(latest.hero.kind).toBe('no-schedule');
    expect(noteTodayPlan).not.toHaveBeenCalled();
  });

  it('does not note a seeded, loading or live plan', async () => {
    readTodayDone.mockResolvedValue(null);
    reads.setState({ scheduleLoading: true });
    await render();
    expect(latest.seeded).toBe(true);
    // Ready, but the schedule is still being read.
    await update(() => {
      hint.setState({ seed: null });
      ready();
    });
    expect(latest.hero.kind).toBe('loading');
    await update(() => {
      reads.setState({ scheduleLoading: false });
      app.setState({ currentWorkout: liveWorkout });
    });
    expect(latest.hero.kind).toBe('resume');
    expect(noteTodayPlan).not.toHaveBeenCalled();
  });
});

describe('a plan decided earlier this session', () => {
  // What launchCache does with a note: screens hold the latest decision.
  const holdNoted = () => hint.setState({ seed: noteTodayPlan.mock.calls.at(-1)?.[0] ?? null });

  it('shows the card’s place, never the decision from before, while a changed schedule is read', async () => {
    readTodayDone.mockResolvedValue(null);
    ready();
    accountDay.setState({ loading: false });
    hint.setState({ seed: null });
    await render();
    expect(latest.hero.kind).toBe('no-schedule');
    await update(holdNoted);
    expect(latest.seeded).toBe(false);
    // Set up saves a schedule: shown at once, while its sessions are read.
    await update(() => reads.setState({ schedule: SCHEDULE, scheduleWorkoutsLoading: true }));
    expect(latest).toMatchObject({ seeded: false, hero: { kind: 'loading' } });
    await update(() => reads.setState({ scheduleWorkoutsLoading: false }));
    expect(latest).toMatchObject({ seeded: false, hero: { kind: 'planned', day: ppl.days[0] } });
  });

  it('does the same when the program’s days change', async () => {
    readTodayDone.mockResolvedValue(null);
    ready();
    accountDay.setState({ loading: false });
    hint.setState({ seed: null });
    reads.setState({ schedule: SCHEDULE });
    await render();
    expect(latest.hero).toEqual({ kind: 'planned', day: ppl.days[0] });
    await update(holdNoted);
    const legsFirst = { ...ppl, days: [...ppl.days].reverse() };
    await update(() => {
      app.setState({ activeSplit: legsFirst });
      reads.setState({ scheduleWorkoutsLoading: true });
    });
    expect(latest).toMatchObject({ seeded: false, hero: { kind: 'loading' } });
  });

  it('still fills a screen mounted later from the same schedule at once', async () => {
    reads.setState({ schedule: SCHEDULE });
    hint.setState({ seed: plannedSeed({ basis: launchSnapshot.planBasis({ activeSplit: ppl, schedule: SCHEDULE, adaptiveSchedulingEnabled: false }) }) });
    ready();
    accountDay.setState({ loading: false });
    await render();
    // Its own done read is still out.
    expect(latest).toMatchObject({ seeded: true, hero: { kind: 'planned', day: ppl.days[0] } });
  });
});
