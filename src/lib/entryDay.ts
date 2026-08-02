/**
 * Moving a logged entry between calendar days.
 *
 * Food eaten at 01:00 belongs to the day that is still going on for the person
 * eating it, not to the one the clock rolled over into. The log stores a `date`
 * (which day it counts toward) alongside `logged_at` (when it actually
 * happened), so a move rewrites the former and shifts the latter to match,
 * keeping entries in the right order within their new day.
 *
 * Pure — the caller supplies the entry; no clock reads, no I/O.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EntryDayPatch {
  date: string;
  logged_at: string | null;
}

/** YYYY-MM-DD in local time, matching how the rest of the app keys a day. */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shifts a YYYY-MM-DD key by whole days, handling month and year boundaries. */
export function shiftDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return dayKey;
  return localDayKey(new Date(year, month - 1, day + days));
}

/**
 * Builds the patch that moves an entry by `days`.
 *
 * `logged_at` moves by the same offset rather than being cleared or pinned to
 * noon: a 01:00 entry moved back a day should read 01:00 on that day, which
 * keeps it last in the list where it belongs, instead of jumping to the middle
 * of the afternoon and reordering the whole day.
 */
export function planEntryDayMove(
  entry: { date: string; logged_at?: string | null },
  days: number,
): EntryDayPatch | null {
  if (!Number.isInteger(days) || days === 0) return null;
  if (!entry.date) return null;

  const nextDate = shiftDayKey(entry.date, days);
  if (nextDate === entry.date) return null;

  let nextLoggedAt: string | null = null;
  if (entry.logged_at) {
    const parsed = Date.parse(entry.logged_at);
    nextLoggedAt = Number.isFinite(parsed)
      ? new Date(parsed + days * MS_PER_DAY).toISOString()
      : null;
  }

  return { date: nextDate, logged_at: nextLoggedAt };
}

/**
 * Whether to offer "move to yesterday" on an entry.
 *
 * The case this exists for is a late night that has not ended yet, so the offer
 * is limited to entries logged in the small hours of today. Offering it on every
 * entry would make an easy mis-tap out of a rarely-wanted action.
 */
export const LATE_NIGHT_CUTOFF_HOUR = 5;

export function isLateNightEntry(
  entry: { date: string; logged_at?: string | null },
  now: Date,
): boolean {
  if (entry.date !== localDayKey(now)) return false;
  if (now.getHours() >= LATE_NIGHT_CUTOFF_HOUR) return false;

  if (!entry.logged_at) return true;
  const parsed = Date.parse(entry.logged_at);
  if (!Number.isFinite(parsed)) return true;
  return new Date(parsed).getHours() < LATE_NIGHT_CUTOFF_HOUR;
}
