import { format, isSameYear } from 'date-fns';

/**
 * The one calendar header label (Fuel's week strip, History's month): the
 * month in sentence case, with the year only when it is not this year.
 */
export function calendarMonthLabel(month: Date, today: Date = new Date()): string {
  return format(month, isSameYear(month, today) ? 'MMMM' : 'MMMM yyyy');
}
