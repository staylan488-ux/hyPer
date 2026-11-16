import { supabase } from '@/lib/supabase';
import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import type { MovementHistoryMap, PastSession } from '@/lib/setTargets';
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
 * Each movement's recent sessions, newest first, with its sets by the
 * movement's own set position (the same counting as buildPreviousSetTargets).
 * An unlogged slot is null. `workouts` is newest first. Sessions with nothing
 * logged on the movement are left out.
 */
export function buildMovementHistory(
  workouts: ReadonlyArray<{ id: string; date: string }>,
  previousSets: PreviousSetSummary[],
): MovementHistoryMap {
  const byMovement = new Map<string, PreviousSetSummary[]>();
  for (const set of previousSets) {
    if (!Number.isFinite(Number(set.set_number))) continue;
    const key = `${set.workout_id}:${set.exercise_id}`;
    const sets = byMovement.get(key) ?? [];
    sets.push(set);
    byMovement.set(key, sets);
  }
  const history: MovementHistoryMap = {};
  for (const workout of workouts) {
    for (const [key, sets] of byMovement) {
      if (!key.startsWith(`${workout.id}:`)) continue;
      sets.sort((a, b) => Number(a.set_number) - Number(b.set_number));
      const slots: PastSession['sets'][number][] = [];
      let previousNumber: number | undefined;
      let logged = false;
      for (const set of sets) {
        const number = Number(set.set_number);
        if (number === previousNumber) {
          // Two rows on one slot: keep the logged one.
          if (set.completed !== false && slots[slots.length - 1] === null) {
            slots[slots.length - 1] = { weight: toFiniteNumber(set.weight), reps: toFiniteNumber(set.reps), rpe: toFiniteNumber(set.rpe) };
            logged = true;
          }
          continue;
        }
        previousNumber = number;
        if (set.completed === false) {
          slots.push(null);
          continue;
        }
        slots.push({ weight: toFiniteNumber(set.weight), reps: toFiniteNumber(set.reps), rpe: toFiniteNumber(set.rpe) });
        logged = true;
      }
      if (!logged) continue;
      (history[sets[0].exercise_id] ??= []).push({ workoutId: workout.id, date: workout.date, sets: slots });
    }
  }
  return history;
}

/**
 * "Target to beat" for each set: completed sets from the last 30 workouts on
 * or before `date`, excluding the current one. History supplies a strict
 * `beforeCreatedAt` cutoff; null means the start is unknown, so only earlier
 * dates are safe. Returns `null` on a query error, versus no history (`{}`).
 */
export async function fetchPreviousSetTargets(input: PreviousTrainingQuery): Promise<PreviousWorkoutSetMap | null> {
  return (await fetchPreviousTraining(input))?.targets ?? null;
}

type PreviousTrainingQuery = {
  userId: string;
  workoutId: string;
  date: string;
  beforeCreatedAt?: string | null;
  exerciseIds: string[];
};

export type PreviousTraining = {
  /** Last time's numbers per set: "last 100", Beat last time. */
  targets: PreviousWorkoutSetMap;
  /** Each movement's sessions from the same read, newest first, for set targets. */
  history: MovementHistoryMap;
};

/**
 * The same read, keeping every session it found per movement as well as the
 * newest set per position. Null on a query error.
 */
export async function fetchPreviousTraining({ userId, workoutId, date, beforeCreatedAt, exerciseIds }: PreviousTrainingQuery): Promise<PreviousTraining | null> {
  let query = supabase
    .from('workouts')
    .select('id, date')
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

  const workouts = (completedWorkouts || []) as Array<PreviousWorkoutSummary & { date: string }>;
  const workoutIds = workouts.map((workout) => workout.id);

  if (workoutIds.length === 0) return { targets: {}, history: {} };

  // A page at a time, because one request returns at most
  // PREVIOUS_SETS_PAGE_SIZE rows and a cut-off reply could drop last time's
  // sets. Each page starts after the last set read (by its id), not at a row
  // count, so a set added or deleted mid-read never shifts another past a page.
  const previousSets: PreviousSetSummary[] = [];
  let after: string | null = null;
  for (;;) {
    let query = supabase
      .from('sets')
      .select('id, workout_id, exercise_id, set_number, weight, reps, rpe, completed')
      .in('workout_id', workoutIds)
      .in('exercise_id', exerciseIds);
    if (after !== null) query = query.gt('id', after);
    const { data, error: previousSetsError } = await query
      .order('id', { ascending: true })
      .limit(PREVIOUS_SETS_PAGE_SIZE);

    if (previousSetsError) {
      console.error('Error loading previous sets for target-to-beat:', previousSetsError);
      return null;
    }
    const page = (data || []) as Array<PreviousSetSummary & { id: string }>;
    previousSets.push(...page);
    if (page.length < PREVIOUS_SETS_PAGE_SIZE) break;
    after = page[page.length - 1].id;
  }

  return { targets: buildPreviousSetTargets(workoutIds, previousSets), history: buildMovementHistory(workouts, previousSets) };
}

/** Rows per request for last time's sets: the API's own cap. */
const PREVIOUS_SETS_PAGE_SIZE = 1_000;

export type PreviousMovementNotes = Record<string, { note: string; date: string; workoutId: string }>;

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
      if (wanted.has(exerciseId) && !found[exerciseId]) found[exerciseId] = { note, date: workout.date, workoutId: workout.id };
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
