import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';

import { useTodayRefresh } from '@/hooks/useTodayRefresh';
import { todayKey } from '@/lib/todayRefresh';
import { useAppStore } from '@/stores/appStore';

import { useFuelStore } from './fuel';

const noNewDayWork = () => {};

/** Program, live workout, targets, weekly volume, workout mode, profile and the day's food. */
async function loadAccount(day: string, force = false) {
  const app = useAppStore.getState();
  await Promise.all([
    app.fetchSplits(force ? { force: true } : undefined),
    app.fetchMacroTarget(),
    app.calculateWeeklyVolume(),
    app.fetchCurrentWorkout(),
    app.fetchWorkoutMode(),
    app.fetchNutritionProfile(),
    useFuelStore.getState().loadToday(day),
  ]);
}

/** The account load's day and timing, for screens that read the same day. */
export const useAccountDay = create<{ dayKey: string; refreshedAt: number; loading: boolean }>(() => ({
  dayKey: todayKey(new Date()),
  refreshedAt: Date.now(),
  loading: true,
}));

/**
 * Loads the signed-in account into the shared stores the way the web Today
 * screen does: program, live workout, targets, weekly volume, workout mode,
 * nutrition profile and today's food. The shared useTodayRefresh runs it again
 * when the app returns on a new day or after its refresh interval, and at
 * local midnight while the app stays open. Mounted once, in the tab layout.
 */
export function useAccountData() {
  const load = useCallback(async (day: string) => {
    await loadAccount(day);
    // Re-learn expenditure at most weekly, after the screens are already up.
    void useAppStore.getState().refreshAdaptiveTargets();
    return day;
  }, []);
  const { dayKey, refreshedAt, loading } = useTodayRefresh(load, noNewDayWork);
  useEffect(() => {
    useAccountDay.setState({ dayKey, refreshedAt, loading });
  }, [dayKey, refreshedAt, loading]);
}

/**
 * Pull to refresh for screens built on the account load (Today, Train): the
 * same reads, fresh, then the screens re-read the day. `also` runs alongside,
 * for a screen's own data.
 */
export function useAccountRefresh(also?: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const day = todayKey(new Date());
      await Promise.all([loadAccount(day, true), also?.()]);
      useAccountDay.setState({ dayKey: day, refreshedAt: Date.now() });
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [also]);
  return { refreshing, refresh };
}
