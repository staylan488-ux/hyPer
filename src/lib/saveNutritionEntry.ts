import { supabase } from '@/lib/supabase';

type NutritionEntryPayload = {
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
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No user found');

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
