import { supabase } from '@/lib/supabase';
import { normalizeFoodName, numbersNearlyEqual } from '@/lib/foodLoggerUtils';
import { insertOneServingFood, type OneServingFoodValues } from '@/lib/foodPersistence';
import type { Food } from '@/types';

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

type SavedMealRow = Pick<Food, 'id' | 'user_id' | 'name' | 'calories' | 'protein' | 'carbs' | 'fat' | 'fdc_id' | 'description'> & {
  serving_size: number | null;
  serving_unit: string | null;
};

const SAVED_MEAL_COLUMNS = 'id, user_id, name, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id, description';

/** The user's saved meals as foods, one per name, newest first. */
export async function loadSavedMeals(userId: string): Promise<{ meals: Food[]; error: unknown }> {
  const { data, error } = await listSavedMealRows<SavedMealRow>(userId, SAVED_MEAL_COLUMNS);
  if (error) return { meals: [], error };
  const meals = dedupeSavedMealsByName(data, (meal): Food => ({
    id: meal.id,
    user_id: meal.user_id,
    name: meal.name,
    calories: Number(meal.calories) || 0,
    protein: Number(meal.protein) || 0,
    carbs: Number(meal.carbs) || 0,
    fat: Number(meal.fat) || 0,
    serving_size: Number(meal.serving_size) || 1,
    serving_unit: meal.serving_unit || 'serving',
    source: 'custom',
    fdc_id: meal.fdc_id,
    description: meal.description,
  }));
  return { meals, error: null };
}

/** Same name (case and spacing ignored) and the same macros within 0.05. */
export function foodValuesMatch(a: OneServingFoodValues, b: OneServingFoodValues): boolean {
  return normalizeFoodName(a.name) === normalizeFoodName(b.name)
    && numbersNearlyEqual(a.calories, b.calories)
    && numbersNearlyEqual(a.protein, b.protein)
    && numbersNearlyEqual(a.carbs, b.carbs)
    && numbersNearlyEqual(a.fat, b.fat);
}

/** Saved meals for a typed name: starts-with matches first, then contains, at most six. */
export function savedMealSuggestions<T extends { name: string }>(meals: readonly T[], typed: string): T[] {
  const query = normalizeFoodName(typed);
  if (query.length < 2) return [];
  const startsWith = meals.filter((meal) => normalizeFoodName(meal.name).startsWith(query));
  const contains = meals.filter((meal) => {
    const name = normalizeFoodName(meal.name);
    return !name.startsWith(query) && name.includes(query);
  });
  return [...startsWith, ...contains].slice(0, 6);
}

/** Saved meals whose name contains the filter text. */
export function filterSavedMeals<T extends { name: string }>(meals: readonly T[], filter: string): T[] {
  const query = normalizeFoodName(filter);
  if (!query) return [...meals];
  return meals.filter((meal) => normalizeFoodName(meal.name).includes(query));
}

/**
 * Replaces a saved meal with new values for future logs: inserts the new meal,
 * then retires the old one (past logs keep pointing at it). When retiring
 * fails the new meal still exists, so the caller warns that both are listed.
 */
export async function replaceSavedMeal(
  userId: string,
  oldMealId: string,
  values: OneServingFoodValues,
): Promise<{ id: string | null; retireFailed: boolean }> {
  const { id } = await insertSavedMeal(userId, values);
  if (!id) return { id: null, retireFailed: false };
  const { error } = await retireSavedMeal(userId, oldMealId);
  return { id, retireFailed: Boolean(error) };
}
