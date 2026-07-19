import type { Food } from '@/types';
import { barcodeLookupCandidates, barcodesAreEquivalent } from '@/lib/barcodes';

interface UsdaFoodPortion {
  gramWeight?: number;
  amount?: number;
  modifier?: string;
  portionDescription?: string;
  sequenceNumber?: number;
  measureUnit?: { name?: string; abbreviation?: string };
}

export interface UsdaFoodDetail {
  fdcId?: number;
  dataType?: string;
  description?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodPortions?: UsdaFoodPortion[];
}

export interface UsdaPortion {
  size: number;
  unit: 'g' | 'ml';
  label: string;
}

function normalizeServingSizeUnit(unitRaw: string | null | undefined): 'g' | 'ml' | null {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (['g', 'grm', 'gram', 'grams'].includes(normalized)) return 'g';
  if (['ml', 'mlt', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(normalized)) return 'ml';
  return null;
}

function cleanLabel(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildPortionLabel(portion: UsdaFoodPortion): string {
  const modifier = portion.modifier?.trim();
  const description = portion.portionDescription?.trim();
  const measure = portion.measureUnit?.name?.trim();
  const amount = typeof portion.amount === 'number' && portion.amount > 0 ? portion.amount : null;

  if (amount && modifier) return cleanLabel(`${amount} ${modifier}`);
  if (description) return cleanLabel(description);
  if (amount && measure && measure.toLowerCase() !== 'undetermined') return cleanLabel(`${amount} ${measure}`);
  if (modifier) return cleanLabel(modifier);
  return cleanLabel(`${portion.gramWeight} g`);
}

export function selectPortionFromDetail(detail: UsdaFoodDetail | null | undefined): UsdaPortion | null {
  if (!detail) return null;

  // Branded foods carry a labelled serving size.
  const brandedUnit = normalizeServingSizeUnit(detail.servingSizeUnit);
  if (typeof detail.servingSize === 'number' && detail.servingSize > 0 && brandedUnit) {
    const household = detail.householdServingFullText?.trim();
    const label = household ? cleanLabel(household) : `${detail.servingSize} ${brandedUnit}`;
    return { size: detail.servingSize, unit: brandedUnit, label };
  }

  // Foundation / SR Legacy foods carry household portions; pick the representative one.
  const portions = (detail.foodPortions || []).filter(
    (portion) => typeof portion.gramWeight === 'number' && portion.gramWeight > 0
  );
  if (portions.length > 0) {
    const primary = [...portions].sort(
      (a, b) => (a.sequenceNumber ?? Number.MAX_SAFE_INTEGER) - (b.sequenceNumber ?? Number.MAX_SAFE_INTEGER)
    )[0];
    return { size: primary.gramWeight as number, unit: 'g', label: buildPortionLabel(primary) };
  }

  return null;
}

function roundMacro(value: number): number {
  return Math.round(value * 10) / 10; // foods.calories/protein/carbs/fat are DECIMAL(10,1)
}

export function applyPortion(food: Food, portion: UsdaPortion | null): Food {
  if (!portion) return food;

  const factor = portion.size / 100; // USDA macros are per 100 g
  return {
    ...food,
    calories: roundMacro(food.calories * factor),
    protein: roundMacro(food.protein * factor),
    carbs: roundMacro(food.carbs * factor),
    fat: roundMacro(food.fat * factor),
    serving_size: Math.round(portion.size * 100) / 100, // serving_size is DECIMAL(10,2)
    serving_unit: portion.unit,
    serving_label: portion.label,
  };
}

interface UsdaNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  nutrientName?: string;
  unitName?: string;
  value?: number;
}

interface UsdaFood {
  fdcId?: number;
  description?: string;
  lowercaseDescription?: string;
  foodNutrients?: UsdaNutrient[];
  // Serving fields carried by the search response — more reliable than the detail endpoint
  // for branded foods (detail often omits servingSize) and avoids a 404 for Foundation foods.
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  gtinUpc?: string;
}

interface UsdaSearchResponse {
  foods?: UsdaFood[];
}

function mapUsdaFood(food: UsdaFood): Food {
  const nutrients = food.foodNutrients || [];
  const getNutrient = (ids: number[], numbers: string[], names: string[], unit = 'G') => {
    const normalizedUnit = unit.toUpperCase();
    const nutrient = nutrients.find((item) => (
      item.unitName?.toUpperCase() === normalizedUnit
      && (ids.includes(item.nutrientId ?? -1) || numbers.includes(item.nutrientNumber ?? ''))
    )) || nutrients.find((item) => (
      item.unitName?.toUpperCase() === normalizedUnit
      && names.some((name) => item.nutrientName?.toLowerCase() === name)
    )) || nutrients.find((item) => (
      !item.unitName
      && names.some((name) => item.nutrientName?.toLowerCase() === name)
    ));
    return nutrient?.value || 0;
  };
  const caloriesKcal = getNutrient([1008, 2047, 2048], ['208'], ['energy'], 'KCAL');
  const caloriesKj = caloriesKcal > 0 ? 0 : getNutrient([1062], ['268'], ['energy'], 'KJ');

  // Build the per-100 g base first, then apply any serving the search payload already carries.
  // The search response is a more reliable portion source than the detail endpoint:
  // branded foods often have servingSize only in the search result, and Foundation detail 404s.
  const base: Food = {
    id: food.fdcId?.toString() || '',
    user_id: null,
    name: food.description || food.lowercaseDescription || 'Unknown food',
    calories: caloriesKcal || caloriesKj / 4.184,
    protein: getNutrient([1003], ['203'], ['protein']),
    carbs: getNutrient([1005], ['205'], ['carbohydrate, by difference', 'carbohydrate']),
    fat: getNutrient([1004], ['204'], ['total lipid (fat)', 'fat']),
    serving_size: 100,
    serving_unit: 'g',
    source: 'usda',
    fdc_id: food.fdcId?.toString() || null,
  };

  // UsdaFood structurally satisfies selectPortionFromDetail's parameter (all read fields are optional).
  return applyPortion(base, selectPortionFromDetail(food));
}

export async function searchUsdaFoods(
  query: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<Food[]> {
  if (!query.trim() || !apiKey) return [];

  try {
    const response = await fetcher(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&pageSize=10&dataType=Foundation,SR Legacy,Survey (FNDDS)`
    );
    const data = (await response.json()) as UsdaSearchResponse;

    if (!data.foods || data.foods.length === 0) {
      return [];
    }

    return data.foods.map(mapUsdaFood);
  } catch (error) {
    console.error('USDA search error:', error);
    return [];
  }
}

export async function searchUsdaFoodByBarcode(
  barcode: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<Food | null> {
  const candidates = barcodeLookupCandidates(barcode);
  if (candidates.length === 0 || !apiKey) return null;

  try {
    const response = await fetcher(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(candidates[0])}&pageSize=50&dataType=Branded`
    );
    if (!response.ok) return null;

    const data = (await response.json()) as UsdaSearchResponse;
    const exactMatch = data.foods?.find((food) => food.gtinUpc && barcodesAreEquivalent(barcode, food.gtinUpc));
    return exactMatch ? mapUsdaFood(exactMatch) : null;
  } catch (error) {
    console.error('USDA barcode lookup error:', error);
    return null;
  }
}

export async function fetchUsdaFoodDetail(
  fdcId: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<UsdaFoodDetail | null> {
  if (!fdcId || !apiKey) return null;

  try {
    const response = await fetcher(
      `https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(fdcId)}?api_key=${apiKey}`
    );
    return (await response.json()) as UsdaFoodDetail;
  } catch (error) {
    console.error('USDA food detail error:', error);
    return null;
  }
}
