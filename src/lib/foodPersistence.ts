import { supabase } from '@/lib/supabase';
import { shouldDropColumn } from '@/components/nutrition/foodLoggerUtils';
import type { Food } from '@/types';

export type OneServingFoodValues = { name: string; calories: number; protein: number; carbs: number; fat: number };

/**
 * Inserts a food whose macros describe one serving (a saved meal or a one-off
 * manual entry) and returns its id, or null with the error when it fails.
 */
export async function insertOneServingFood(
  userId: string,
  values: OneServingFoodValues,
  source: 'saved_meal' | 'manual_entry',
): Promise<{ id: string | null; error: unknown }> {
  const payload = {
    user_id: userId,
    name: values.name,
    calories: values.calories,
    protein: values.protein,
    carbs: values.carbs,
    fat: values.fat,
    source,
  };

  let { data, error } = await supabase
    .from('foods')
    .insert({
      ...payload,
      serving_size: 1,
      serving_unit: 'serving',
    })
    .select('id')
    .single();

  // older databases had no serving columns; schema.sql has them now, so this
  // stays until production is confirmed to match
  if (error && shouldDropColumn(error, 'serving_size')) {
    ({ data, error } = await supabase
      .from('foods')
      .insert(payload)
      .select('id')
      .single());
  }

  if (error || !data) return { id: null, error };
  return { id: data.id as string, error: null };
}

type ExternalFoodSource = 'open_food_facts' | 'fatsecret';

const EXTERNAL_SOURCE_LABEL: Record<ExternalFoodSource, string> = {
  open_food_facts: 'Open Food Facts',
  fatsecret: 'FatSecret',
};

export type ExternalFood = Pick<Food, 'name' | 'calories' | 'protein' | 'carbs' | 'fat' | 'serving_size' | 'serving_unit'>
  & { external_id: string };

/**
 * Returns the user's foods row for a barcode-provider food, creating it on the
 * first log so later logs of the same product reuse one row.
 */
export async function persistExternalFood(
  food: ExternalFood,
  userId: string,
  source: ExternalFoodSource,
): Promise<string | null> {
  const label = EXTERNAL_SOURCE_LABEL[source];

  const { data: existingFood, error: lookupError } = await supabase
    .from('foods')
    .select('id')
    .eq('user_id', userId)
    .eq('external_source', source)
    .eq('external_id', food.external_id)
    .limit(1)
    .maybeSingle();

  if (lookupError) console.error(`Error looking up ${label} food:`, lookupError);
  if (existingFood) return existingFood.id;

  const { data: newFood, error: insertError } = await supabase
    .from('foods')
    .insert({
      user_id: userId,
      name: food.name,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      serving_size: food.serving_size || 1,
      serving_unit: food.serving_unit || 'serving',
      source,
      fdc_id: null,
      external_source: source,
      external_id: food.external_id,
    })
    .select('id')
    .single();

  if (insertError || !newFood) {
    console.error(`Error creating ${label} food:`, insertError);
    return null;
  }
  return newFood.id;
}
