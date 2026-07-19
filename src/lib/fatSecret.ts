import type { Food } from '@/types';

interface FatSecretServing {
  serving_id?: string | number;
  serving_description?: string;
  metric_serving_amount?: string | number;
  metric_serving_unit?: string;
  measurement_description?: string;
  is_default?: string | number;
  calories?: string | number;
  carbohydrate?: string | number;
  protein?: string | number;
  fat?: string | number;
}

interface FatSecretFood {
  food_id?: string | number;
  food_name?: string;
  brand_name?: string;
  servings?: {
    serving?: FatSecretServing | FatSecretServing[];
  };
}

export interface FatSecretBarcodeResponse {
  food?: FatSecretFood;
  error?: {
    code?: string | number;
    message?: string;
  };
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function servingList(food: FatSecretFood): FatSecretServing[] {
  const value = food.servings?.serving;
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hasCompleteMacros(serving: FatSecretServing): boolean {
  return [serving.calories, serving.carbohydrate, serving.protein, serving.fat]
    .every((value) => finiteNonNegative(value) !== null);
}

function selectServing(food: FatSecretFood): FatSecretServing | null {
  const valid = servingList(food).filter(hasCompleteMacros);
  if (valid.length === 0) return null;

  const defaultServing = valid.find((serving) => String(serving.is_default ?? '') === '1');
  if (defaultServing) return defaultServing;

  // A labelled package serving is more useful than a per-100 g fallback for a scan.
  return valid.find((serving) => (
    serving.measurement_description?.trim().toLowerCase() === 'serving'
    || !/^100\s*g(?:rams?)?$/i.test(serving.serving_description?.trim() || '')
  )) || valid[0];
}

function roundMacro(value: number): number {
  return Math.round(value * 10) / 10;
}

function servingBasis(serving: FatSecretServing): { size: number; unit: string; label?: string } {
  const amount = finiteNonNegative(serving.metric_serving_amount);
  const rawUnit = serving.metric_serving_unit?.trim().toLowerCase();
  const unit = rawUnit && ['g', 'ml', 'oz'].includes(rawUnit) ? rawUnit : null;
  const size = amount !== null && amount > 0 && unit ? amount : 1;
  const servingUnit = unit || 'serving';
  const rawLabel = serving.serving_description?.trim() || '';
  const escapedSize = String(size).replace('.', '\\.');
  const metricPattern = new RegExp(`^${escapedSize}\\s*${servingUnit}$`, 'i');
  const label = rawLabel && !metricPattern.test(rawLabel) ? rawLabel : undefined;

  return { size, unit: servingUnit, label };
}

/**
 * Maps the documented `food.find_id_for_barcode.v2` JSON response into Hyper's
 * provider-neutral food shape. The API call itself must stay behind a static-
 * egress server proxy; FatSecret credentials must never be shipped to clients.
 */
export function mapFatSecretBarcodeFood(
  payload: FatSecretBarcodeResponse | null | undefined,
): Food | null {
  const food = payload?.food;
  const foodId = String(food?.food_id ?? '').trim();
  const foodName = food?.food_name?.trim();
  if (!food || !foodId || !foodName) return null;

  const serving = selectServing(food);
  if (!serving) return null;

  const servingId = String(serving.serving_id ?? '').trim();
  if (!servingId) return null;

  const calories = finiteNonNegative(serving.calories);
  const protein = finiteNonNegative(serving.protein);
  const carbs = finiteNonNegative(serving.carbohydrate);
  const fat = finiteNonNegative(serving.fat);
  if (calories === null || protein === null || carbs === null || fat === null) return null;

  const brand = food.brand_name?.trim();
  const name = brand && !foodName.toLowerCase().includes(brand.toLowerCase())
    ? `${foodName} · ${brand}`
    : foodName;
  const basis = servingBasis(serving);

  return {
    id: `fatsecret:${foodId}:${servingId}`,
    user_id: null,
    name,
    calories: roundMacro(calories),
    protein: roundMacro(protein),
    carbs: roundMacro(carbs),
    fat: roundMacro(fat),
    serving_size: basis.size,
    serving_unit: basis.unit,
    serving_label: basis.label,
    source: 'fatsecret',
    fdc_id: null,
    external_source: 'fatsecret',
    // Both identifiers are explicitly listed as indefinitely storable.
    external_id: `${foodId}:${servingId}`,
  };
}
