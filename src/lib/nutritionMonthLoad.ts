/**
 * Loading rules for the Fuel page's month of logs and meal groups.
 *
 * Pure — the page supplies its state; no clock reads, no I/O.
 */

import { format } from 'date-fns';

/** yyyy-MM, the key a loaded month of logs and groups is tracked by. */
export function nutritionMonthKey(date: Date): string {
  return format(date, 'yyyy-MM');
}

/**
 * Breakfast, lunch and dinner are created only when the groups on screen
 * really belong to the selected date's month. While the "Jump to date" sheet
 * browses another month, or a new month is still loading, the selected day's
 * groups only look missing; inserting then would hit the named-meal unique
 * index and refetch in a loop. A date whose insert already failed is not
 * retried in this session.
 */
export function shouldEnsureDefaultGroups({
  loading,
  loadedMonthKey,
  selectedDateKey,
  failedDates,
}: {
  loading: boolean;
  loadedMonthKey: string | null;
  selectedDateKey: string;
  failedDates: ReadonlySet<string>;
}): boolean {
  if (loading || loadedMonthKey === null) return false;
  if (selectedDateKey.slice(0, 7) !== loadedMonthKey) return false;
  return !failedDates.has(selectedDateKey);
}

/**
 * The meal groups to show after a month's groups were read. A failed read
 * (offline, timed out) keeps the groups already on screen: an empty list
 * would pull every meal and snack header off the day until the connection
 * returns. Groups from another month stay filtered out by date.
 */
export function nextMonthGroups<T>(
  current: T[],
  fetched: T[] | null | undefined,
  failed: boolean,
): T[] {
  if (failed) return current;
  return fetched || [];
}

/**
 * Hands out increasing tokens so only the newest of overlapping requests
 * applies its response; a slower answer for a month already left is dropped.
 */
export function createLatestRequestGate() {
  let latest = 0;
  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    isCurrent(token: number): boolean {
      return token === latest;
    },
  };
}
