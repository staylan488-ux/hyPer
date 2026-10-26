// Today's food log for the Fuel and Today screens, read and written through
// the shared nutrition helpers (the same queries and saves the web app uses).
//
// Entries belong to the day's meal groups (nutrition_groups) exactly as in the
// web app: an entry points at a group or is Unassigned, and its legacy
// meal_type follows the group.
import { format } from 'date-fns';
import { create } from 'zustand';

import { legacyMealTypeForGroup, sortNutritionGroups } from '@/lib/nutritionGroups';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import { sumMacros, type MacroTotals } from '@/lib/nutritionMacros';
import { persistNutritionEntry } from '@/lib/saveNutritionEntry';
import { dedupeSavedMealsByName, listSavedMealRows } from '@/lib/savedMeals';
import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';
import { searchUsdaFoodsSecure } from '@/lib/usdaClient';
import type { Food, NutritionGroup, NutritionLog } from '@/types';

import { mealForTime } from './meals';

export type FoodLog = NutritionLog & { food: Food | null };

const LOG_COLUMNS = 'id, user_id, date, logged_at, food_id, servings, meal_type, group_id, sort_order, source';
const FOOD_COLUMNS = 'id, user_id, name, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id';

export const today = () => format(new Date(), 'yyyy-MM-dd');

export { mealForTime } from './meals';

/** Where a new entry goes and the id it saves under (reused on retry, so a lost response cannot duplicate it). */
export type NewEntry = { groupId: string | null; entryId: string };

type FuelState = {
  date: string;
  logs: FoodLog[];
  groups: NutritionGroup[];
  totals: MacroTotals;
  status: 'idle' | 'loading' | 'ready' | 'error';
  load: (date?: string) => Promise<void>;
  /** Logs one serving of a food that already has a foods row. */
  logFood: (food: Food, entry: NewEntry) => Promise<void>;
  /** Logs a search result, creating its foods row first. */
  logSearchResult: (food: Food, entry: NewEntry) => Promise<void>;
};

const emptyTotals: MacroTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };

/** The session's user id, the only id the shared code allows for queries (lib/sessionUser). */
async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) throw new Error('Sign in to log food.');
  return userId;
}

export const useFuelStore = create<FuelState>((set, get) => ({
  date: today(),
  logs: [],
  groups: [],
  totals: emptyTotals,
  status: 'idle',

  load: async (date = get().date) => {
    const userId = await getSessionUserId();
    if (!userId) return;
    set({ date, status: get().logs.length ? 'ready' : 'loading' });
    const [logsResult, groupsResult] = await Promise.all([
      fetchNutritionLogsWithFoods<NutritionLog, Food>(userId, { from: date, to: date }, LOG_COLUMNS, FOOD_COLUMNS),
      supabase.from('nutrition_groups').select('*').eq('user_id', userId).eq('date', date),
    ]);
    if (get().date !== date) return;
    if (logsResult.error || !logsResult.data || groupsResult.error) {
      set({ status: 'error' });
      return;
    }
    const logs = [...logsResult.data].sort((a, b) => (a.logged_at ?? '').localeCompare(b.logged_at ?? ''));
    set({
      logs,
      groups: sortNutritionGroups((groupsResult.data ?? []) as NutritionGroup[]),
      totals: sumMacros(logs),
      status: 'ready',
    });
  },

  logFood: async (food, { groupId, entryId }) => {
    const { date, groups } = get();
    const group = groups.find((candidate) => candidate.id === groupId) ?? null;
    await persistNutritionEntry(
      {
        food_id: food.id,
        servings: 1,
        meal_type: legacyMealTypeForGroup(group),
        group_id: group?.id ?? null,
        source: food.source === 'usda' ? 'usda' : 'manual',
        date,
        logged_at: new Date().toISOString(),
      },
      undefined,
      entryId,
    );
    await get().load(date);
  },

  logSearchResult: async (food, entry) => {
    await requireUserId();
    const foodId = await upsertUsdaFood(food);
    if (!foodId) throw new Error('This food could not be saved.');
    await get().logFood({ ...food, id: foodId, source: 'usda' }, entry);
  },
}));

/** The day's named meal that fits the time (breakfast, lunch or dinner), if the day has it. */
export function suggestedGroup(groups: NutritionGroup[], at = new Date()): NutritionGroup | null {
  const meal = mealForTime(at);
  return groups.find((group) => group.label === meal) ?? null;
}

/**
 * The foods row for a USDA search result, created on first use.
 *
 * Same rule as the web food logger's upsertFoodIfNeeded
 * (src/components/nutrition/FoodLogger.tsx): reuse a row only when its
 * fdc_id and serving basis both match, otherwise insert a new one, and never
 * change an existing row, since past logs point at it. TODO: move this into
 * a shared lib so both apps call one implementation.
 */
async function upsertUsdaFood(food: Food): Promise<string | null> {
  if (!food.fdc_id) return null;
  const servingSize = food.serving_size || 100;
  const servingUnit = food.serving_unit || 'g';

  const { data: existing, error: lookupError } = await supabase
    .from('foods')
    .select('id')
    .eq('fdc_id', food.fdc_id)
    .eq('serving_size', servingSize)
    .eq('serving_unit', servingUnit)
    .limit(1)
    .maybeSingle();
  if (lookupError) console.error('Error looking up food:', lookupError);
  if (existing?.id) return existing.id as string;

  const { data: created, error: insertError } = await supabase
    .from('foods')
    .insert({
      name: food.name,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      serving_size: servingSize,
      serving_unit: servingUnit,
      source: 'usda',
      fdc_id: food.fdc_id,
    })
    .select('id')
    .single();
  if (insertError || !created) {
    console.error('Error creating food:', insertError);
    return null;
  }
  return created.id as string;
}

export type SavedFood = Pick<Food, 'id' | 'name' | 'calories' | 'protein' | 'carbs' | 'fat' | 'source' | 'serving_size' | 'serving_unit' | 'fdc_id' | 'user_id'>;

export async function loadSavedFoods(): Promise<SavedFood[]> {
  const userId = await requireUserId();
  const { data, error } = await listSavedMealRows<SavedFood>(userId, FOOD_COLUMNS);
  if (error) throw error instanceof Error ? error : new Error('Saved meals could not load.');
  return dedupeSavedMealsByName(data, (row) => row);
}

export function searchFoods(query: string): Promise<Food[]> {
  return searchUsdaFoodsSecure(query);
}
