// Close-the-gap picks on the phone (rules in src/lib/gapPicks.ts): what today
// still needs, measured as the Fuel reminder measures it, when the evening
// starts, and the picks from Recent's kept logs. Fuel's row, its sheet and the
// reminder all read them from here, so they always suggest the same foods.
// The row's and the sheet's words are here too, so tests can check them.
import { fuelDaySummary, isGainingGoal } from '@/lib/fuelSummary';
import { planGapPicks, type GapPick, type GapPlan } from '@/lib/gapPicks';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import type { MacroTotals } from '@/lib/nutritionMacros';
import type { HiddenRecentFoods, RecentLog } from '@/lib/recentFoods';

import { formatWhole } from './format';
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

/** What a pick adds toward the plan's aim, at its usual amount. */
export const gapPickAmount = (plan: Pick<GapPlan, 'aim'>, pick: Pick<GapPick, 'kcal' | 'protein'>) => (plan.aim === 'calories' ? pick.kcal : pick.protein);

/** "2,411 kcal" or "148 g protein": a figure in the plan's measure. */
export const gapFigure = (plan: Pick<GapPlan, 'aim'>, value: number) => `${formatWhole(value)} ${plan.aim === 'calories' ? 'kcal' : 'g protein'}`;

/**
 * Fuel's row, under "Close the gap": where the picks would take the day, not
 * what they add up to (beside that title, a sum read as the gap itself).
 */
export function gapRowLine(plan: Pick<GapPlan, 'aim' | 'picks'>, eaten: Pick<MacroTotals, 'calories' | 'protein'>): string {
  const reach = plan.picks.reduce((sum, pick) => sum + gapPickAmount(plan, pick), plan.aim === 'calories' ? eaten.calories : eaten.protein);
  const count = plan.picks.length;
  return count === 1 ? `One of your usuals reaches ${gapFigure(plan, reach)}` : `${count} of your usuals reach ${gapFigure(plan, reach)}`;
}

const COUNT_WORDS = ['', 'one', 'two', 'three'];

/** After the sheet's figure ("2,411 of 2,800 kcal with all three"): which of the picks it counts. Nothing once all are logged. */
export function gapWithWords(total: number, left: number): string {
  if (left <= 0) return '';
  if (left < total) return ' with the rest';
  return total === 1 ? ' with this' : total === 2 ? ' with both' : ` with all ${COUNT_WORDS[total] ?? total}`;
}

/** The sheet's main button: logs every pick not logged yet, and closes the sheet once none is left. */
export function gapLogAllTitle(total: number, left: number): string {
  if (left <= 0) return 'Done';
  if (left < total) return `Log the other ${COUNT_WORDS[left] ?? left}`;
  return total === 1 ? 'Log it' : total === 2 ? 'Log both' : `Log all ${COUNT_WORDS[total] ?? total}`;
}
