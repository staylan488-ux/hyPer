import { startOfWeek, subWeeks } from 'date-fns';

import { getSessionUserId } from '@/lib/sessionUser';
import { supabase } from '@/lib/supabase';
import { buildWeeklyTrainingHours, TRAINING_WEEK, type TrainingHoursPoint } from '@/lib/workoutSessions';

/**
 * The last eight training weeks of finished-workout time; empty weeks when
 * nobody is signed in. A failed read gives null, so a screen keeps what it
 * shows instead of drawing eight weeks of nothing.
 */
export async function fetchTrainingHours(): Promise<TrainingHoursPoint[] | null> {
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
      return null;
    }
    return buildWeeklyTrainingHours((workouts || []) as Array<{ date: string; completed: boolean; completed_at: string | null; created_at: string }>);
  } catch (error) {
    console.error('Error fetching training hours:', error);
    return null;
  }
}
