import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek, subDays, subWeeks } from 'date-fns';

import type { DailyNutrition } from '@/hooks/useWeeklyNutrition';
import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';

/** Monday first, as the training week and every calendar in the app. */
const WEEK = { weekStartsOn: 1 } as const;

const key = (date: Date) => format(date, 'yyyy-MM-dd');

/**
 * The first day the account has food logged: null when it has none,
 * undefined when signed out or the read fails. (Kept out of the screen so the
 * React Compiler, which skips a component with a try, still compiles it.)
 */
export async function readFirstLoggedDay(): Promise<string | null | undefined> {
  try {
    const userId = await getSessionUserId();
    if (!userId) return undefined;
    const { data, error } = await supabase
      .from('nutrition_logs')
      .select('date')
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .limit(1);
    if (error || !data) return undefined;
    return (data as { date: string }[])[0]?.date ?? null;
  } catch {
    return undefined;
  }
}

/**
 * The days History reads: `weeks` Monday-to-Sunday weeks ending with
 * yesterday's (today is Fuel's own, and still under way).
 */
export function historySpan(todayKey: string, weeks: number) {
  const last = subDays(parseISO(todayKey), 1);
  const first = subWeeks(startOfWeek(last, WEEK), Math.max(1, weeks) - 1);
  return { firstKey: key(first), lastKey: key(last), days: differenceInCalendarDays(last, first) + 1 };
}

export interface HistoryWeek {
  /** Its Monday. */
  start: string;
  /** Its logged days, newest first. */
  days: DailyNutrition[];
}

/** The logged days as weeks, newest week and day first; days and weeks with nothing logged are left out. */
export function historyWeeks(days: DailyNutrition[]): HistoryWeek[] {
  const weeks = new Map<string, DailyNutrition[]>();
  for (const day of days) {
    if (day.calories <= 0 && day.protein <= 0) continue;
    const monday = key(startOfWeek(parseISO(day.date), WEEK));
    weeks.set(monday, [...(weeks.get(monday) ?? []), day]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([start, list]) => ({ start, days: [...list].sort((a, b) => b.date.localeCompare(a.date)) }));
}

/** A week's heading: "This week", "Last week", or its dates ("Nov 2–8", "Oct 27–Nov 2"). */
export function historyWeekTitle(start: string, todayKey: string) {
  const thisWeek = startOfWeek(parseISO(todayKey), WEEK);
  if (start === key(thisWeek)) return 'This week';
  if (start === key(subWeeks(thisWeek, 1))) return 'Last week';
  const first = parseISO(start);
  const last = addDays(first, 6);
  return `${format(first, 'MMM d')}–${format(last, first.getMonth() === last.getMonth() ? 'd' : 'MMM d')}`;
}
