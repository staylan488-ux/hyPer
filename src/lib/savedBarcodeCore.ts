import type { Food } from '@/types';

// row shape returned by the foods barcode query; numbers may arrive as strings
export interface SavedBarcodeFoodRow {
  id: string;
  user_id: string | null;
  name: string | null;
  calories: number | string | null;
  protein: number | string | null;
  carbs: number | string | null;
  fat: number | string | null;
  serving_size: number | string | null;
  serving_unit: string | null;
  source: string | null;
  fdc_id: string | null;
  external_source: string | null;
  external_id: string | null;
}

// user-created products bound to a barcode use this marker; previously saved
// Open Food Facts scans keep their provider tag but still resolve locally
export const PERSONAL_BARCODE_SOURCE = 'barcode';
export const RESOLVABLE_EXTERNAL_SOURCES = [PERSONAL_BARCODE_SOURCE, 'open_food_facts'];

export function pickSavedBarcodeFood(rows: SavedBarcodeFoodRow[]): SavedBarcodeFoodRow | null {
  if (rows.length === 0) return null;
  // the owner's own label-captured product wins over a cached provider record
  return rows.find((row) => row.external_source === PERSONAL_BARCODE_SOURCE) ?? rows[0];
}

export function mapSavedBarcodeFood(row: SavedBarcodeFoodRow): Food {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name || 'Saved product',
    calories: Number(row.calories) || 0,
    protein: Number(row.protein) || 0,
    carbs: Number(row.carbs) || 0,
    fat: Number(row.fat) || 0,
    serving_size: Number(row.serving_size) || 1,
    serving_unit: row.serving_unit || 'serving',
    source: 'custom',
    fdc_id: row.fdc_id,
    external_source: row.external_source,
    external_id: row.external_id,
  };
}
