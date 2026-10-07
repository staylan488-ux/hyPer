import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import { sumShownMacros } from '@/lib/nutritionMacros';

export interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export const EMPTY_TOTALS: NutritionTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };

/** The parts of Today that belong to one local day. */
export interface TodayDay {
  nutritionTotals: NutritionTotals;
  todayDone: { title: string } | null;
}

/** A remembered TodayDay; todayDone is undefined when it may be out of date. */
export interface TodayDaySnapshot {
  nutritionTotals: NutritionTotals;
  todayDone: TodayDay['todayDone'] | undefined;
}

// The last Today read, so returning to Today shows it while the refresh runs.
// Keyed by account and local day, so another account or a new day misses.
let remembered: { key: string; day: TodayDay; activeWorkoutId: string | null; workoutWriteSeq: number } | null = null;

/**
 * Keeps the day just read, with the live workout it was read alongside and
 * the workout write sequence (getWorkoutWriteSeq) from when the read started.
 */
export function rememberTodayDay(userId: string, dayKey: string, day: TodayDay, activeWorkoutId: string | null, workoutWriteSeq: number) {
  remembered = { key: `${userId}:${dayKey}`, day, activeWorkoutId, workoutWriteSeq };
}

/**
 * The remembered day for this account and local day, or null. Starting,
 * finishing or deleting a workout since then can change whether today is
 * done, so any workout write or a different live workout leaves todayDone
 * unknown until the next read. Starting and then finishing a session has no
 * live workout on either side, which is why the id alone is not enough.
 */
export function recallTodayDay(
  userId: string | null | undefined,
  dayKey: string,
  activeWorkoutId: string | null,
  workoutWriteSeq: number,
): TodayDaySnapshot | null {
  if (!userId || remembered?.key !== `${userId}:${dayKey}`) return null;
  const { day } = remembered;
  const unchanged = remembered.activeWorkoutId === activeWorkoutId && remembered.workoutWriteSeq === workoutWriteSeq;
  return unchanged ? day : { ...day, todayDone: undefined };
}

async function readNutritionTotals(userId: string, day: string): Promise<NutritionTotals> {
  const { data: logs, error } = await fetchNutritionLogsWithFoods<
    { food_id: string; servings: number },
    { id: string; calories: number; protein: number; carbs: number; fat: number }
  >(userId, { from: day, to: day }, 'food_id, servings', 'id, calories, protein, carbs, fat');

  if (error) throw error;
  if (!logs || logs.length === 0) return EMPTY_TOTALS;
  return sumShownMacros(logs);
}

async function readTodayDone(userId: string, day: string): Promise<TodayDay['todayDone']> {
  const { data, error } = await supabase
    .from('workouts')
    .select('id, split_day_id')
    .eq('user_id', userId)
    .eq('date', day)
    .eq('completed', true)
    .limit(1);

  if (error) throw error;
  return data && data.length > 0 ? { title: 'Session complete' } : null;
}

/**
 * Reads the day's food totals and whether a session was completed. Returns
 * null when either could not be read, so a failed refresh (offline, signed
 * out) is never mistaken for an empty day.
 */
export async function readTodayDay(day: string): Promise<TodayDay | null> {
  try {
    const userId = await getSessionUserId();
    if (!userId) return null;

    const [nutritionTotals, todayDone] = await Promise.all([
      readNutritionTotals(userId, day),
      readTodayDone(userId, day),
    ]);
    return { nutritionTotals, todayDone };
  } catch (error) {
    console.error('Error reading Today:', error);
    return null;
  }
}
