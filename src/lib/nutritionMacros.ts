/**
 * Macro totals for logged food: each entry's food macros times its servings.
 *
 * DECIMAL columns can arrive as numbers or strings, so values are coerced with
 * Number(). A missing food, or a value that is not a finite number, counts as
 * nothing rather than poisoning the total.
 *
 * Pure — no I/O.
 */

export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];
export type MacroTotals = Record<MacroKey, number>;

export interface MacroLogLike {
  servings: number | string | null;
  food: Partial<Record<MacroKey, number | string | null>> | null;
}

/** One entry's amount of a macro, or null when it cannot be counted. */
export function logMacro(log: MacroLogLike, macro: MacroKey): number | null {
  const value = Number(log.food?.[macro]);
  const servings = Number(log.servings);
  if (!Number.isFinite(value) || !Number.isFinite(servings)) return null;
  return value * servings;
}

export function sumMacros(logs: readonly MacroLogLike[]): MacroTotals {
  const totals: MacroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const log of logs) {
    for (const macro of MACRO_KEYS) {
      const amount = logMacro(log, macro);
      if (amount !== null) totals[macro] += amount;
    }
  }
  return totals;
}

/**
 * Totals as the day's list shows them: each entry rounded to a whole unit
 * first (as its row reads), then summed, so a header never disagrees with
 * the rows beneath it (rows of 20 g, 56 g, 24 g … add up to the total shown).
 */
export function sumShownMacros(logs: readonly MacroLogLike[]): MacroTotals {
  const totals: MacroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const log of logs) {
    for (const macro of MACRO_KEYS) {
      const amount = logMacro(log, macro);
      if (amount !== null) totals[macro] += Math.round(amount);
    }
  }
  return totals;
}
