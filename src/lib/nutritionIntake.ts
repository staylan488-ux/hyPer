// Daily calorie totals for the adaptive expenditure estimator.
//
// nutrition_logs has no FK-embedded select, so the join is two round-trips —
// the same shape Dashboard and Nutrition already use.

import { supabase } from './supabase';
import type { DailyIntake } from './adaptiveExpenditure';

interface LogRow {
  date: string;
  servings: number | string;
  food_id: string;
}

export async function getDailyIntake(userId: string, sinceIsoDate: string): Promise<DailyIntake[]> {
  const { data: logs, error: logsError } = await supabase
    .from('nutrition_logs')
    .select('date, servings, food_id')
    .eq('user_id', userId)
    .gte('date', sinceIsoDate);

  if (logsError) throw new Error(logsError.message);
  if (!logs || logs.length === 0) return [];

  const rows = logs as LogRow[];
  const foodIds = [...new Set(rows.map((row) => row.food_id).filter(Boolean))];
  if (foodIds.length === 0) return [];

  const { data: foods, error: foodsError } = await supabase
    .from('foods')
    .select('id, calories')
    .in('id', foodIds);

  if (foodsError) throw new Error(foodsError.message);

  const caloriesByFood = new Map<string, number>();
  for (const food of (foods || []) as Array<{ id: string; calories: number | string }>) {
    caloriesByFood.set(food.id, Number(food.calories));
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    const calories = caloriesByFood.get(row.food_id);
    const servings = Number(row.servings);
    if (!Number.isFinite(calories as number) || !Number.isFinite(servings)) continue;
    totals.set(row.date, (totals.get(row.date) ?? 0) + (calories as number) * servings);
  }

  return [...totals.entries()]
    .map(([date, calories]) => ({ date, calories }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
