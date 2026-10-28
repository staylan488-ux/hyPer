import { useCallback, useEffect } from 'react';
import { create } from 'zustand';

import { useTodayRefresh } from '@/hooks/useTodayRefresh';
import { todayKey } from '@/lib/todayRefresh';
import { useAppStore } from '@/stores/appStore';

import { useFuelStore } from './fuel';

const noNewDayWork = () => {};

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
    const app = useAppStore.getState();
    await Promise.all([
      app.fetchSplits(),
      app.fetchMacroTarget(),
      app.calculateWeeklyVolume(),
      app.fetchCurrentWorkout(),
      app.fetchWorkoutMode(),
      app.fetchNutritionProfile(),
      useFuelStore.getState().loadToday(day),
    ]);
    // Re-learn expenditure at most weekly, after the screens are already up.
    void useAppStore.getState().refreshAdaptiveTargets();
    return day;
  }, []);
  const { dayKey, refreshedAt, loading } = useTodayRefresh(load, noNewDayWork);
  useEffect(() => {
    useAccountDay.setState({ dayKey, refreshedAt, loading });
  }, [dayKey, refreshedAt, loading]);
}
