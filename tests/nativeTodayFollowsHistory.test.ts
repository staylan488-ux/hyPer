// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import type { PlanSchedule, ScheduleWorkout } from '@/lib/planSchedule';
import type { Split } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

const mocks = vi.hoisted(() => ({ loadScheduleWorkouts: vi.fn() }));
vi.mock('@/lib/planSchedule', async (original) => ({
  ...(await original<typeof import('@/lib/planSchedule')>()),
  loadScheduleWorkouts: mocks.loadScheduleWorkouts,
}));

import * as scheduleWorkouts from '@/hooks/useScheduleWorkouts';
import * as todayModel from '@/lib/todayModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The part of useTodayPlan (native/src/lib/today.ts) read here. Written out:
// importing its types would bring React Native's global types into the test build.
type TodayPlan = { hero: todayModel.HeroState };

const split = {
  id: 'split-1', name: 'Upper lower', days_per_week: 2,
  days: [{ id: 'day-a', day_name: 'Upper', exercises: [] }, { id: 'day-b', day_name: 'Lower', exercises: [] }],
} as unknown as Split;
const schedule: PlanSchedule = { splitId: 'split-1', startDate: '2026-10-01', mode: 'flex', weekdays: [], flexAnchorIndex: 0 };
const done = (id: string, date: string, dayId: string): ScheduleWorkout => ({
  id, date, split_day_id: dayId, completed: true, created_at: `${date}T17:00:00.000Z`, completed_at: `${date}T18:00:00.000Z`,
}) as ScheduleWorkout;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

let root: Root;
let host: HTMLDivElement;
let useTodayPlan: () => TodayPlan;
const readTodayDone = vi.fn();
const useWorkoutsRevision = create<{ revision: number; bump: () => void }>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

// Shows the plan card's state: the planned day's name, else the hero's kind.
function Probe() {
  const { hero } = useTodayPlan();
  return createElement('span', null, hero.kind === 'planned' ? hero.day.day_name : hero.kind);
}
const shownDay = () => host.textContent;

beforeEach(async () => {
  useWorkoutsRevision.setState({ revision: 0 });
  readTodayDone.mockReset().mockResolvedValue(null);
  mocks.loadScheduleWorkouts.mockReset().mockResolvedValue([done('w1', '2026-11-01', 'day-a')]);
  const appStore = create(() => ({
    activeSplit: split, currentWorkout: null, currentWorkoutDayPlan: null, workoutMode: 'program', hydratedForUserId: 'user-1',
  }));
  ({ useTodayPlan } = loadNativeModule<{ useTodayPlan: typeof useTodayPlan }>('lib/today.ts', {
    zustand: { create },
    '@/lib/todayModel': todayModel,
    '@/hooks/useAdaptiveSplitScheduling': { useAdaptiveSplitScheduling: () => true },
    '@/hooks/usePlanSchedule': { usePlanSchedule: () => ({ schedule, loading: false }) },
    '@/hooks/useScheduleWorkouts': scheduleWorkouts,
    '@/hooks/useWeekSessions': { useWeekSessions: () => ({ dates: [], failed: false }) },
    '@/lib/todayDay': { readTodayDone },
    '@/stores/appStore': { useAppStore: appStore },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    './accountData': {
      useAccountDay: create(() => ({ dayKey: '2026-11-03', refreshedAt: 1, loading: false })),
      useWorkoutsRevision,
    },
    // useFinishedToday's imports; useTodayPlan reads none of them.
    'date-fns': {},
    '@/lib/historyMonth': {},
    '@/lib/workoutSessions': {},
    './history': {},
    // The launch copy (lib/launchCache.ts): none kept on this phone.
    './launchCache': { useLaunchHint: create(() => ({ seed: null, holdPlan: false })), noteTodayPlan: () => {} },
    './launchSnapshot': { heroFromSeed: () => null, planBasis: () => '', seedHero: () => null },
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(Probe)); });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Today and Train after a History change', () => {
  it('re-reads what was done in place, then plans from it', async () => {
    // Upper done on the 1st: Lower is up next.
    expect(shownDay()).toBe('Lower');
    expect(readTodayDone).toHaveBeenCalledTimes(1);

    // History finishes the old Lower from the 2nd: Upper is up next.
    const reread = deferred<ScheduleWorkout[]>();
    mocks.loadScheduleWorkouts.mockReturnValueOnce(reread.promise);
    await act(async () => { useWorkoutsRevision.getState().bump(); });
    expect(mocks.loadScheduleWorkouts).toHaveBeenCalledTimes(2);
    expect(readTodayDone).toHaveBeenCalledTimes(2);
    // The card keeps its plan while the read runs, rather than flashing Loading.
    expect(shownDay()).toBe('Lower');

    await act(async () => { reread.resolve([done('w1', '2026-11-01', 'day-a'), done('w2', '2026-11-02', 'day-b')]); });
    expect(shownDay()).toBe('Upper');
  });

  it('shows today as not done once History deletes the workout finished today', async () => {
    readTodayDone.mockResolvedValue({ title: 'Session complete' });
    await act(async () => { useWorkoutsRevision.getState().bump(); });
    expect(shownDay()).toBe('done');

    readTodayDone.mockResolvedValue(null);
    await act(async () => { useWorkoutsRevision.getState().bump(); });
    expect(shownDay()).toBe('Lower');
  });

  it('keeps the plan when a re-read fails', async () => {
    mocks.loadScheduleWorkouts.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { useWorkoutsRevision.getState().bump(); });
    expect(shownDay()).toBe('Lower');
  });
});
