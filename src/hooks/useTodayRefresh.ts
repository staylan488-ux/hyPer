import { useEffect, useState } from 'react';
import { msUntilNextLocalDay, shouldRefreshToday, todayKey, type TodayLoad } from '@/lib/todayRefresh';

export interface TodayRefreshState {
  /** True only until the first load finishes; refreshes update in place. */
  loading: boolean;
  /** Local day (yyyy-MM-dd) the on-screen data was loaded for. */
  dayKey: string;
  /** When that data was loaded; drives time-relative copy like elapsed time. */
  refreshedAt: number;
}

/**
 * Loads Today on mount, then again when the app returns to the foreground on a
 * new day or after TODAY_REFRESH_INTERVAL_MS, and at local midnight while the
 * screen stays open. One load at a time; `onNewDay` runs after a day rollover.
 */
export function useTodayRefresh(load: (dayKey: string) => Promise<void>, onNewDay: () => void): TodayRefreshState {
  const [state, setState] = useState<TodayRefreshState>(() => ({
    loading: true,
    dayKey: todayKey(new Date()),
    refreshedAt: Date.now(),
  }));

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastLoad: TodayLoad | null = null;
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;

    const run = async (initial: boolean) => {
      if (cancelled || inFlight) return;
      const now = new Date();
      const dayKey = todayKey(now);
      if (!initial && !shouldRefreshToday(now.getTime(), dayKey, lastLoad)) return;
      inFlight = true;
      try {
        await load(dayKey);
      } catch (error) {
        // Keep what is on screen; the next foreground tries again.
        console.error('Error loading Today:', error);
        return;
      } finally {
        inFlight = false;
      }
      if (cancelled) return;
      const newDay = lastLoad !== null && lastLoad.dayKey !== dayKey;
      lastLoad = { dayKey, at: Date.now() };
      setState({ loading: false, dayKey, refreshedAt: lastLoad.at });
      if (newDay) onNewDay();
    };

    // Background timers can be suspended, so re-aim at the real midnight on
    // every foreground as well as after each firing.
    const armMidnight = () => {
      clearTimeout(midnightTimer);
      midnightTimer = setTimeout(() => {
        if (document.visibilityState === 'visible') void run(false);
        armMidnight();
      }, msUntilNextLocalDay(new Date()));
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void run(false);
      armMidnight();
    };

    const initialTimer = setTimeout(() => { void run(true); }, 0);
    armMidnight();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearTimeout(midnightTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load, onNewDay]);

  return state;
}
