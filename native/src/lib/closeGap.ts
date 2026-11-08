// Close-the-gap picks on the phone (rules in src/lib/gapPicks.ts): what today
// still needs, measured as the Fuel reminder measures it, when the evening
// starts, and the picks from Recent's kept logs. Fuel's card and the reminder
// both read them from here, so they always suggest the same foods.
import { fuelDaySummary, isGainingGoal } from '@/lib/fuelSummary';
import { planGapPicks, type GapPlan } from '@/lib/gapPicks';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import type { MacroTotals } from '@/lib/nutritionMacros';
import type { HiddenRecentFoods, RecentLog } from '@/lib/recentFoods';

import { fuelShortfall, hasReminderTarget, type FuelReminderSettings, type ReminderTarget } from './fuelReminderPlan';

/** The evening, for Fuel's card: from 6:00 PM, or from the reminder's time when it is on and earlier. */
export const GAP_EVENING = 18 * 60;
export function gapEveningStart(settings: FuelReminderSettings): number {
  return settings.enabled ? Math.min(settings.minutes, GAP_EVENING) : GAP_EVENING;
}
export const isGapEvening = (now: Date, settings: FuelReminderSettings) =>
  now.getHours() * 60 + now.getMinutes() >= gapEveningStart(settings);

// fuelDaySummary reads the date only for a past day's line.
const LIVE = new Date(0);

export type GapInput = {
  logs: readonly RecentLog[] | null | undefined;
  day: string;
  totals: MacroTotals;
  target: ReminderTarget;
  goal: NutritionGoal | null | undefined;
  hidden?: HiddenRecentFoods;
  eatenToday?: ReadonlySet<string>;
};

/**
 * Today's picks, or null: without a saved target, with nothing logged yet (the
 * day is usually eaten, not missing: the reminder asks to log it instead), when
 * today is not well short (fuelShortfall), or with no usual foods that help.
 */
export function gapPlanFor({ logs, day, totals, target, goal, hidden, eatenToday }: GapInput): GapPlan | null {
  if (!logs || !hasReminderTarget(target)) return null;
  if (!(totals.calories > 0) && !(totals.protein > 0)) return null;
  const short = fuelShortfall(totals, target, goal);
  if (!short) return null;
  const { kcalLeft } = fuelDaySummary({ totals, target, live: true, selectedDate: LIVE, goal });
  return planGapPicks({
    logs,
    todayKey: day,
    need: short,
    kcalRoom: isGainingGoal(goal) ? null : kcalLeft,
    hidden,
    eatenToday,
  });
}
