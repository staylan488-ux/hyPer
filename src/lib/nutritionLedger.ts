// How the day's food entries read, shared by the web ledger and the native app.
import { getLogTimestamp } from '@/components/nutrition/nutritionLogUtils';

export function sourceLabel(source?: string): string {
  if (source === 'meal_builder') return 'Meal';
  if (!source || source === 'manual') return 'Manual';
  if (source === 'usda') return 'USDA';
  if (source === 'cronometer_csv') return 'Cronometer';
  if (source === 'photo_openai') return 'OpenAI photo';
  if (source === 'photo_anthropic') return 'Claude photo';
  if (source === 'gemini_label') return 'Gemini · label reviewed';
  if (source === 'gemini_estimate' || source === 'gemini_trial') return 'Gemini estimate';
  if (source === 'barcode_fatsecret') return 'FatSecret';
  if (source === 'barcode_open_food_facts') return 'Open Food Facts';
  if (source === 'barcode') return 'Barcode';
  return 'Manual';
}

type ServingLike = { servings: number; food?: { serving_size?: number | null; serving_unit?: string | null } | null };

/** "150 g" for measured foods, "1.5 servings" otherwise. */
export function servingLabel(log: ServingLike): string {
  const unit = log.food?.serving_unit?.trim();
  const servingSize = Number(log.food?.serving_size) || 1;
  if (unit && unit.toLowerCase() !== 'serving') {
    const amount = Math.round(servingSize * log.servings * 100) / 100;
    return `${amount} ${unit}`;
  }
  return `${log.servings} serving${log.servings !== 1 ? 's' : ''}`;
}

type LedgerSortable = { sort_order?: number | null; logged_at: string | null; created_at?: string | null; date: string };

/** Within a group: its sort order, then time. */
export function sortLedgerEntries<T extends LedgerSortable>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || getLogTimestamp(a) - getLogTimestamp(b));
}
