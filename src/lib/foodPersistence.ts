import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import { shouldDropColumn } from '@/lib/foodLoggerUtils';
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

/**
 * The foods row a chosen food logs against, found or created per source.
 * Returns null when it could not be saved.
 *
 * - USDA: reuse a row only when its fdc_id and serving basis (default 100 g)
 *   both match, otherwise insert a shared row. Existing rows are never changed,
 *   because past logs point at them.
 * - Open Food Facts / FatSecret: the user's row for that product identity.
 * - custom / saved_meal / manual_entry: reuse by id; a temporary id ('' or
 *   photo-…) inserts a new row for the user.
 * - Anything else already has a row: its id is returned as is.
 */
export async function ensureFoodRow(food: Food): Promise<string | null> {
  let foodId = food.id;

  if (food.source === 'usda' && food.fdc_id) {
    const servingSize = food.serving_size || 100;
    const servingUnit = food.serving_unit || 'g';

    // Match on the serving basis too: a food cached before portions existed has a
    // 100 g basis and is tied to historical logs. Reuse only a same-basis row;
    // otherwise insert a new one. Never mutate existing rows.
    const { data: existingFood, error: lookupError } = await supabase
      .from('foods')
      .select('id')
      .eq('fdc_id', food.fdc_id)
      .eq('serving_size', servingSize)
      .eq('serving_unit', servingUnit)
      .limit(1)
      .maybeSingle();

    if (lookupError) console.error('Error looking up food:', lookupError);

    if (existingFood) {
      foodId = existingFood.id;
    } else {
      const { data: newFood, error: insertError } = await supabase
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

      if (insertError) {
        console.error('Error creating food:', insertError);
        return null;
      }
      if (newFood) foodId = newFood.id;
    }
  }

  if ((food.source === 'open_food_facts' || food.source === 'fatsecret') && food.external_id) {
    const userId = await getSessionUserId();
    if (!userId) {
      console.error('No user found while saving barcode food');
      return null;
    }
    return persistExternalFood({ ...food, external_id: food.external_id }, userId, food.source);
  }

  if (food.source === 'custom' || food.source === 'saved_meal' || food.source === 'manual_entry') {
    const hasTemporaryId = !food.id || food.id.startsWith('photo-');

    if (!hasTemporaryId) {
      const { data: existingCustomFood, error: customLookupError } = await supabase
        .from('foods')
        .select('id')
        .eq('id', food.id)
        .maybeSingle();

      if (customLookupError) console.error('Error looking up custom food:', customLookupError);
      if (existingCustomFood) return existingCustomFood.id;
    }

    const userId = await getSessionUserId();
    if (!userId) {
      console.error('No user found while creating custom food');
      return null;
    }

    const customPayload = {
      user_id: userId,
      name: food.name,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      source: food.source,
      ...(food.description ? { description: food.description } : {}),
    };

    let { data: newCustomFood, error: customInsertError } = await supabase
      .from('foods')
      .insert({
        ...customPayload,
        serving_size: food.serving_size || 1,
        serving_unit: food.serving_unit || 'serving',
      })
      .select('id')
      .single();

    if (customInsertError && shouldDropColumn(customInsertError, 'serving_size')) {
      ({ data: newCustomFood, error: customInsertError } = await supabase
        .from('foods')
        .insert(customPayload)
        .select('id')
        .single());
    }

    if (customInsertError || !newCustomFood) {
      console.error('Error creating custom food:', customInsertError);
      return null;
    }
    foodId = newCustomFood.id;
  }

  return foodId;
}
