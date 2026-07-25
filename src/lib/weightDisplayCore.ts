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

// A signed last-minus-previous delta used to live here. It reported daily water
// weight as "trend", so it was replaced by the smoothed rate in lib/weightTrend.

export function getPreferredWeightUnit(storage: Pick<Storage, 'getItem'> = localStorage): WeightUnit {
  return storage.getItem(WEIGHT_UNIT_KEY) === 'kg' ? 'kg' : 'lb';
}

export function setPreferredWeightUnit(
  unit: WeightUnit,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  storage.setItem(WEIGHT_UNIT_KEY, unit);
}
