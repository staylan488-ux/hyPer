import { startOfWeek, subWeeks } from 'date-fns';

import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';
import { buildWeeklyTrainingHours, TRAINING_WEEK, type TrainingHoursPoint } from '@/lib/workoutSessions';

/**
 * The last eight training weeks of finished-workout time. A failed read, or
 * nobody signed in, gives empty weeks.
 */
export async function fetchTrainingHours(): Promise<TrainingHoursPoint[]> {
  try {
    const userId = await getSessionUserId();
    if (!userId) return buildWeeklyTrainingHours([]);
    const from = startOfWeek(subWeeks(new Date(), 7), TRAINING_WEEK).toISOString();
    const { data: workouts, error } = await supabase
      .from('workouts')
      .select('date, completed, completed_at, created_at')
      .eq('user_id', userId)
      .eq('completed', true)
      .gte('created_at', from)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Error fetching training hours:', error);
      return buildWeeklyTrainingHours([]);
    }
    return buildWeeklyTrainingHours((workouts || []) as Array<{ date: string; completed: boolean; completed_at: string | null; created_at: string }>);
  } catch (error) {
    console.error('Error fetching training hours:', error);
    return buildWeeklyTrainingHours([]);
  }
}
