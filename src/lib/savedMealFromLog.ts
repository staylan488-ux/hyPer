// Saving logged food as a meal to reuse: Fuel's "Save as meal" turns a day's
// meal, or one entry, into a saved meal after the fact. Each food keeps the
// amount eaten; a built meal among them adds its own ingredients.
import { combinedMealName } from '@/lib/combineMeal';
import { normalizeFoodName } from '@/lib/foodLoggerUtils';
import { createMealIngredient, expandMealIngredients, type MealIngredient } from '@/lib/mealComposition';
import type { Food } from '@/types';

export type LoggedFood = { food?: Food | null; servings: number | string | null };

const FOOD_SOURCES: readonly Food['source'][] = ['custom', 'usda', 'fatsecret', 'open_food_facts', 'saved_meal', 'manual_entry', 'cronometer', 'photo'];
// as in savedMeals.ts, kept here so this rule stays free of the database client
const SAVED_SOURCES: readonly string[] = ['saved_meal', 'custom'];

const amountOf = (entry: LoggedFood) => Number(entry.servings);

/**
 * A logged food as a meal ingredient, at the amount eaten. The food row is
 * copied as the meal keeps it (numbers as numbers, an unknown source as a
 * manual entry), so an older or odd row still makes a valid meal.
 */
function ingredientFor(entry: LoggedFood, newId: () => string): MealIngredient | null {
  const servings = amountOf(entry);
  const food = entry.food;
  if (!food || !(servings > 0)) return null;
  const fdcId = food.fdc_id as unknown;
  try {
    return createMealIngredient(
      {
        id: String(food.id),
        user_id: food.user_id ?? null,
        name: String(food.name ?? '').trim(),
        calories: Number(food.calories) || 0,
        protein: Number(food.protein) || 0,
        carbs: Number(food.carbs) || 0,
        fat: Number(food.fat) || 0,
        serving_size: Number(food.serving_size) > 0 ? Number(food.serving_size) : 1,
        serving_unit: food.serving_unit?.trim() || 'serving',
        source: FOOD_SOURCES.includes(food.source) ? food.source : 'manual_entry',
        fdc_id: fdcId === null || fdcId === undefined ? null : String(fdcId),
        description: food.description ?? null,
      },
      servings,
      newId(),
    );
  } catch {
    return null;
  }
}

/**
 * The meal a set of logged entries makes: their foods at the amounts eaten (a
 * built meal opens into its own ingredients, as adding one to a meal does),
 * named after them: "Oats", "Oats and Coffee", "Eggs, Toast, Butter and 2 more".
 */
export function mealFromLoggedFoods(
  entries: readonly LoggedFood[],
  newId: () => string = () => crypto.randomUUID(),
): { name: string; ingredients: MealIngredient[] } {
  const parts = entries.map((entry) => ingredientFor(entry, newId)).filter((part): part is MealIngredient => part !== null);
  let ingredients = parts;
  try {
    ingredients = expandMealIngredients(parts, newId);
  } catch {
    // a built meal whose recipe no longer reads stays whole
  }
  const seen = new Set<string>();
  const names = parts.filter((part) => {
    const key = normalizeFoodName(part.food.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { name: parts.length > 0 ? combinedMealName(names.map((part) => part.food)) : '', ingredients };
}

/** A logged food that is itself a saved meal (logged from Saved), so saving it again adds nothing. */
export function isSavedMealFood(food: Pick<Food, 'source'> | null | undefined): boolean {
  return Boolean(food && SAVED_SOURCES.includes(food.source));
}

/**
 * Whether "Save as meal" has something to offer: some food to save, other
 * than a single saved meal that is already on the list.
 */
export function canSaveAsMeal(entries: readonly LoggedFood[]): boolean {
  const foods = entries.filter((entry) => entry.food && amountOf(entry) > 0);
  if (foods.length === 0) return false;
  return !(foods.length === 1 && isSavedMealFood(foods[0].food));
}

/**
 * The saved meal a new one with this name replaces: saved meals are one per
 * name (case and spacing ignored), so saving under a taken name takes its
 * place. `exceptId` is the new meal itself, once a save has written it.
 */
export function savedMealNamed<T extends { id: string; name: string }>(
  meals: readonly T[] | null | undefined,
  name: string,
  exceptId?: string,
): T | undefined {
  const key = normalizeFoodName(name);
  if (!key) return undefined;
  return (meals ?? []).find((meal) => meal.id !== exceptId && normalizeFoodName(meal.name) === key);
}
