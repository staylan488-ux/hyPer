/**
 * The one read behind the usual week: finished workouts of the 8 training
 * weeks before this one, with their finished sets' muscles. Progress makes it
 * once when it opens; it never goes into the launch copy.
 */
import { format, parseISO, subWeeks } from 'date-fns';

import { USUAL_WEEK, trainingWeekStart, usualWeek, type UsualWeek, type VolumeSession } from '@/lib/muscleVolume';
import { supabase } from '@/lib/supabase';

type Row = {
  date: string;
  completed: boolean | null;
  split_day_id: string | null;
  sets: Array<{ completed: boolean | null; exercise: { muscle_group: string; muscle_group_secondary: string | null } | null }> | null;
};

/** The weeks the read covers: from 8 Mondays back up to the day before this week's. */
export function usualWeekSpan(dayKey: string): { from: string; before: string } {
  const before = trainingWeekStart(dayKey);
  return { from: format(subWeeks(parseISO(before), USUAL_WEEK.lookbackWeeks), 'yyyy-MM-dd'), before };
}

/**
 * The usual week for an account as of `dayKey`, or null when there is none
 * yet. Throws when the read fails, so a failure never reads as an empty week.
 */
export async function readUsualWeek(userId: string, dayKey: string): Promise<UsualWeek | null> {
  const span = usualWeekSpan(dayKey);
  const { data, error } = await supabase
    .from('workouts')
    .select('date, completed, split_day_id, sets(completed, exercise:exercises(muscle_group, muscle_group_secondary))')
    .eq('user_id', userId)
    .eq('completed', true)
    .gte('date', span.from)
    .lt('date', span.before);
  if (error) throw new Error(error.message);
  const sessions: VolumeSession[] = ((data ?? []) as unknown as Row[]).map((row) => ({
    date: row.date,
    completed: row.completed !== false,
    split_day_id: row.split_day_id,
    sets: (row.sets ?? []).map((set) => ({ completed: Boolean(set.completed), exercise: set.exercise })),
  }));
  return usualWeek(sessions, dayKey);
}
