// Amounts and units on the food review, shared by the web logger and the native app.
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

type Basis = Pick<Food, 'serving_size' | 'serving_unit'>;

/** Servings of the food for an amount in a unit; null when it cannot convert or is not above zero. */
export function servingsForAmount(food: Basis, amountText: string, unit: MeasurementUnit): number | null {
  const amount = parseFloat(amountText);
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
  const amount = parseFloat(amountText);
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
