/**
 * The one read behind the Add list's week counts: this training week's
 * finished sets in every workout but the live one, per muscle. The live
 * workout's own sets come from the session, which is always current, so the
 * two together are the week as Progress counts it.
 */
import { trainingWeekRange, computeWeeklyVolume, volumeSets, type WeeklyVolumeWorkoutRow } from '@/lib/weeklyVolume';
import type { MuscleSets } from '@/lib/muscleVolume';
import { supabase } from '@/lib/supabase';

/**
 * Sets per muscle finished this week outside `workoutId`. Throws when the
 * read fails, so a failure never reads as an empty week.
 */
export async function readWeekSetsBesides(userId: string, workoutId: string, now: Date = new Date()): Promise<MuscleSets> {
  const { weekStart, weekEnd } = trainingWeekRange(now);
  // As the store's weekly volume reads it: finished sets count whether or not their workout was closed.
  const { data, error } = await supabase
    .from('workouts')
    .select('id, sets!inner(completed, exercise:exercises(muscle_group, muscle_group_secondary))')
    .eq('user_id', userId)
    .eq('sets.completed', true)
    .neq('id', workoutId)
    .gte('date', weekStart)
    .lte('date', weekEnd);
  if (error) throw new Error(error.message);
  return volumeSets(computeWeeklyVolume((data ?? []) as unknown as WeeklyVolumeWorkoutRow[]));
}
