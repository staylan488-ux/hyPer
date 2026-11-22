// Amounts and units on the food review.
import { parseDecimal } from '@/lib/decimalText';
import {
  computeAmountFromServings,
  computeServingsFromAmount,
  getCompatibleMeasurementUnits,
  type MeasurementUnit,
} from '@/lib/foodLoggerUtils';
import type { Food } from '@/types';

export type { MeasurementUnit };
export { getCompatibleMeasurementUnits };

/** A macro for an input field: one decimal, no trailing ".0". */
export function formatMacroInput(value: number): string {
  const rounded = Math.round((value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** An amount for an input field: up to two decimals, trailing zeros dropped. */
export function formatMeasurementAmount(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/**
 * Servings in hundredths as numeric(10,2) saves them: half away from zero, so
 * 1.025 saves as 1.03. The nudge keeps a half-way value that floating point
 * holds as 1.02499… from rounding down.
 */
function savedHundredths(servings: number): number {
  return Math.round(servings * 100 + 1e-7);
}

/**
 * A logged amount for display: the roundest of whole, one decimal or two that
 * saves as the same servings. Servings are saved with two decimals, so 150 g
 * of a 28 g serving is kept as 5.36 servings (150.08 g) and shows as 150 g.
 */
export function roundestAmount(amount: number, servings: number, servingsFor: (amount: number) => number | null): number {
  const saved = savedHundredths(servings);
  for (const scale of [1, 10]) {
    const candidate = Math.round(amount * scale) / scale;
    const back = candidate > 0 ? servingsFor(candidate) : null;
    if (back !== null && savedHundredths(back) === saved) return candidate;
  }
  return Math.round(amount * 100) / 100;
}

type Basis = Pick<Food, 'serving_size' | 'serving_unit'>;
type CalorieBasis = Basis & Pick<Food, 'calories'>;

const MAX_CALORIE_TARGET_SERVINGS = 1000;

const GROUPED_THOUSANDS_PATTERN = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/** Servings for a target calorie amount; null when the food has no calories or the target is invalid. */
export function servingsForCalories(food: Pick<Food, 'calories'>, caloriesText: string): number | null {
  if (!Number.isFinite(food.calories) || food.calories <= 0) return null;
  const trimmed = caloriesText.trim();
  const normalized = GROUPED_THOUSANDS_PATTERN.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed;
  const calories = parseDecimal(normalized);
  if (!Number.isFinite(calories) || calories <= 0) return null;
  const servings = calories / food.calories;
  if (!Number.isFinite(servings) || servings <= 0 || servings > MAX_CALORIE_TARGET_SERVINGS) return null;
  return servings;
}

/**
 * Amount text in `unit` for a target calorie amount; null when the target is
 * invalid or the unit cannot convert.
 */
export function amountForCalories(food: CalorieBasis, caloriesText: string, unit: MeasurementUnit): string | null {
  const servings = servingsForCalories(food, caloriesText);
  if (servings === null) return null;
  return amountForServings(food, servings, unit);
}

function formatPreciseAmount(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value)) return '';
  const scale = 10 ** maxDecimals;
  const rounded = Math.round(value * scale) / scale;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(maxDecimals).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/** Amount text in `unit` for a given serving count; null when the unit cannot convert. */
export function amountForServings(food: Basis, servings: number, unit: MeasurementUnit): string | null {
  if (!Number.isFinite(servings) || servings <= 0) return null;
  if (unit === 'serving') return formatMeasurementAmount(servings);
  const raw = computeAmountFromServings({
    servings,
    targetUnitRaw: unit,
    servingSize: food.serving_size,
    servingUnitRaw: food.serving_unit,
  });
  if (raw === null) return null;
  const saved = savedHundredths(servings);
  for (const decimals of [0, 1, 2, 3, 4]) {
    const scale = 10 ** decimals;
    const candidate = Math.round(raw * scale) / scale;
    if (candidate <= 0) continue;
    const back = computeServingsFromAmount({
      amount: candidate,
      amountUnitRaw: unit,
      servingSize: food.serving_size,
      servingUnitRaw: food.serving_unit,
    });
    if (back !== null && savedHundredths(back) === saved) return formatPreciseAmount(candidate, decimals);
  }
  return formatPreciseAmount(raw, 4);
}

/**
 * Physical serving weight/volume for `servings` when Amount is shown in
 * "servings" (e.g. "93.9 g" for 3.13 servings of a 30 g trail mix). Null when
 * the food has no physical serving unit, Amount is already in one, or a single
 * serving already carries its own word (e.g. "1 scoop").
 */
export function equivalentWeightLabel(food: Basis, servings: number | null, unit: MeasurementUnit): string | null {
  if (unit !== 'serving' || servings === null || !Number.isFinite(servings) || servings <= 0) return null;
  const own = food.serving_unit?.trim();
  if (!own || own.toLowerCase() === 'serving') return null;
  if (!Number.isFinite(food.serving_size) || food.serving_size <= 0) return null;
  const units = getCompatibleMeasurementUnits(food.serving_unit);
  if (units.length <= 1 && Number(food.serving_size) === 1) return null;
  const total = servings * food.serving_size;
  if (!Number.isFinite(total) || total <= 0) return null;
  return `${formatMeasurementAmount(total)} ${own}`;
}

/** Servings of the food for an amount in a unit; null when it cannot convert or is not above zero. */
export function servingsForAmount(food: Basis, amountText: string, unit: MeasurementUnit): number | null {
  const amount = parseDecimal(amountText);
  if (unit === 'serving') return Number.isFinite(amount) && amount > 0 ? amount : null;
  return computeServingsFromAmount({
    amount,
    amountUnitRaw: unit,
    servingSize: food.serving_size,
    servingUnitRaw: food.serving_unit,
  });
}

/** The error under the amount, or null. */
export function amountError(food: Basis, amountText: string, unit: MeasurementUnit): string | null {
  const amount = parseDecimal(amountText);
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter a valid amount greater than zero.';
  if (servingsForAmount(food, amountText, unit) === null) {
    return `Can't convert ${unit} to ${food.serving_unit || 'serving'} for this food.`;
  }
  return null;
}

/**
 * The amount text after switching units, converting the current amount; the
 * old text when it cannot convert.
 */
export function amountForUnit(food: Basis, amountText: string, from: MeasurementUnit, to: MeasurementUnit): string {
  const servings = servingsForAmount(food, amountText, from);
  if (servings === null || !Number.isFinite(servings) || servings <= 0) return amountText;
  if (to === 'serving') return formatMeasurementAmount(servings);
  const next = computeAmountFromServings({
    servings,
    targetUnitRaw: to,
    servingSize: food.serving_size,
    servingUnitRaw: food.serving_unit,
  });
  return next === null ? amountText : formatMeasurementAmount(next);
}

/** "per 1 cup (240 g)" or "per 100 g". */
export function foodBasisLabel(food: Pick<Food, 'serving_size' | 'serving_unit' | 'serving_label'>): string {
  return food.serving_label
    ? `per ${food.serving_label} (${formatMeasurementAmount(food.serving_size || 1)} ${food.serving_unit || 'g'})`
    : `per ${formatMeasurementAmount(food.serving_size || 1)} ${food.serving_unit || 'serving'}`;
}

/** "250 kcal · P 20 · C 30 · F 8". */
export function foodMacroLine(food: Pick<Food, 'calories' | 'protein' | 'carbs' | 'fat'>): string {
  return `${Math.round(food.calories)} kcal · P ${Math.round(food.protein)} · C ${Math.round(food.carbs)} · F ${Math.round(food.fat)}`;
}
