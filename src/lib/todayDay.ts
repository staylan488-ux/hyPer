import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import { sumMacros } from '@/lib/nutritionMacros';

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const EMPTY_TOTALS: NutritionTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };

/** The parts of Today that belong to one local day. */
export interface TodayDay {
  nutritionTotals: NutritionTotals;
  todayDone: { title: string } | null;
}

async function readNutritionTotals(userId: string, day: string): Promise<NutritionTotals> {
  const { data: logs, error } = await fetchNutritionLogsWithFoods<
    { food_id: string; servings: number },
    { id: string; calories: number; protein: number; carbs: number; fat: number }
  >(userId, { from: day, to: day }, 'food_id, servings', 'id, calories, protein, carbs, fat');

  if (error) throw error;
  if (!logs || logs.length === 0) return EMPTY_TOTALS;
  return sumMacros(logs);
}

async function readTodayDone(userId: string, day: string): Promise<TodayDay['todayDone']> {
  const { data, error } = await supabase
    .from('workouts')
    .select('id, split_day_id')
    .eq('user_id', userId)
    .eq('date', day)
    .eq('completed', true)
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? { title: 'Session complete' } : null;
}

/**
 * Reads the day's food totals and whether a session was completed. Returns
 * null when either could not be read, so a failed refresh (offline, signed
 * out) is never mistaken for an empty day.
 */
export async function readTodayDay(day: string): Promise<TodayDay | null> {
  try {
    const userId = await getSessionUserId();
    if (!userId) return null;

    const [nutritionTotals, todayDone] = await Promise.all([
      readNutritionTotals(userId, day),
      readTodayDone(userId, day),
    ]);
    return { nutritionTotals, todayDone };
  } catch (error) {
    console.error('Error reading Today:', error);
    return null;
  }
}
