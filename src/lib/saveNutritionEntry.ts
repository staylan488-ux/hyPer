import { format } from 'date-fns';
import { buildLoggedAt } from '@/lib/foodLoggerUtils';
import { legacyMealTypeForGroup } from '@/lib/nutritionGroups';
import { supabase } from '@/lib/supabase';
import type { Food, NutritionGroup } from '@/types';

export type NutritionEntryPayload = {
  food_id: string;
  servings: number;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
  group_id: string | null;
  source: string;
  date: string;
  logged_at: string;
};

/** Save the complete entry, or fail without silently discarding its fields. */
export async function persistNutritionEntry(
  payload: NutritionEntryPayload,
  entryId?: string,
  retryEntryId?: string,
  expectedUserId?: string,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No user found');
  if (expectedUserId !== undefined && user.id !== expectedUserId) {
    throw new Error('Your account changed. Reopen this meal before saving.');
  }

  const { error } = entryId
    ? await supabase.from('nutrition_logs')
      .update(payload)
      .eq('id', entryId)
      .eq('user_id', user.id)
    : retryEntryId
      ? await supabase.from('nutrition_logs')
        .upsert({ id: retryEntryId, user_id: user.id, ...payload }, { onConflict: 'id' })
      : await supabase.from('nutrition_logs')
        .insert({ user_id: user.id, ...payload });

  if (error) throw error;
}

/**
 * The row a food entry saves: the local day chosen for it, that day plus the
 * chosen time as an instant, and the group with its mirrored legacy meal name
 * (null for custom groups or Unassigned). Never falls back to an entry's old
 * meal_type: that made the tag impossible to clear.
 */
export function buildEntryPayload(input: {
  foodId: string;
  servings: number;
  source: string;
  entryDate: Date;
  time: string;
  group: NutritionGroup | null;
}): NutritionEntryPayload {
  return {
    food_id: input.foodId,
    servings: input.servings,
    meal_type: legacyMealTypeForGroup(input.group),
    group_id: input.group?.id ?? null,
    source: input.source,
    date: format(input.entryDate, 'yyyy-MM-dd'),
    logged_at: buildLoggedAt(input.entryDate, input.time),
  };
}

export type BarcodeProvider = 'usda' | 'open_food_facts' | 'saved' | 'fatsecret';

/** The log source for a food chosen from a list, a search or a barcode scan. */
export function chosenFoodLogSource(food: Pick<Food, 'source'>, barcodeProvider?: BarcodeProvider | null): string {
  if (barcodeProvider === 'open_food_facts') return 'barcode_open_food_facts';
  if (barcodeProvider === 'saved') return 'barcode_saved';
  if (barcodeProvider === 'fatsecret') return 'barcode_fatsecret';
  if (barcodeProvider === 'usda') return 'barcode';
  return food.source === 'usda' ? 'usda' : 'manual';
}
