import { supabase } from '@/lib/supabase';
import { normalizeFoodName } from '@/components/nutrition/foodLoggerUtils';
import { insertOneServingFood, type OneServingFoodValues } from '@/lib/foodPersistence';

// Saved meals are foods rows with one of these sources. Deleting or replacing
// one moves it to manual_entry, so past logs that point at it keep their food.
export const SAVED_MEAL_SOURCES = ['saved_meal', 'custom'] as const;

// Rows fetched before de-duplication; the food logger and Settings share it so
// both screens list the same meals.
export const SAVED_MEAL_FETCH_LIMIT = 150;

/** The user's saved-meal rows, newest first, before any de-duplication. */
export async function listSavedMealRows<Row extends { name?: string | null }>(
  userId: string,
  columns: string,
): Promise<{ data: Row[] | null; error: unknown }> {
  const { data, error } = await supabase
    .from('foods')
    .select(columns)
    .eq('user_id', userId)
    .in('source', [...SAVED_MEAL_SOURCES])
    .order('created_at', { ascending: false })
    .limit(SAVED_MEAL_FETCH_LIMIT);
  return { data: data as Row[] | null, error };
}

/**
 * One entry per meal name (case and spacing ignored). Rows come newest first,
 * so the newest row with a name wins; rows without a name are skipped.
 */
export function dedupeSavedMealsByName<Row extends { name?: string | null }, T>(
  rows: readonly Row[] | null | undefined,
  mapRow: (row: Row) => T,
): T[] {
  const byName = new Map<string, T>();
  for (const row of rows || []) {
    const key = normalizeFoodName(row.name || '');
    if (!key || byName.has(key)) continue;
    byName.set(key, mapRow(row));
  }
  return Array.from(byName.values());
}

/** Inserts a one-serving saved meal and returns its id, or null with the error. */
export function insertSavedMeal(userId: string, values: OneServingFoodValues) {
  return insertOneServingFood(userId, values, 'saved_meal');
}

/**
 * Takes a meal off the saved list by turning it into a plain manual entry.
 * Never hard-deletes: past logs still reference the row.
 */
export async function retireSavedMeal(userId: string, mealId: string): Promise<{ error: unknown }> {
  const { error } = await supabase
    .from('foods')
    .update({ source: 'manual_entry' })
    .eq('id', mealId)
    .eq('user_id', userId)
    .in('source', [...SAVED_MEAL_SOURCES]);
  return { error };
}
