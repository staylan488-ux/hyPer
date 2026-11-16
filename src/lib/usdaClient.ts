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
import { deviceFoodIds, deviceFoodKey } from '@/lib/deviceFoods';
import {
  mapFatSecretBarcodeFood,
  mapFatSecretFood,
  mapFatSecretSearch,
  type FatSecretBarcodeResponse,
  type FatSecretFoodsResponse,
  type FatSecretSearchResponse,
} from '@/lib/fatSecret';

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

// Every FatSecret request says the phone keeps the details (`keeps`):
// food-lookup answers FatSecret lookups only for builds that do, so an older
// build, which saved a FatSecret food's name and numbers on the server, is
// told the provider is off and falls through to the others.
const DEVICE_KEEPS = { keeps: 'device' } as const;

// Returns null when FatSecret is not configured, the barcode is unknown, or the
// payload lacks complete macros — so the caller falls through to the next
// provider. Never merges FatSecret fields with another source.
export async function searchFatSecretByBarcodeSecure(barcode: string): Promise<Food | null> {
  const response = await invokeFoodLookup({ action: 'fatsecret-barcode', barcode, ...DEVICE_KEEPS });
  const payload = await response.json().catch(() => null) as
    (FatSecretBarcodeResponse & { configured?: boolean }) | null;
  if (!payload || payload.configured === false || !payload.food) return null;
  return mapFatSecretBarcodeFood(payload);
}

/**
 * Packaged and restaurant food for a typed search, from FatSecret, or null
 * when FatSecret is switched off (the screen then shows no brand section at
 * all). Throws a FoodLookupError when the lookup fails.
 */
export async function searchFatSecretFoodsSecure(query: string): Promise<Food[] | null> {
  const response = await invokeFoodLookup({ action: 'fatsecret-search', query, ...DEVICE_KEEPS });
  const payload = await response.json().catch(() => null) as FatSecretSearchResponse | null;
  if (!payload || payload.configured === false) return null;
  return mapFatSecretSearch(payload);
}

/** Device-only food keys one request may ask for; food-lookup takes no more. */
export const FATSECRET_FOODS_PER_REQUEST = 20;

export type FatSecretFoodsAnswer =
  /** FatSecret is switched off: nothing can be read for now. */
  | { configured: false }
  /** `foods` by key; `gone` are keys FatSecret no longer has. A key in neither failed this time. */
  | { configured: true; foods: Map<string, Food>; gone: string[] };

/**
 * FatSecret foods read again by the IDs hyPer keeps, for a phone that does
 * not hold their details (src/lib/deviceFoodRefill.ts). Keys are deviceFoods
 * keys ("fatsecret:<food id>:<serving id>"). Throws a FoodLookupError when
 * the lookup fails.
 */
export async function fetchFatSecretFoodsSecure(keys: readonly string[]): Promise<FatSecretFoodsAnswer> {
  const wanted = keys.flatMap((key) => {
    const ids = deviceFoodIds(key);
    return ids ? [{ key, ...ids }] : [];
  }).slice(0, FATSECRET_FOODS_PER_REQUEST);
  if (wanted.length === 0) return { configured: true, foods: new Map(), gone: [] };

  const response = await invokeFoodLookup({
    action: 'fatsecret-foods',
    ids: [...new Set(wanted.map((item) => item.foodId))].join(','),
    ...DEVICE_KEEPS,
  });
  const payload = await response.json().catch(() => null) as FatSecretFoodsResponse | null;
  if (!payload) throw new FoodLookupError('unavailable', 'unreadable FatSecret answer');
  if (payload.configured === false) return { configured: false };

  const returned = new Map((Array.isArray(payload.foods) ? payload.foods : []).map((food) => [String(food?.food_id ?? ''), food]));
  const missing = new Set((Array.isArray(payload.missing) ? payload.missing : []).map(String));
  const foods = new Map<string, Food>();
  const gone: string[] = [];
  for (const { key, foodId, servingId } of wanted) {
    const food = returned.get(foodId);
    if (!food) {
      if (missing.has(foodId)) gone.push(key);
      continue;
    }
    const mapped = mapFatSecretFood(food, servingId);
    // FatSecret has the food but no longer this serving of it.
    if (mapped && deviceFoodKey(mapped) === key) foods.set(key, mapped);
    else gone.push(key);
  }
  return { configured: true, foods, gone };
}

/** A USDA search result with its household portion, when the result has no serving label yet. */
export async function withUsdaPortion(food: Food): Promise<Food> {
  if (food.source !== 'usda' || !food.fdc_id || food.serving_label) return food;
  const portion = selectPortionFromDetail(await fetchUsdaFoodDetailSecure(food.fdc_id));
  return portion ? applyPortion(food, portion) : food;
}
