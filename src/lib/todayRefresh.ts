import { addDays, format, startOfDay } from 'date-fns';

/** Coming back to Today within this window reuses what is already on screen. */
export const TODAY_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;

export interface TodayLoad {
  dayKey: string;
  at: number;
}

export function todayKey(now: Date): string {
  return format(now, 'yyyy-MM-dd');
}

/** Refresh on a new local day, or once the last successful load is stale. */
export function shouldRefreshToday(nowMs: number, dayKey: string, lastLoad: TodayLoad | null): boolean {
  if (!lastLoad) return true;
  return lastLoad.dayKey !== dayKey || nowMs - lastLoad.at >= TODAY_REFRESH_INTERVAL_MS;
}

/** Delay to just past the next local midnight, so the timer never lands on the old day. */
export function msUntilNextLocalDay(now: Date): number {
  return startOfDay(addDays(now, 1)).getTime() - now.getTime() + 1_000;
}
