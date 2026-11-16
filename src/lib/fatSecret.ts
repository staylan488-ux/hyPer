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

export interface FatSecretFood {
  food_id?: string | number;
  food_name?: string;
  brand_name?: string;
  /** "Brand" (packaged and restaurant food) or "Generic". */
  food_type?: string;
  servings?: {
    serving?: FatSecretServing | FatSecretServing[];
  };
}

/** food-lookup's answer to a brand search: FatSecret's foods, trimmed. */
export interface FatSecretSearchResponse {
  configured?: boolean;
  foods?: FatSecretFood[];
}

/**
 * food-lookup's answer to a lookup by ID: the foods FatSecret returned and the
 * food IDs it no longer has.
 */
export interface FatSecretFoodsResponse {
  configured?: boolean;
  foods?: FatSecretFood[];
  missing?: (string | number)[];
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
 * One FatSecret food as hyPer's provider-neutral food: the named serving, or
 * FatSecret's default one. Null when the food, that serving or its four macros
 * are missing. The API call itself stays behind the food-lookup function;
 * FatSecret credentials must never be shipped to clients.
 *
 * The result carries FatSecret's name and numbers, which only the phone may
 * keep (src/lib/deviceFoods.ts); `external_id` holds the two IDs hyPer's
 * server keeps.
 */
export function mapFatSecretFood(food: FatSecretFood | null | undefined, servingId?: string): Food | null {
  const foodId = String(food?.food_id ?? '').trim();
  const foodName = food?.food_name?.trim();
  if (!food || !foodId || !foodName) return null;

  const serving = servingId === undefined
    ? selectServing(food)
    : servingList(food).filter(hasCompleteMacros).find((candidate) => String(candidate.serving_id ?? '').trim() === servingId) ?? null;
  if (!serving) return null;

  const chosenId = String(serving.serving_id ?? '').trim();
  if (!chosenId) return null;

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
    id: `fatsecret:${foodId}:${chosenId}`,
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
    external_id: `${foodId}:${chosenId}`,
  };
}

/** The food a barcode resolved to (food-lookup returns FatSecret's `food.get` answer). */
export function mapFatSecretBarcodeFood(
  payload: FatSecretBarcodeResponse | null | undefined,
): Food | null {
  return mapFatSecretFood(payload?.food);
}

/**
 * A brand search's answer as foods, in FatSecret's order: packaged and
 * restaurant food only (plain food comes from the app's own list), each at its
 * default serving, each food once.
 */
export function mapFatSecretSearch(payload: FatSecretSearchResponse | null | undefined): Food[] {
  const seen = new Set<string>();
  const foods: Food[] = [];
  for (const item of Array.isArray(payload?.foods) ? payload.foods : []) {
    if (String(item?.food_type ?? '').trim().toLowerCase() !== 'brand') continue;
    const food = mapFatSecretFood(item);
    if (!food || seen.has(food.id)) continue;
    seen.add(food.id);
    foods.push(food);
  }
  return foods;
}
