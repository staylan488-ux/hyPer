import { supabase } from '@/lib/supabase';
import type { Food } from '@/types';
import {
  PERSONAL_BARCODE_SOURCE,
  RESOLVABLE_EXTERNAL_SOURCES,
  mapSavedBarcodeFood,
  pickSavedBarcodeFood,
  type SavedBarcodeFoodRow,
} from '@/lib/savedBarcodeCore';

export { PERSONAL_BARCODE_SOURCE };

/**
 * Owner-scoped exact-barcode lookup against the user's saved foods. Runs
 * before any external provider so a previously scanned or label-captured
 * product resolves instantly and offline-safely.
 */
export async function findSavedFoodByBarcode(barcode: string): Promise<Food | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('foods')
    .select('id, user_id, name, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id, external_source, external_id')
    .eq('user_id', user.id)
    .eq('external_id', barcode)
    .in('external_source', RESOLVABLE_EXTERNAL_SOURCES)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    // a saved-catalog failure must not block the external providers
    console.error('Saved barcode lookup failed:', error);
    return null;
  }

  const row = pickSavedBarcodeFood((data || []) as SavedBarcodeFoodRow[]);
  return row ? mapSavedBarcodeFood(row) : null;
}

/**
 * Binds an existing owner food row to a barcode so the next scan of that
 * code resolves from the personal catalog.
 */
export async function bindFoodToBarcode(userId: string, foodId: string, barcode: string): Promise<boolean> {
  const { error } = await supabase
    .from('foods')
    .update({ external_source: PERSONAL_BARCODE_SOURCE, external_id: barcode })
    .eq('id', foodId)
    .eq('user_id', userId);

  if (error) {
    console.error('Could not bind food to barcode:', error);
    return false;
  }
  return true;
}
