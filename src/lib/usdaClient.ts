import { supabase } from '@/lib/supabase';
import type { Food } from '@/types';
import {
  applyPortion,
  fetchUsdaFoodDetail,
  selectPortionFromDetail,
  searchUsdaFoodByBarcode,
  searchUsdaFoods,
  type UsdaFoodDetail,
} from '@/lib/usdaSearch';
import { mapOpenFoodFactsProduct } from '@/lib/openFoodFacts';
import { mapFatSecretBarcodeFood, type FatSecretBarcodeResponse } from '@/lib/fatSecret';

/**
 * Why a food lookup got no answer, so a screen can say what is true: the
 * request never reached hyPer (`offline`), the account's lookups are spent for
 * the moment (`limited`), or the request arrived and the lookup behind it
 * failed (`unavailable`), which is no fault of the phone's connection.
 */
export type FoodLookupFailure = 'offline' | 'limited' | 'unavailable';

export class FoodLookupError extends Error {
  readonly reason: FoodLookupFailure;

  constructor(reason: FoodLookupFailure, detail: string) {
    super(`Food lookup failed: ${detail}`);
    this.name = 'FoodLookupError';
    this.reason = reason;
  }
}

/** The reason behind a failed lookup; anything that is not a FoodLookupError got no answer at all. */
export function foodLookupFailure(error: unknown): FoodLookupFailure {
  return error instanceof FoodLookupError ? error.reason : 'offline';
}

// supabase-js names the failure: FunctionsFetchError when the request got no
// answer, FunctionsHttpError (with the response as its context) when the
// function answered with an error status.
function failureReason(error: { name?: string; context?: unknown }): FoodLookupFailure {
  if (error.name === 'FunctionsFetchError') return 'offline';
  const status = (error.context as { status?: unknown } | null | undefined)?.status;
  return status === 429 ? 'limited' : 'unavailable';
}

async function invokeFoodLookup(body: Record<string, string>): Promise<Response> {
  const { data, error } = await supabase.functions.invoke('food-lookup', { body });
  if (error) throw new FoodLookupError(failureReason(error), error.message);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function searchUsdaFoodsSecure(query: string): Promise<Food[]> {
  return searchUsdaFoods(query, 'server-side', () => invokeFoodLookup({ action: 'search', query }));
}

// Throws on a failed lookup instead of returning [], for the manual search box.
export function searchUsdaFoodsSecureStrict(query: string): Promise<Food[]> {
  return searchUsdaFoods(query, 'server-side', () => invokeFoodLookup({ action: 'search', query }), { rethrow: true });
}

export function searchUsdaFoodByBarcodeSecure(barcode: string): Promise<Food | null> {
  return searchUsdaFoodByBarcode(barcode, 'server-side', () => invokeFoodLookup({ action: 'barcode', barcode }));
}

export function fetchUsdaFoodDetailSecure(fdcId: string): Promise<UsdaFoodDetail | null> {
  return fetchUsdaFoodDetail(fdcId, 'server-side', () => invokeFoodLookup({ action: 'detail', fdcId }));
}

export async function searchOpenFoodFactsByBarcodeSecure(barcode: string): Promise<Food | null> {
  const response = await invokeFoodLookup({ action: 'open-food-facts-barcode', barcode });
  return mapOpenFoodFactsProduct(await response.json(), barcode);
}

// Returns null when FatSecret is not configured, the barcode is unknown, or the
// payload lacks complete macros — so the caller falls through to the next
// provider. Never merges FatSecret fields with another source.
export async function searchFatSecretByBarcodeSecure(barcode: string): Promise<Food | null> {
  const response = await invokeFoodLookup({ action: 'fatsecret-barcode', barcode });
  const payload = await response.json().catch(() => null) as
    (FatSecretBarcodeResponse & { configured?: boolean }) | null;
  if (!payload || payload.configured === false || !payload.food) return null;
  return mapFatSecretBarcodeFood(payload);
}

/** A USDA search result with its household portion, when the result has no serving label yet. */
export async function withUsdaPortion(food: Food): Promise<Food> {
  if (food.source !== 'usda' || !food.fdc_id || food.serving_label) return food;
  const portion = selectPortionFromDetail(await fetchUsdaFoodDetailSecure(food.fdc_id));
  return portion ? applyPortion(food, portion) : food;
}
