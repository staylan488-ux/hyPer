import { legacyMealTypeForGroup } from '@/lib/nutritionGroups';
import { supabase } from '@/lib/supabase';

interface MealDestination {
  groupId: string | null;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
}

/** A restored draft's destination must still exist for the same owner and day. */
export async function resolveMealDestination(
  groupId: string | null,
  userId: string,
  date: string,
): Promise<MealDestination> {
  if (!groupId) return { groupId: null, mealType: null };
  const { data: destination, error } = await supabase.from('nutrition_groups')
    .select('*')
    .eq('id', groupId)
    .eq('user_id', userId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return destination
    ? { groupId: destination.id, mealType: legacyMealTypeForGroup(destination) }
    : { groupId: null, mealType: null };
}
