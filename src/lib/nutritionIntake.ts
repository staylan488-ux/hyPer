// Daily calorie totals for the adaptive expenditure estimator.
//
// The logs -> foods join is the shared one in nutritionLogQueries, the same
// query Today, Fuel and Progress use. A day appears only when at least one of
// its entries has a countable calorie value.

import type { DailyIntake } from './adaptiveExpenditure';
import { fetchNutritionLogsWithFoods } from './nutritionLogQueries';
import { logMacro } from './nutritionMacros';

export async function getDailyIntake(userId: string, sinceIsoDate: string): Promise<DailyIntake[]> {
  const { data: rows, error, incomplete } = await fetchNutritionLogsWithFoods<
    { date: string; servings: number | string; food_id: string },
    { id: string; calories: number | string }
  >(userId, { from: sinceIsoDate }, 'date, servings, food_id', 'id, calories');

  if (error) throw new Error(error.message);
  // A brand food whose details this phone could not read counts as nothing;
  // an estimate built on a short total would be wrong, so this read fails
  // like any other and the next one tries again.
  if (incomplete) throw new Error('Some logged foods could not be read');
  if (!rows || rows.length === 0) return [];

  const totals = new Map<string, number>();
  for (const row of rows) {
    const calories = logMacro(row, 'calories');
    if (calories === null) continue;
    totals.set(row.date, (totals.get(row.date) ?? 0) + calories);
  }

  return [...totals.entries()]
    .map(([date, calories]) => ({ date, calories }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
