// Pure meal helpers, covered by tests/nativeSessionModel.test.ts.
import type { NutritionLog } from '@/types';

export type MealType = NonNullable<NutritionLog['meal_type']>;

/** The named meal that fits this local time; used to suggest where a new entry goes. */
export function mealForTime(date = new Date()): MealType {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < 10 * 60 + 30) return 'breakfast';
  if (minutes < 15 * 60) return 'lunch';
  if (minutes < 21 * 60) return 'dinner';
  return 'snack';
}
