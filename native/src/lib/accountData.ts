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
 * Today's key by the clock, read on every render (a hook by name, so the React
 * Compiler never keeps an earlier answer), and rendering the caller again when
 * the account's day moves on at midnight, so a screen or sheet left open
 * overnight follows without being touched.
 */
export function useCurrentDayKey(): string {
  useAccountDay((state) => state.dayKey);
  return todayKey(new Date());
}

/**
 * Bumped when finished workouts may have changed outside the live session
 * (History deleted one or an edit there finished one, or a pull to refresh),
 * so Today and Train re-read what was done and where the plan stands.
 */
export const useWorkoutsRevision = create<{ revision: number; bump: () => void }>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/**
 * Loads the signed-in account into the shared stores: program, live workout,
 * targets, weekly volume, workout mode, nutrition profile and today's food.
 * The shared useTodayRefresh runs it again when the app returns on a new day
 * or after its refresh interval, and at local midnight while the app stays
 * open. Mounted once, in the tab layout.
 */
export function useAccountData() {
  const load = useCallback(async (day: string) => {
    await loadAccount(day);
    // Re-learn expenditure at most weekly, after the screens are up, and only from
    // this launch's own profile and target reads, never from the phone's copy.
    const app = useAppStore.getState();
    const owner = app.nutritionProfile?.user_id;
    if (owner && app.nutritionProfileLoadedForUserId === owner && app.macroTargetLoadedForUserId === owner) {
      void app.refreshAdaptiveTargets();
    }
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
      useWorkoutsRevision.getState().bump();
      useAccountDay.setState({ dayKey: day, refreshedAt: Date.now() });
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [also]);
  return { refreshing, refresh };
}
