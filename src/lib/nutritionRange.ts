import { differenceInCalendarDays, format, isSameMonth, parseISO, startOfWeek, subDays, subWeeks } from 'date-fns';

import type { DailyNutrition } from '@/hooks/useWeeklyNutrition';

// The spans Progress's nutrition charts can show, and how a long one is drawn.
// Every span ends yesterday: today is still under way, and Today and Fuel show it.

export type NutritionRange = 'week' | 'twoWeeks' | 'month' | 'threeMonths';

export const NUTRITION_RANGES: ReadonlyArray<{ id: NutritionRange; label: string }> = [
  { id: 'week', label: 'Week' },
  { id: 'twoWeeks', label: '2 weeks' },
  { id: 'month', label: 'Month' },
  { id: 'threeMonths', label: '3 months' },
];

/** Monday first, as the training week and every calendar in the app. */
const WEEK = { weekStartsOn: 1 } as const;

/** Whole weeks behind the latest one in the three-month span: thirteen weeks in all. */
const EARLIER_WEEKS = 12;

const key = (date: Date) => format(date, 'yyyy-MM-dd');

/**
 * The days a range covers, ending the day before `todayKey`: 7, 14 or 30 days,
 * or for three months the twelve whole weeks before yesterday's week and that
 * week so far, so each of its weekly bars starts on a Monday.
 */
export function nutritionRangeSpan(todayKey: string, range: NutritionRange): { firstKey: string; lastKey: string; days: number } {
  const last = subDays(parseISO(todayKey), 1);
  const first =
    range === 'week'
      ? subDays(last, 6)
      : range === 'twoWeeks'
        ? subDays(last, 13)
        : range === 'month'
          ? subDays(last, 29)
          : subWeeks(startOfWeek(last, WEEK), EARLIER_WEEKS);
  return { firstKey: key(first), lastKey: key(last), days: differenceInCalendarDays(last, first) + 1 };
}

/** The longest span any range covers, so one read serves them all. */
export function longestNutritionSpan(todayKey: string) {
  return nutritionRangeSpan(todayKey, 'threeMonths');
}

const isLogged = (day: DailyNutrition) => day.calories > 0 || day.protein > 0;

/** The days of a range out of a longer read (oldest first): those on or after its first day. */
export function daysInRange(days: DailyNutrition[], todayKey: string, range: NutritionRange): DailyNutrition[] {
  const { firstKey, lastKey } = nutritionRangeSpan(todayKey, range);
  return days.filter((day) => day.date >= firstKey && day.date <= lastKey);
}

/**
 * The days from the first one with food logged: a range longer than the
 * logging starts where the logging does, rather than with a run of empty days.
 * Empty when nothing is logged.
 */
export function fromFirstLogged(days: DailyNutrition[]): DailyNutrition[] {
  const first = days.findIndex(isLogged);
  return first === -1 ? [] : days.slice(first);
}

/** A week's bar: the Monday it starts on, each macro's average over its days with that macro logged, and its logged days. */
export interface WeekAverage extends DailyNutrition {
  logged: number;
}

/**
 * Days (oldest first) as Monday-to-Sunday weeks, oldest first, each the
 * average of its logged days: a day with nothing logged never counts as 0.
 * A week with nothing logged is 0 for both, which the chart marks as no entry.
 */
export function weeklyAverages(days: DailyNutrition[]): WeekAverage[] {
  const weeks = new Map<string, DailyNutrition[]>();
  for (const day of days) {
    const monday = key(startOfWeek(parseISO(day.date), WEEK));
    weeks.set(monday, [...(weeks.get(monday) ?? []), day]);
  }
  const average = (list: DailyNutrition[], macro: 'calories' | 'protein') => {
    const logged = list.filter((day) => day[macro] > 0);
    return logged.length ? logged.reduce((sum, day) => sum + day[macro], 0) / logged.length : 0;
  };
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, calories: average(list, 'calories'), protein: average(list, 'protein'), logged: list.filter(isLogged).length }));
}

/**
 * A run of days in words: "Oct 29–Nov 4", or within one month "Nov 1–7";
 * spoken in full, "October 29 to November 4". One day is its date.
 */
export function spanWords(firstKey: string, lastKey: string) {
  const first = parseISO(firstKey);
  const last = parseISO(lastKey);
  if (firstKey === lastKey) return { written: format(first, 'MMM d'), spoken: format(first, 'MMMM d') };
  return {
    written: `${format(first, 'MMM d')}–${format(last, isSameMonth(first, last) ? 'd' : 'MMM d')}`,
    spoken: `${format(first, 'MMMM d')} to ${format(last, 'MMMM d')}`,
  };
}

/** How many of the days have food logged. */
export const loggedDays = (days: DailyNutrition[]) => days.filter(isLogged).length;
