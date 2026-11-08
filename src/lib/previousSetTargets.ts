import { supabase } from '@/lib/supabase';
import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { parseWorkoutNotes } from '@/lib/workoutNotes';
import { toFiniteNumber, type PreviousSetSummary, type PreviousWorkoutSummary } from '@/lib/workoutProgress';
import type { WorkoutSet } from '@/types';

/**
 * Stable key for the session's unique exercise ids. The "last time" lookup
 * excludes the current workout, so only this list (not set values or order)
 * can change its result. Exercise ids are UUIDs, so a comma join is safe.
 */
export function previousTargetExerciseKey(sets: ReadonlyArray<Pick<WorkoutSet, 'exercise_id'>>): string {
  return Array.from(new Set(sets.map((set) => set.exercise_id))).sort().join(',');
}

export function exerciseIdsFromKey(key: string): string[] {
  return key ? key.split(',') : [];
}

/**
 * Changes when a set is added, removed, completed or un-completed. Train uses
 * it to retry a failed "last time" lookup on the next set log.
 */
export function previousTargetRetrySignal(sets: ReadonlyArray<Pick<WorkoutSet, 'completed'>>): string {
  let completed = 0;
  for (const set of sets) {
    if (set.completed) completed += 1;
  }
  return `${sets.length}:${completed}`;
}

/** Keeps the newest logged target for each movement's 1-based set position. */
export function buildPreviousSetTargets(workoutIds: string[], previousSets: PreviousSetSummary[]): PreviousWorkoutSetMap {
  const workoutRank = new Map(workoutIds.map((id, index) => [id, index]));
  const movements = new Map<string, PreviousSetSummary[]>();
  for (const set of previousSets) {
    if (!Number.isFinite(Number(set.set_number))) continue;
    const key = `${set.workout_id}:${set.exercise_id}`;
    const sets = movements.get(key) ?? [];
    sets.push(set);
    movements.set(key, sets);
  }
  const groupedTargets: PreviousWorkoutSetMap = {};
  const orderedMovements = [...movements.values()].sort((a, b) =>
    (workoutRank.get(a[0].workout_id) ?? Number.MAX_SAFE_INTEGER)
      - (workoutRank.get(b[0].workout_id) ?? Number.MAX_SAFE_INTEGER));
  for (const sets of orderedMovements) {
    // Superset swaps can start at round 2 or later; that is still this
    // movement's first set. Keep unlogged slots in the count, but never use
    // their values as targets. Never renumber the saved rows themselves.
    sets.sort((a, b) => Number(a.set_number) - Number(b.set_number));
    let position = 0;
    let previousNumber: number | undefined;
    for (const set of sets) {
      const number = Number(set.set_number);
      if (number !== previousNumber) position += 1;
      previousNumber = number;
      if (set.completed === false) continue;
      const targets = groupedTargets[set.exercise_id] ??= {};
      targets[position] ??= {
        weight: toFiniteNumber(set.weight),
        reps: toFiniteNumber(set.reps),
        rpe: toFiniteNumber(set.rpe),
      };
    }
  }
  return groupedTargets;
}

/**
 * "Target to beat" for each set: completed sets from the last 30 workouts on
 * or before `date`, excluding the current one. History supplies a strict
 * `beforeCreatedAt` cutoff; null means the start is unknown, so only earlier
 * dates are safe. Returns `null` on a query error, versus no history (`{}`).
 */
export async function fetchPreviousSetTargets({ userId, workoutId, date, beforeCreatedAt, exerciseIds }: {
  userId: string;
  workoutId: string;
  date: string;
  beforeCreatedAt?: string | null;
  exerciseIds: string[];
}): Promise<PreviousWorkoutSetMap | null> {
  let query = supabase
    .from('workouts')
    .select('id')
    .eq('user_id', userId)
    .lte('date', date)
    .neq('id', workoutId);
  if (beforeCreatedAt === null) query = query.lt('date', date);
  else if (beforeCreatedAt !== undefined) query = query.lt('created_at', beforeCreatedAt);
  const { data: completedWorkouts, error: workoutsError } = await query
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(30);

  if (workoutsError) {
    console.error('Error loading previous workouts for target-to-beat:', workoutsError);
    return null;
  }

  const workoutIds = (completedWorkouts || []).map((workout) => (workout as PreviousWorkoutSummary).id);

  if (workoutIds.length === 0) return {};

  // A page at a time in a fixed order: one request returns at most
  // PREVIOUS_SETS_PAGE_SIZE rows, and a cut-off reply could drop last time's sets.
  const previousSets: PreviousSetSummary[] = [];
  for (let offset = 0; ; offset += PREVIOUS_SETS_PAGE_SIZE) {
    const { data, error: previousSetsError } = await supabase
      .from('sets')
      .select('workout_id, exercise_id, set_number, weight, reps, rpe, completed')
      .in('workout_id', workoutIds)
      .in('exercise_id', exerciseIds)
      .order('workout_id', { ascending: true })
      .order('exercise_id', { ascending: true })
      .order('set_number', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PREVIOUS_SETS_PAGE_SIZE - 1);

    if (previousSetsError) {
      console.error('Error loading previous sets for target-to-beat:', previousSetsError);
      return null;
    }
    previousSets.push(...((data || []) as PreviousSetSummary[]));
    if (!data || data.length < PREVIOUS_SETS_PAGE_SIZE) break;
  }

  return buildPreviousSetTargets(workoutIds, previousSets);
}

/** Rows per request for last time's sets: the API's own cap. */
const PREVIOUS_SETS_PAGE_SIZE = 1_000;

export type PreviousMovementNotes = Record<string, { note: string; date: string }>;

/**
 * For each exercise, the note from the most recent earlier workout that has
 * one (`workouts` ordered newest first). Notes live in each workout's notes
 * JSON, keyed by exercise.
 */
export function buildPreviousMovementNotes(
  workouts: ReadonlyArray<{ id: string; date: string; notes: string | null }>,
  exerciseIds: ReadonlyArray<string>,
): PreviousMovementNotes {
  const wanted = new Set(exerciseIds);
  const found: PreviousMovementNotes = {};
  for (const workout of workouts) {
    const { movementNotes } = parseWorkoutNotes(workout.notes);
    for (const [exerciseId, note] of Object.entries(movementNotes)) {
      if (wanted.has(exerciseId) && !found[exerciseId]) found[exerciseId] = { note, date: workout.date };
    }
    if (Object.keys(found).length === wanted.size) break;
  }
  return found;
}

/**
 * Last time's note for each movement: from the last 30 workouts on or before
 * `date`, excluding the current one. Null on a query error.
 */
export async function fetchPreviousMovementNotes({ userId, workoutId, date, exerciseIds }: {
  userId: string;
  workoutId: string;
  date: string;
  exerciseIds: string[];
}): Promise<PreviousMovementNotes | null> {
  const { data, error } = await supabase
    .from('workouts')
    .select('id, date, notes, created_at')
    .eq('user_id', userId)
    .lte('date', date)
    .neq('id', workoutId)
    .not('notes', 'is', null)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return null;
  return buildPreviousMovementNotes((data ?? []) as { id: string; date: string; notes: string | null }[], exerciseIds);
}
