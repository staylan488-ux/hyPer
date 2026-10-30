// The Fuel page's day summary, shared by the web page and the native app.
import { format } from 'date-fns';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import type { MacroTotals } from '@/lib/nutritionMacros';
import { DEFAULT_MACRO_TARGET } from '@/types';

type TargetLike = { calories?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null } | null | undefined;

export type FuelMacro = 'calories' | 'protein' | 'carbs' | 'fat';

/** Bulking or lean bulking: eating past the target is the point. */
export function isGainingGoal(goal: NutritionGoal | null | undefined): boolean {
  return goal === 'bulk' || goal === 'lean_bulk';
}

/**
 * Whether going past a target shows as a warning (red). Protein never does:
 * more of it does no harm on any goal. Calories, carbs and fat do while
 * cutting, maintaining or with no goal saved, and never while gaining, where
 * going past them is a good day (the owner's call on 2026-10-30).
 */
export function warnsOverTarget(macro: FuelMacro, goal: NutritionGoal | null | undefined): boolean {
  if (macro === 'protein') return false;
  return !isGainingGoal(goal);
}

/** The word for calories past target: "extra" while gaining, else "over". */
export function overTargetWord(goal: NutritionGoal | null | undefined): 'extra' | 'over' {
  return isGainingGoal(goal) ? 'extra' : 'over';
}

/** The day's targets; a missing or zero target falls back to the defaults, as on the web. */
export function fuelTargets(target: TargetLike) {
  return {
    calories: target?.calories || DEFAULT_MACRO_TARGET.calories,
    protein: target?.protein || DEFAULT_MACRO_TARGET.protein,
    carbs: target?.carbs || DEFAULT_MACRO_TARGET.carbs,
    fat: target?.fat || DEFAULT_MACRO_TARGET.fat,
  };
}

export function fuelDaySummary(input: {
  totals: MacroTotals;
  target: TargetLike;
  live: boolean;
  selectedDate: Date;
  /** The saved nutrition goal; while gaining, calories past target are good news. */
  goal?: NutritionGoal | null;
}) {
  const targets = fuelTargets(input.target);
  const eaten = Math.round(input.totals.calories);
  const roundedTarget = Math.round(targets.calories);
  const kcalLeft = Math.max(0, roundedTarget - eaten);
  const kcalOver = Math.max(0, eaten - roundedTarget);
  const proteinLeft = Math.max(0, Math.round(targets.protein - input.totals.protein));
  // Past target is a warning only on a goal where it is one.
  const kcalOverWarns = kcalOver > 0 && warnsOverTarget('calories', input.goal);
  // what the Log food action says under it
  const logLine = !input.live
    ? `Adds to ${format(input.selectedDate, 'EEEE, MMM d')}`
    : kcalOver > 0
      ? isGainingGoal(input.goal)
        ? `Target reached · ${kcalOver.toLocaleString()} kcal extra`
        : `${kcalOver.toLocaleString()} kcal over target`
      : `${kcalLeft.toLocaleString()} kcal left${proteinLeft > 0 ? ` · ${proteinLeft} g protein to go` : ''}`;
  return { targets, eaten, kcalLeft, kcalOver, kcalOverWarns, proteinLeft, logLine };
}

/** "Today · Oct 27" or "Monday, Oct 26" ("· 2025" added in another year). */
export function fuelDayTitle(selected: Date, now = new Date()): string {
  const sameDay = format(selected, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd');
  if (sameDay) return `Today · ${format(selected, 'MMM d')}`;
  const otherYear = format(selected, 'yyyy') !== format(now, 'yyyy');
  return [format(selected, 'EEEE, MMM d'), otherYear ? format(selected, 'yyyy') : null].filter(Boolean).join(' · ');
}
