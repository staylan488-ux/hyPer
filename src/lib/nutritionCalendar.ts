import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';

export function getDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** Every day of the month's weeks, Sunday first, for the month grid. */
export function buildCalendarDays(baseDate: Date): Date[] {
  const startDate = startOfWeek(startOfMonth(baseDate));
  const endDate = endOfWeek(endOfMonth(baseDate));
  const days: Date[] = [];
  for (let day = startDate; day <= endDate; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The seven days of the Sunday-start week holding `anchor`. */
export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}
