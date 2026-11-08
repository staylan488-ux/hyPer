// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dateFns from 'date-fns';
import { create } from 'zustand';

import { loadNativeModule } from './helpers/loadNativeModule';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// useFinishedToday (native/src/lib/today.ts): Today's and Train's record of
// the workout finished today. Browsing an older month in History must not
// take the record away, and must not move History either.

type Workout = { id: string; date: string; completed: boolean; day_label: string; split_day_id: string | null; sets: { completed: boolean }[] };
type Finished = { id: string; title: string; day: string; sets: number } | null | undefined;

const pushDay: Workout = { id: 'w1', date: '2026-11-07', completed: true, day_label: 'Push', split_day_id: null, sets: [{ completed: true }, { completed: false }] };
const october = new Date(2026, 9, 1);
const november = new Date(2026, 10, 1);

const fetchHistoryMonth = vi.fn<(month: Date) => Promise<{ workouts: Workout[]; activities: [] }>>();
const loadHistoryMonth = vi.fn<() => Promise<void>>();
const historyStore = create(() => ({ month: november, workouts: [] as Workout[], plans: {} as Record<string, unknown> }));

let useFinishedToday: (done: boolean) => Finished;
let root: Root;
let host: HTMLDivElement;

function Probe() {
  const finished = useFinishedToday(true);
  const text = finished === undefined ? 'reading' : finished === null ? 'Trained today' : `${finished.title} · ${finished.sets} sets · ${finished.day}`;
  return createElement('span', null, text);
}

beforeEach(() => {
  fetchHistoryMonth.mockReset();
  loadHistoryMonth.mockReset().mockResolvedValue();
  historyStore.setState({ month: november, workouts: [], plans: {} });
  ({ useFinishedToday } = loadNativeModule<{ useFinishedToday: typeof useFinishedToday }>('lib/today.ts', {
    'date-fns': dateFns,
    zustand: { create },
    '@/lib/historyMonth': {
      fetchHistoryMonth,
      historyDayKey: (workout: Workout) => workout.date,
      historyWorkoutTitle: (workout: Workout) => workout.day_label,
      orderHistoryMovements: (sets: Workout['sets']) => [{ sets }],
    },
    '@/lib/workoutSessions': { getWorkoutDurationMs: () => 52 * 60_000 },
    './history': { loadHistoryMonth, useHistoryStore: historyStore },
    '@/stores/appStore': { useAppStore: create(() => ({ currentWorkout: null })) },
    '@/stores/authStore': { useAuthStore: create(() => ({ user: { id: 'user-1' } })) },
    './accountData': { useAccountDay: create(() => ({ dayKey: '2026-11-07', refreshedAt: 1 })), useWorkoutsRevision: create(() => ({ revision: 0 })) },
    // useTodayPlan's imports; useFinishedToday reads none of them.
    '@/lib/todayModel': {},
    '@/hooks/useAdaptiveSplitScheduling': {},
    '@/hooks/usePlanSchedule': {},
    '@/hooks/useScheduleWorkouts': {},
    '@/hooks/useWeekSessions': {},
    '@/lib/todayDay': {},
    './launchCache': {},
    './launchSnapshot': {},
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function show() {
  await act(async () => {
    root.render(createElement(Probe));
  });
}

describe("Today's record while History shows another month", () => {
  it('reads this month itself, keeping the record and leaving History on the month it shows', async () => {
    historyStore.setState({ month: october, workouts: [] });
    fetchHistoryMonth.mockResolvedValue({ workouts: [pushDay], activities: [] });

    await show();

    expect(host.textContent).toBe('Push · 1 sets · 2026-11-07');
    expect(fetchHistoryMonth).toHaveBeenCalledOnce();
    expect(dateFns.format(fetchHistoryMonth.mock.calls[0][0], 'yyyy-MM-dd')).toBe('2026-11-01');
    expect(loadHistoryMonth).not.toHaveBeenCalled();
    expect(historyStore.getState().month).toBe(october);
  });

  it('says "Trained today" when that read fails, and says why in the log', async () => {
    historyStore.setState({ month: october, workouts: [] });
    fetchHistoryMonth.mockRejectedValue(new Error('offline'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await show();

    expect(host.textContent).toBe('Trained today');
    expect(logged).toHaveBeenCalledWith("Could not read today's workout:", expect.any(Error));
  });

  it("uses History's own month while it shows this month", async () => {
    historyStore.setState({ month: november, workouts: [pushDay] });

    await show();

    expect(host.textContent).toBe('Push · 1 sets · 2026-11-07');
    expect(loadHistoryMonth).toHaveBeenCalledOnce();
    expect(fetchHistoryMonth).not.toHaveBeenCalled();
  });
});
