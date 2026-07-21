import type { Food } from '@/types';

interface OpenFoodFactsNutriments {
  'energy-kcal_100g'?: number | string;
  'energy-kcal_serving'?: number | string;
  proteins_100g?: number | string;
  proteins_serving?: number | string;
  carbohydrates_100g?: number | string;
  carbohydrates_serving?: number | string;
  fat_100g?: number | string;
  fat_serving?: number | string;
}

interface OpenFoodFactsProduct {
  product_name?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  nutrition_data_per?: string;
  nutriments?: OpenFoodFactsNutriments;
}

export interface OpenFoodFactsResponse {
  code?: string;
  status?: number;
  product?: OpenFoodFactsProduct;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function roundMacro(value: number): number {
  return Math.round(value * 10) / 10;
}

export function mapOpenFoodFactsProduct(
  payload: OpenFoodFactsResponse | null | undefined,
  fallbackBarcode: string,
): Food | null {
  if (payload?.status !== 1 || !payload.product) return null;

  const product = payload.product;
  const nutriments = product.nutriments || {};
  const productName = product.product_name?.trim() || product.generic_name?.trim();
  if (!productName) return null;

  const servingQuantity = finiteNumber(product.serving_quantity);
  const servingValues = {
    calories: finiteNumber(nutriments['energy-kcal_serving']),
    protein: finiteNumber(nutriments.proteins_serving),
    carbs: finiteNumber(nutriments.carbohydrates_serving),
    fat: finiteNumber(nutriments.fat_serving),
  };
  const per100Values = {
    calories: finiteNumber(nutriments['energy-kcal_100g']),
    protein: finiteNumber(nutriments.proteins_100g),
    carbs: finiteNumber(nutriments.carbohydrates_100g),
    fat: finiteNumber(nutriments.fat_100g),
  };
  // Pick the more complete basis. Never mix per-serving with per-100g fields —
  // they are different units, so a partial serving block (e.g. only
  // energy-kcal_serving) must not borrow protein/carbs/fat from the 100g block;
  // that would log correct calories with wrong macros. Missing fields within
  // the chosen basis fall back to 0. Tie goes to serving (needs no rescaling).
  const countKnown = (v: Record<string, number | null>) =>
    Object.values(v).filter((value) => value !== null).length;
  const hasServingNutrition = countKnown(servingValues) >= countKnown(per100Values)
    && countKnown(servingValues) > 0;
  const values = hasServingNutrition ? servingValues : per100Values;
  if (Object.values(values).every((value) => value === null)) return null;

  const barcode = String(payload.code || fallbackBarcode).replace(/\D/g, '') || fallbackBarcode;
  const brand = product.brands?.split(',')[0]?.trim();
  const name = brand && !productName.toLowerCase().includes(brand.toLowerCase())
    ? `${productName} · ${brand}`
    : productName;
  const declaredServingUnit = product.serving_quantity_unit?.trim().toLowerCase();
  const inferredServingUnit = /\bml\b/i.test(product.serving_size || '') ? 'ml' : /\bg\b/i.test(product.serving_size || '') ? 'g' : null;
  const quantityUnit = ['g', 'ml'].includes(declaredServingUnit || '')
    ? declaredServingUnit as 'g' | 'ml'
    : inferredServingUnit;
  const per100Unit = /ml/i.test(product.nutrition_data_per || '') ? 'ml' : 'g';
  const servingSize = hasServingNutrition && servingQuantity && servingQuantity > 0 && quantityUnit ? servingQuantity : hasServingNutrition ? 1 : 100;
  const servingUnit = hasServingNutrition && servingQuantity && servingQuantity > 0 && quantityUnit ? quantityUnit : hasServingNutrition ? 'serving' : per100Unit;
  const rawServingLabel = product.serving_size?.trim() || '';
  const servingLabelWithoutMetric = rawServingLabel.replace(/\s*\(\s*[\d.,]+\s*(?:g|ml)\s*\)\s*$/i, '').trim();
  const normalizedLabel = servingLabelWithoutMetric.toLowerCase().replace(/\s+/g, '');
  const normalizedMetric = `${servingSize}${servingUnit}`.toLowerCase().replace(/\s+/g, '');
  const servingLabel = servingLabelWithoutMetric && normalizedLabel !== normalizedMetric
    ? servingLabelWithoutMetric
    : undefined;

  return {
    id: `open-food-facts:${barcode}`,
    user_id: null,
    name,
    calories: roundMacro(values.calories ?? 0),
    protein: roundMacro(values.protein ?? 0),
    carbs: roundMacro(values.carbs ?? 0),
    fat: roundMacro(values.fat ?? 0),
    serving_size: servingSize,
    serving_unit: servingUnit,
    serving_label: servingLabel,
    source: 'open_food_facts',
    fdc_id: null,
    external_source: 'open_food_facts',
    external_id: barcode,
  };
}
