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
  // As the store's weekly volume counts it: finished sets, whether or not their workout was closed.
  // Every set of the week's workouts is read and the unfinished ones left out in the count, so
  // the sample account's backend, which cannot filter on an embedded row, answers the same.
  const { data, error } = await supabase
    .from('workouts')
    .select('id, sets(completed, exercise:exercises(muscle_group, muscle_group_secondary))')
    .eq('user_id', userId)
    .neq('id', workoutId)
    .gte('date', weekStart)
    .lte('date', weekEnd);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as unknown as Array<{ sets: WeeklyVolumeWorkoutRow['sets'] | null }>).map((row) => ({
    sets: (row.sets ?? []).map((set) => ({ completed: Boolean(set.completed), exercise: set.exercise })),
  }));
  return volumeSets(computeWeeklyVolume(rows));
}
