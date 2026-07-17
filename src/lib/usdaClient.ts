import { supabase } from '@/lib/supabase';
import type { Food } from '@/types';
import {
  fetchUsdaFoodDetail,
  searchUsdaFoodByBarcode,
  searchUsdaFoods,
  type UsdaFoodDetail,
} from '@/components/nutrition/usdaSearch';

async function invokeFoodLookup(body: Record<string, string>): Promise<Response> {
  const { data, error } = await supabase.functions.invoke('food-lookup', { body });
  if (error) throw new Error(`USDA lookup failed: ${error.message}`);
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
