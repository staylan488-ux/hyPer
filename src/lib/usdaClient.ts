import { supabase } from '@/lib/supabase';
import type { Food } from '@/types';
import {
  fetchUsdaFoodDetail,
  searchUsdaFoodByBarcode,
  searchUsdaFoods,
  type UsdaFoodDetail,
} from '@/components/nutrition/usdaSearch';
import { mapOpenFoodFactsProduct } from '@/lib/openFoodFacts';
import { mapFatSecretBarcodeFood, type FatSecretBarcodeResponse } from '@/lib/fatSecret';

async function invokeFoodLookup(body: Record<string, string>): Promise<Response> {
  const { data, error } = await supabase.functions.invoke('food-lookup', { body });
  if (error) throw new Error(`Food lookup failed: ${error.message}`);
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function searchUsdaFoodsSecure(query: string): Promise<Food[]> {
  return searchUsdaFoods(query, 'server-side', () => invokeFoodLookup({ action: 'search', query }));
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
