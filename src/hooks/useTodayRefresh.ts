import { useEffect, useState } from 'react';
import { msUntilNextLocalDay, shouldRefreshToday, todayKey, type TodayLoad } from '@/lib/todayRefresh';

export interface TodayRefreshState<T> {
  /** True only until the first load finishes; refreshes update in place. */
  loading: boolean;
  /** Local day (yyyy-MM-dd) the on-screen data was loaded for. */
  dayKey: string;
  /** When that data was loaded; drives time-relative copy like elapsed time. */
  refreshedAt: number;
  /** The day-scoped data `load` returned for `dayKey`; null until one succeeds. */
  data: T | null;
}

/**
 * Loads Today on mount, then again when the app returns to the foreground on a
 * new day or after TODAY_REFRESH_INTERVAL_MS, and at local midnight while the
 * screen stays open. One load at a time; a request made during a load runs
 * once it finishes. `load` throws when it could not read the day, which keeps
 * the old day and its data on screen; its result and the day are committed
 * together, so they always match. `onNewDay` runs after a day rollover.
 */
export function useTodayRefresh<T>(load: (dayKey: string) => Promise<T>, onNewDay: () => void): TodayRefreshState<T> {
  const [state, setState] = useState<TodayRefreshState<T>>(() => ({
    loading: true,
    dayKey: todayKey(new Date()),
    refreshedAt: Date.now(),
    data: null,
  }));

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let queued = false;
    let lastLoad: TodayLoad | null = null;
    // The day on screen, which a failed first load leaves at the mount day.
    let shownDay = todayKey(new Date());
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;

    const run = async (initial: boolean) => {
      if (cancelled) return;
      if (inFlight) {
        queued = true;
        return;
      }
      const now = new Date();
      const dayKey = todayKey(now);
      if (!initial && !shouldRefreshToday(now.getTime(), dayKey, lastLoad)) return;
      inFlight = true;
      queued = false;
      let loaded = false;
      try {
        const data = await load(dayKey);
        if (cancelled) return;
        const newDay = shownDay !== dayKey;
        shownDay = dayKey;
        lastLoad = { dayKey, at: Date.now() };
        loaded = true;
        setState({ loading: false, dayKey, refreshedAt: lastLoad.at, data });
        if (newDay) onNewDay();
      } catch (error) {
        // Keep what is on screen; the next request tries again. A failed first
        // load still ends the shimmer, leaving the empty defaults as before.
        console.error('Error loading Today:', error);
        if (initial && !cancelled) setState((previous) => ({ ...previous, loading: false }));
      } finally {
        inFlight = false;
      }
      // Run a request that arrived during the load, or catch a midnight the
      // load straddled. Never loops: a failure only reruns for a new request.
      const straddled = loaded && todayKey(new Date()) !== dayKey;
      if ((queued || straddled) && document.visibilityState === 'visible') void run(false);
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
