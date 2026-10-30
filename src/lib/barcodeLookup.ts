// What a scanned or typed food barcode resolves to, shared by the web food
// logger and the native app.
import { applyPortion, selectPortionFromDetail } from '@/lib/usdaSearch';
import { resolveBarcodeByPriority } from '@/lib/barcodePriority';
import { findSavedFoodByBarcode } from '@/lib/savedBarcodeFoods';
import type { BarcodeProvider } from '@/lib/saveNutritionEntry';
import {
  fetchUsdaFoodDetailSecure,
  searchFatSecretByBarcodeSecure,
  searchOpenFoodFactsByBarcodeSecure,
  searchUsdaFoodByBarcodeSecure,
} from '@/lib/usdaClient';
import type { Food } from '@/types';

export { BARCODE_AVAILABILITY_TIMEOUT_MS, BARCODE_LOOKUP_TIMEOUT_MS, BARCODE_MESSAGES, BARCODE_SCAN_TIMEOUT_MS } from '@/lib/barcodes';

export type BarcodeLookup =
  | { status: 'found'; food: Food; provider: BarcodeProvider }
  | { status: 'miss' }
  // a newer lookup started (or the scan screen was left); apply nothing
  | { status: 'stale' };

/**
 * The owner's saved catalog first (a rescan of a saved product makes no
 * provider calls), then every external provider at once, taking the answer in
 * fixed priority: FatSecret, USDA branded, Open Food Facts. A failing source
 * counts as a miss. A USDA product without a serving label gets its portion
 * from the detail record. `isCurrent` is checked after every await.
 */
export async function lookupBarcode(barcode: string, isCurrent: () => boolean = () => true): Promise<BarcodeLookup> {
  let food = await findSavedFoodByBarcode(barcode);
  let provider: BarcodeProvider = 'saved';
  if (!isCurrent()) return { status: 'stale' };

  if (!food) {
    const external = await resolveBarcodeByPriority([
      ['fatsecret', () => searchFatSecretByBarcodeSecure(barcode)],
      ['usda', () => searchUsdaFoodByBarcodeSecure(barcode)],
      ['open_food_facts', () => searchOpenFoodFactsByBarcodeSecure(barcode)],
    ] as const);
    if (!isCurrent()) return { status: 'stale' };
    if (external) {
      food = external.value;
      provider = external.provider;
    }
  }
  if (!food) return { status: 'miss' };

  if (food.fdc_id && !food.serving_label) {
    const detail = await fetchUsdaFoodDetailSecure(food.fdc_id);
    if (!isCurrent()) return { status: 'stale' };
    const portion = selectPortionFromDetail(detail);
    if (portion) food = applyPortion(food, portion);
  }
  return { status: 'found', food, provider };
}

/** Where a barcode product's numbers came from, for the review line. */
export function barcodeProviderLabel(provider: BarcodeProvider): string {
  if (provider === 'open_food_facts') return 'Open Food Facts';
  if (provider === 'saved') return 'from your saved foods';
  if (provider === 'fatsecret') return 'FatSecret';
  return 'USDA branded record';
}
