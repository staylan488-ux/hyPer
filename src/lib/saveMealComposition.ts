import { buildLoggedAt } from '@/components/nutrition/foodLoggerUtils';
import { encodeMealComposition, getMealTotals, parseMealDraft, type MealDraft } from '@/lib/mealComposition';
import { persistNutritionEntry } from '@/lib/saveNutritionEntry';
import { supabase } from '@/lib/supabase';

interface SaveComposedMealOptions {
  editEntryId?: string;
  editSavedMealId?: string;
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
}

/** Creates a fresh recipe snapshot so edits never rewrite previously logged meals. */
export async function saveComposedMeal(
  draft: MealDraft,
  userId: string,
  options: SaveComposedMealOptions = {},
): Promise<void> {
  const valid = parseMealDraft(draft);
  if (!valid || !valid.name.trim() || !valid.ingredients.length) {
    throw new Error('Add a meal name and valid ingredients before saving.');
  }
  if (options.editEntryId && options.editSavedMealId) {
    throw new Error('Choose either a logged meal or a saved meal to edit.');
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!userId || !user || user.id !== userId) {
    throw new Error('Your account changed. Reopen this meal before saving.');
  }

  const foodId = valid.entryId;
  if (options.editSavedMealId === foodId) {
    throw new Error('Use a new meal identity when editing a saved meal.');
  }
  const { error: foodError } = await supabase.from('foods').upsert({
    id: foodId,
    user_id: userId,
    name: valid.name.trim(),
    ...getMealTotals(valid.ingredients),
    serving_size: 1,
    serving_unit: 'meal',
    source: valid.saveAsReusableMeal || options.editSavedMealId ? 'saved_meal' : 'manual_entry',
    description: encodeMealComposition(valid.ingredients),
  }, { onConflict: 'id' });
  if (foodError) throw foodError;

  if (options.editSavedMealId) {
    // Prior snapshots stay available to their historical logs, outside Saved meals.
    const { error } = await supabase.from('foods')
      .update({ source: 'manual_entry' })
      .eq('id', options.editSavedMealId)
      .eq('user_id', userId);
    if (error) throw error;
    return;
  }

  const [year, month, day] = valid.date.split('-').map(Number);
  await persistNutritionEntry({
    food_id: foodId,
    servings: 1,
    meal_type: options.mealType ?? null,
    group_id: valid.groupId,
    source: 'meal_builder',
    date: valid.date,
    logged_at: buildLoggedAt(new Date(year, month - 1, day), valid.time),
  }, options.editEntryId, valid.entryId, userId);
}
