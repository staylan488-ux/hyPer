// The fuel reminder's rules (lib/fuelReminder.ts hands them to iOS): when a
// day is well short, what the notification says, and which notifications iOS
// should hold for the days ahead. Pure, so tests can check it.
import { addDays, format, startOfDay } from 'date-fns';

import { fuelDaySummary, isGainingGoal } from '@/lib/fuelSummary';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import type { MacroTotals } from '@/lib/nutritionMacros';

import { formatWhole } from './format';

export const FUEL_REMINDER_ID_PREFIX = 'hyper-fuel-reminder-';
/** On every reminder: it carries the Snap a meal button. No ':' or '-' (expo-notifications' rule for categories). */
export const FUEL_REMINDER_CATEGORY = 'fuelReminder';
/** The reminder's Snap a meal button (press and hold the reminder). */
export const FUEL_REMINDER_SNAP_ACTION = 'snapMeal';
/** Today and the next two: a day with the app closed still reminds; a long break ends them. */
export const FUEL_REMINDER_DAYS = 3;
/** You offers evening times only: 5:00 PM to 11:00 PM, 8:00 PM to start. */
export const REMINDER_EARLIEST = 17 * 60;
export const REMINDER_LATEST = 23 * 60;
export const DEFAULT_REMINDER_MINUTES = 20 * 60;

export type FuelReminderSettings = { enabled: boolean; minutes: number };
export const DEFAULT_REMINDER_SETTINGS: FuelReminderSettings = { enabled: false, minutes: DEFAULT_REMINDER_MINUTES };
/** Each day's reminder handed to iOS, with the instant it was due (ms). */
export type ReminderHistory = Record<string, number>;
export type ReminderPermission = 'granted' | 'denied' | 'undetermined';
export type ReminderTarget = { calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null } | null | undefined;
type Goal = NutritionGoal | null | undefined;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const NOTHING: MacroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
// fuelDaySummary reads the date only for a past day's line.
const LIVE = new Date(0);
const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

export const fuelReminderId = (day: string) => `${FUEL_REMINDER_ID_PREFIX}${day}`;
export const isFuelReminderId = (id: string) => id.startsWith(FUEL_REMINDER_ID_PREFIX);
export const reminderDay = (id: string) => id.slice(FUEL_REMINDER_ID_PREFIX.length);
/** Like Today's card and the widget: without a saved calorie target there is nothing to remind about. */
export const hasReminderTarget = (target: ReminderTarget) => Number(target?.calories) > 0;

/** Well short: a quarter of the target or more still to go (×4 keeps it in whole numbers). */
const wellShort = (left: number, target: number) => left > 0 && left * 4 >= target;

export type Shortfall = { kcal: number | null; protein: number | null };
/** What is well short, in Fuel's own figures: calories only while gaining, protein on any goal. */
export function fuelShortfall(totals: MacroTotals, target: ReminderTarget, goal: Goal): Shortfall | null {
  const { targets, kcalLeft, proteinLeft } = fuelDaySummary({ totals, target, live: true, selectedDate: LIVE, goal });
  const kcal = isGainingGoal(goal) && wellShort(kcalLeft, Math.round(targets.calories)) ? kcalLeft : null;
  const protein = wellShort(proteinLeft, Math.round(targets.protein)) ? proteinLeft : null;
  return kcal === null && protein === null ? null : { kcal, protein };
}

/** The words: what's left, or, with nothing logged, a plain prompt (it is usually eaten, not missing). */
export function reminderCopy(totals: MacroTotals, short: Shortfall): { title: string; body: string } {
  if (!(totals.calories > 0) && !(totals.protein > 0)) {
    return { title: 'Nothing logged today', body: 'Log what you’ve eaten to see what’s left.' };
  }
  const parts = [
    short.kcal !== null ? `${formatWhole(short.kcal)} kcal` : null,
    short.protein !== null ? `${formatWhole(short.protein)} g protein` : null,
  ].filter(Boolean);
  return {
    title: `${parts.join(' and ')} to go`,
    body: short.kcal !== null ? 'Still time for a good meal.' : 'Still time for some protein.',
  };
}

/** Wall-clock parts for iOS's calendar trigger; month counts from 1, as iOS does. */
export type ReminderAt = { year: number; month: number; day: number; hour: number; minute: number };
export type ReminderRequest = { id: string; day: string; at: ReminderAt; atMs: number; title: string; body: string };
export type ReminderPlanInput = {
  now: Date;
  settings: FuelReminderSettings;
  /** The local day today's totals belong to (yyyy-MM-dd). */
  day: string;
  totals: MacroTotals;
  target: ReminderTarget;
  goal: Goal;
  history: ReminderHistory;
  /** Reminder ids iOS still holds. */
  pendingIds: ReadonlySet<string>;
};

/** A day's reminder already went out: handed to iOS, due, and no longer waiting there. */
export function reminderSent(history: ReminderHistory, day: string, now: Date, pendingIds: ReadonlySet<string>): boolean {
  const at = history[day];
  return at !== undefined && at <= now.getTime() && !pendingIds.has(fuelReminderId(day));
}

/** [] when off or without a saved target; null when `day` is not today here (a new day still loading: keep what iOS holds). */
export function planFuelReminders({ now, settings, day, totals, target, goal, history, pendingIds }: ReminderPlanInput): ReminderRequest[] | null {
  if (!settings.enabled || !hasReminderTarget(target)) return [];
  if (day !== dayKey(now)) return null;
  const hour = Math.floor(settings.minutes / 60);
  const minute = settings.minutes % 60;
  const ahead = now.getHours() * 60 + now.getMinutes() < settings.minutes;
  const base = startOfDay(now);
  const requests: ReminderRequest[] = [];
  for (let offset = 0; offset < FUEL_REMINDER_DAYS; offset += 1) {
    if (offset === 0 && !ahead) continue;
    const date = addDays(base, offset);
    const key = dayKey(date);
    if (reminderSent(history, key, now, pendingIds)) continue;
    const eaten = offset === 0 ? totals : NOTHING;
    const short = fuelShortfall(eaten, target, goal);
    if (!short) continue;
    const at = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour, minute };
    const { title, body } = reminderCopy(eaten, short);
    requests.push({ id: fuelReminderId(key), day: key, at, atMs: new Date(at.year, at.month - 1, at.day, hour, minute).getTime(), title, body });
  }
  return requests;
}

/** Keeps yesterday and later (enough for a flight west over the date line), oldest first. */
export function pruneReminderHistory(history: ReminderHistory, now: Date): ReminderHistory {
  const yesterday = dayKey(addDays(startOfDay(now), -1));
  return Object.fromEntries(
    Object.entries(history).filter(([day]) => day >= yesterday).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

export function clampReminderMinutes(minutes: number): number {
  return Number.isFinite(minutes) ? Math.min(REMINDER_LATEST, Math.max(REMINDER_EARLIEST, Math.round(minutes))) : DEFAULT_REMINDER_MINUTES;
}

export function parseReminderSettings(raw: string | null | undefined): FuelReminderSettings {
  try {
    const value = JSON.parse(raw ?? '') as { enabled?: unknown; minutes?: unknown } | null;
    if (!value || typeof value !== 'object') return DEFAULT_REMINDER_SETTINGS;
    const minutes = typeof value.minutes === 'number' && Number.isInteger(value.minutes) ? clampReminderMinutes(value.minutes) : DEFAULT_REMINDER_MINUTES;
    return { enabled: value.enabled === true, minutes };
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export function parseReminderHistory(raw: string | null | undefined): ReminderHistory {
  try {
    const value = JSON.parse(raw ?? '') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] =>
        DAY_KEY.test(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1])),
    );
  } catch {
    return {};
  }
}

/**
 * The picker's day at local midnight, as a time (mid-January: no DST change
 * falls on it). Read again after a move to another time zone: the same time
 * is then another moment.
 */
export const reminderPickerDay = () => new Date(2026, 0, 15).getTime();
/** A Date showing the time in the picker, on its day. */
export const reminderTimeDate = (minutes: number, day = reminderPickerDay()) => new Date(day + minutes * 60_000);
export const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes();

export function fuelReminderNote(goal: Goal, hasTarget: boolean): string {
  if (!hasTarget) return 'Set your targets to get this reminder.';
  return isGainingGoal(goal)
    ? 'Reminds you when calories or protein are well below today’s targets. Stops once you reach them.'
    : 'Reminds you when protein is well below today’s target. Stops once you reach it.';
}

/** expo-notifications' permission answer, as much as the reminder needs. */
export type PermissionLike = {
  granted: boolean;
  canAskAgain: boolean;
  ios?: {
    status?: number | null;
    allowsAlert?: boolean | null;
    allowsDisplayOnLockScreen?: boolean | null;
    allowsDisplayInNotificationCenter?: boolean | null;
  } | null;
};
const PROVISIONAL = 3; // IosAuthorizationStatus.PROVISIONAL
export function reminderPermission(status: PermissionLike): ReminderPermission {
  if (status.granted || status.ios?.status === PROVISIONAL) {
    const ios = status.ios;
    // Allowed, but with banners, the lock screen and Notification Center all off nothing would show.
    const hidden = ios?.allowsAlert === false && ios.allowsDisplayOnLockScreen === false && ios.allowsDisplayInNotificationCenter === false;
    return hidden ? 'denied' : 'granted';
  }
  return status.canAskAgain ? 'undetermined' : 'denied';
}
