import type { Food } from '@/types';

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
  nutrientName?: string;
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
}

interface UsdaSearchResponse {
  foods?: UsdaFood[];
}

function mapUsdaFood(food: UsdaFood): Food {
  const nutrients = food.foodNutrients || [];
  const getNutrient = (name: string) => {
    const nutrient = nutrients.find((item) =>
      item.nutrientName?.toLowerCase().includes(name.toLowerCase())
    );
    return nutrient?.value || 0;
  };

  // Build the per-100 g base first, then apply any serving the search payload already carries.
  // The search response is a more reliable portion source than the detail endpoint:
  // branded foods often have servingSize only in the search result, and Foundation detail 404s.
  const base: Food = {
    id: food.fdcId?.toString() || '',
    user_id: null,
    name: food.description || food.lowercaseDescription || 'Unknown food',
    calories: getNutrient('energy'),
    protein: getNutrient('protein'),
    carbs: getNutrient('carbohydrate'),
    fat: getNutrient('total lipid (fat)'),
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
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&pageSize=10&dataType=Foundation,SR Legacy,Branded`
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
