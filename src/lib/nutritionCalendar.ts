import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';

import { TRAINING_WEEK } from '@/lib/workoutSessions';

export function getDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Every day of the month's weeks, Monday first, for the month grid: the
 * training week's, so every week in the app starts on the same day.
 */
export function buildCalendarDays(baseDate: Date): Date[] {
  const startDate = startOfWeek(startOfMonth(baseDate), TRAINING_WEEK);
  const endDate = endOfWeek(endOfMonth(baseDate), TRAINING_WEEK);
  const days: Date[] = [];
  for (let day = startDate; day <= endDate; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The seven days of the Monday-start week holding `anchor` (the training week). */
export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor, TRAINING_WEEK);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}
