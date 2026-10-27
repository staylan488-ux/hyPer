// Which foods row a manual entry logs against, shared by the web food logger
// and the native app.
import { normalizeFoodName } from '@/components/nutrition/foodLoggerUtils';
import { insertOneServingFood, type OneServingFoodValues } from '@/lib/foodPersistence';
import { foodValuesMatch } from '@/lib/savedMeals';
import type { Food } from '@/types';

/** A one-off food row created by a failed attempt, reused when retried unchanged. */
export type OneOffFood = { key: string; id: string };

export type ManualFoodChoice =
  | { foodId: string; createdSavedMeal: boolean; oneOff: OneOffFood | null }
  | { foodId: null; error: 'saved_meal' | 'entry' };

/**
 * Picks the food row in the web logger's order:
 * 1. the picked saved meal, when its values are unchanged;
 * 2. with "Save as reusable" on, an existing saved meal with the same values;
 * 3. with it on, a new saved meal;
 * 4. when editing an entry whose food is unchanged (only servings, time or
 *    group changed), the original row, so its fdc_id, basis and saved-meal
 *    link survive;
 * 5. the one-off row a failed attempt already created for these values;
 * 6. a new one-off manual_entry row.
 */
export async function resolveManualFood(input: {
  userId: string;
  values: OneServingFoodValues;
  selectedSavedMeal: Food | null;
  saveAsReusable: boolean;
  savedMeals: readonly Food[];
  originalEntry?: { food_id: string; food: OneServingFoodValues | null } | null;
  cachedOneOff: OneOffFood | null;
}): Promise<ManualFoodChoice> {
  const { userId, values } = input;

  if (input.selectedSavedMeal && foodValuesMatch(input.selectedSavedMeal, values)) {
    return { foodId: input.selectedSavedMeal.id, createdSavedMeal: false, oneOff: null };
  }

  if (input.saveAsReusable) {
    const existing = input.savedMeals.find((meal) => foodValuesMatch(meal, values));
    if (existing) return { foodId: existing.id, createdSavedMeal: false, oneOff: null };
    const { id } = await insertOneServingFood(userId, values, 'saved_meal');
    if (!id) return { foodId: null, error: 'saved_meal' };
    return { foodId: id, createdSavedMeal: true, oneOff: null };
  }

  const original = input.originalEntry;
  if (original?.food_id && original.food && foodValuesMatch(original.food, values)) {
    return { foodId: original.food_id, createdSavedMeal: false, oneOff: null };
  }

  const key = [userId, normalizeFoodName(values.name), values.calories, values.protein, values.carbs, values.fat].join('|');
  if (input.cachedOneOff?.key === key) {
    return { foodId: input.cachedOneOff.id, createdSavedMeal: false, oneOff: input.cachedOneOff };
  }
  const { id, error } = await insertOneServingFood(userId, values, 'manual_entry');
  if (!id) {
    console.error('Error creating one-off manual food entry', error);
    return { foodId: null, error: 'entry' };
  }
  return { foodId: id, createdSavedMeal: false, oneOff: { key, id } };
}
