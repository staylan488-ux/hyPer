import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { TRAINING_WEEK } from '@/lib/workoutSessions';

/** The Monday–Sunday training week containing `dayKey` (yyyy-MM-dd). */
export function trainingWeekRange(dayKey: string): { from: string; to: string } {
  const start = startOfWeek(parseISO(dayKey), TRAINING_WEEK);
  return { from: format(start, 'yyyy-MM-dd'), to: format(addDays(start, 6), 'yyyy-MM-dd') };
}

/**
 * Completed workout dates in the training week containing `dayKey`, one entry
 * per completed workout. Read-only; the same columns the Train calendar reads.
 */
export async function readWeekSessionDates(userId: string, dayKey: string): Promise<string[]> {
  const { from, to } = trainingWeekRange(dayKey);
  const { data, error } = await supabase
    .from('workouts')
    .select('id, date, completed')
    .eq('user_id', userId)
    .eq('completed', true)
    .gte('date', from)
    .lte('date', to);
  if (error) throw error;
  return ((data ?? []) as { date: string }[]).map((row) => row.date).sort();
}

/** 0 = Monday … 6 = Sunday. */
export function trainingWeekdayIndex(dayKey: string): number {
  return (parseISO(dayKey).getDay() + 6) % 7;
}
