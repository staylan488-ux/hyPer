import { supabase } from '@/lib/supabase';

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
  const { data: logs, error: logsError } = await supabase
    .from('nutrition_logs')
    .select('food_id, servings')
    .eq('user_id', userId)
    .eq('date', day);

  if (logsError) throw logsError;
  if (!logs || logs.length === 0) return EMPTY_TOTALS;

  const foodIds = [...new Set(logs.map((log) => log.food_id))];

  const { data: foods, error: foodsError } = await supabase
    .from('foods')
    .select('id, calories, protein, carbs, fat')
    .in('id', foodIds);

  if (foodsError || !foods) throw foodsError ?? new Error('No foods returned');

  const foodMap = new Map(foods.map((food) => [food.id, food]));

  return logs.reduce(
    (acc, log) => {
      const food = foodMap.get(log.food_id);
      if (!food) return acc;

      return {
        calories: acc.calories + (food.calories || 0) * log.servings,
        protein: acc.protein + (food.protein || 0) * log.servings,
        carbs: acc.carbs + (food.carbs || 0) * log.servings,
        fat: acc.fat + (food.fat || 0) * log.servings,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const [nutritionTotals, todayDone] = await Promise.all([
      readNutritionTotals(user.id, day),
      readTodayDone(user.id, day),
    ]);
    return { nutritionTotals, todayDone };
  } catch (error) {
    console.error('Error reading Today:', error);
    return null;
  }
}
