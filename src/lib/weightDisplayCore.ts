// display-only helpers for imported body weight; no medical interpretation

export type WeightUnit = 'lb' | 'kg';

export const WEIGHT_UNIT_KEY = 'hyper:weight-unit';
const LB_PER_KG = 2.2046226218;

export function kgToUnit(kilograms: number, unit: WeightUnit): number {
  return unit === 'lb' ? kilograms * LB_PER_KG : kilograms;
}

export function formatWeight(kilograms: number, unit: WeightUnit): string {
  return kgToUnit(kilograms, unit).toFixed(1);
}

// signed change of the latest entry versus the one before it, in the display
// unit; null when there is no previous entry to compare against
export function weightTrendDelta(
  kilogramsSeries: number[],
  unit: WeightUnit,
): number | null {
  if (kilogramsSeries.length < 2) return null;
  const deltaKg = kilogramsSeries[0] - kilogramsSeries[1];
  return Math.round(kgToUnit(deltaKg, unit) * 10) / 10;
}

export function getPreferredWeightUnit(storage: Pick<Storage, 'getItem'> = localStorage): WeightUnit {
  return storage.getItem(WEIGHT_UNIT_KEY) === 'kg' ? 'kg' : 'lb';
}

export function setPreferredWeightUnit(
  unit: WeightUnit,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(WEIGHT_UNIT_KEY, unit);
}
