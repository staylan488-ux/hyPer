// One movement's history across every finished workout: its sessions, its
// records and the line that says whether it is going up. Also the records a
// finished session broke. Pure rules plus one paged read; the native app
// draws them (Train's movement page and Session complete).
import { supabase } from '@/lib/supabase';
import { calculateE1RM, toFiniteNumber } from '@/lib/workoutProgress';
import { getWorkoutStartDateKey } from '@/lib/workoutSessions';

/** A logged set as the read returns it, with the workout it belongs to. */
export interface MovementSetRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  set_number: number;
  weight: number | string | null;
  reps: number | string | null;
  completed?: boolean | null;
  completed_at?: string | null;
  workout?: { date: string; created_at?: string | null; completed?: boolean | null } | null;
}

/** A set's numbers. Weight 0 is bodyweight. */
export interface SetFigures {
  weight: number;
  reps: number;
}

/** A set on the day it was done (yyyy-MM-dd, the day the workout started). */
export interface DatedSet extends SetFigures {
  day: string;
  workoutId: string;
}

export interface MovementSession {
  workoutId: string;
  day: string;
  /** When the workout started, for ordering two on one day. */
  startedAt: string | null;
  /** Every logged set, in set order, zeros included. */
  sets: SetFigures[];
  /** The session's best loaded set by estimated max, if it had one. */
  topLoad: SetFigures | null;
  /** Its estimated max, in the logged unit. */
  estMax: number | null;
  /** The session's most reps in one bodyweight set. */
  topReps: SetFigures | null;
}

export interface MovementRecords {
  /** The highest estimated max, and the set that made it. */
  estMax: (DatedSet & { value: number }) | null;
  /** The heaviest load lifted for at least one rep (more reps on a tie). */
  heaviest: DatedSet | null;
  /** The most reps in one bodyweight set. */
  mostReps: DatedSet | null;
}

/**
 * What the movement is measured by: `load` when most sessions moved a load,
 * `reps` for bodyweight work (Alex's calisthenics), which has no load to
 * estimate a max from.
 */
export type MovementMode = 'load' | 'reps';

export interface TrendPoint {
  day: string;
  workoutId: string;
  value: number;
  set: SetFigures;
}

export interface MovementHistory {
  /** Newest first. */
  sessions: MovementSession[];
  records: MovementRecords;
  mode: MovementMode;
  /** Oldest first: each session's estimated max (load) or most reps (reps), sessions without one left out. */
  trend: TrendPoint[];
}

const WEIGHT_TOLERANCE = 0.01;
// Rounding in the estimate is not a record.
const MAX_TOLERANCE = 0.25;

/** A set that moved a load: some weight, at least one rep. */
export const isLoadSet = (set: SetFigures) => set.weight > 0 && set.reps >= 1;
/** A bodyweight set with at least one rep. A 0 × 0 set (a hold, a miss) counts for neither. */
export const isBodyweightSet = (set: SetFigures) => set.weight === 0 && set.reps >= 1;

/**
 * The estimated one-rep max: the shared estimate, except that a single rep
 * is its own weight (225 × 1 reads 225, not 232).
 */
export function estimatedMax(set: SetFigures): number | null {
  if (!isLoadSet(set)) return null;
  if (set.reps === 1) return set.weight;
  return calculateE1RM(set.weight, set.reps);
}

/** A row's numbers, or null when its reps were never entered. A missing weight is bodyweight. */
export function setFigures(row: Pick<MovementSetRow, 'weight' | 'reps'>): SetFigures | null {
  const reps = toFiniteNumber(row.reps);
  if (reps === null || reps < 0) return null;
  const weight = toFiniteNumber(row.weight) ?? 0;
  if (weight < 0) return null;
  return { weight, reps };
}

/** The better of two loaded sets: the higher estimated max, then the heavier. */
function betterLoad(a: SetFigures, b: SetFigures): boolean {
  const difference = (estimatedMax(a) ?? 0) - (estimatedMax(b) ?? 0);
  if (Math.abs(difference) > 1e-9) return difference > 0;
  return a.weight > b.weight;
}

/** The best set of a session's sets: its top load, its most bodyweight reps, and the estimated max. */
export function sessionBests(sets: SetFigures[]): Pick<MovementSession, 'topLoad' | 'estMax' | 'topReps'> {
  let topLoad: SetFigures | null = null;
  let topReps: SetFigures | null = null;
  for (const set of sets) {
    if (isLoadSet(set) && (!topLoad || betterLoad(set, topLoad))) topLoad = set;
    if (isBodyweightSet(set) && (!topReps || set.reps > topReps.reps)) topReps = set;
  }
  return { topLoad, estMax: topLoad ? estimatedMax(topLoad) : null, topReps };
}

/** The heaviest loaded set (more reps on a tie). */
function heaviestOf(sets: SetFigures[]): SetFigures | null {
  let best: SetFigures | null = null;
  for (const set of sets) {
    if (!isLoadSet(set)) continue;
    if (!best || set.weight > best.weight + WEIGHT_TOLERANCE || (Math.abs(set.weight - best.weight) <= WEIGHT_TOLERANCE && set.reps > best.reps)) best = set;
  }
  return best;
}

/**
 * Groups one movement's logged sets into sessions (finished workouts only,
 * leaving out `excludeWorkoutId`), newest first, with its records and trend.
 * A record belongs to the first session that reached it.
 */
export function buildMovementHistory(rows: MovementSetRow[], options: { excludeWorkoutId?: string | null } = {}): MovementHistory {
  const byWorkout = new Map<string, { row: MovementSetRow; sets: Array<{ number: number; figures: SetFigures }> }>();
  for (const row of rows) {
    if (!row.workout || row.workout.completed !== true) continue;
    if (row.completed === false) continue;
    if (options.excludeWorkoutId && row.workout_id === options.excludeWorkoutId) continue;
    const figures = setFigures(row);
    if (!figures) continue;
    const entry = byWorkout.get(row.workout_id) ?? { row, sets: [] };
    entry.sets.push({ number: Number(row.set_number) || 0, figures });
    byWorkout.set(row.workout_id, entry);
  }

  const sessions: MovementSession[] = [...byWorkout.entries()].map(([workoutId, { row, sets }]) => {
    const ordered = sets.sort((a, b) => a.number - b.number).map((set) => set.figures);
    const workout = row.workout!;
    return {
      workoutId,
      day: getWorkoutStartDateKey({ created_at: workout.created_at ?? undefined, date: workout.date }) || workout.date,
      startedAt: workout.created_at ?? null,
      sets: ordered,
      ...sessionBests(ordered),
    };
  });
  // Newest first: by day, then by start within a day.
  sessions.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? 1 : -1) : (b.startedAt ?? '').localeCompare(a.startedAt ?? '')));

  // Records from the oldest session forward, so a tie stays with the first to reach it.
  const records: MovementRecords = { estMax: null, heaviest: null, mostReps: null };
  for (const session of [...sessions].reverse()) {
    const dated = (set: SetFigures): DatedSet => ({ ...set, day: session.day, workoutId: session.workoutId });
    if (session.topLoad && session.estMax !== null && (!records.estMax || session.estMax > records.estMax.value + MAX_TOLERANCE)) {
      records.estMax = { ...dated(session.topLoad), value: session.estMax };
    }
    const heaviest = heaviestOf(session.sets);
    if (
      heaviest &&
      (!records.heaviest ||
        heaviest.weight > records.heaviest.weight + WEIGHT_TOLERANCE ||
        (Math.abs(heaviest.weight - records.heaviest.weight) <= WEIGHT_TOLERANCE && heaviest.reps > records.heaviest.reps))
    ) {
      records.heaviest = dated(heaviest);
    }
    if (session.topReps && (!records.mostReps || session.topReps.reps > records.mostReps.reps)) records.mostReps = dated(session.topReps);
  }

  const loadSessions = sessions.filter((session) => session.topLoad).length;
  const repSessions = sessions.filter((session) => !session.topLoad && session.topReps).length;
  const mode: MovementMode = loadSessions > 0 && loadSessions >= repSessions ? 'load' : 'reps';

  const trend: TrendPoint[] = [...sessions].reverse().flatMap((session) => {
    if (mode === 'load') {
      return session.topLoad && session.estMax !== null
        ? [{ day: session.day, workoutId: session.workoutId, value: session.estMax, set: session.topLoad }]
        : [];
    }
    return session.topReps ? [{ day: session.day, workoutId: session.workoutId, value: session.topReps.reps, set: session.topReps }] : [];
  });

  return { sessions, records, mode, trend };
}

export type RecordKind = 'max' | 'heaviest' | 'reps';

export interface NewRecord {
  exerciseId: string;
  name: string;
  kind: RecordKind;
  set: SetFigures;
}

/**
 * The records a session broke, one per movement at most, in session order:
 * a higher estimated max first, else a heavier load, else more bodyweight
 * reps. A movement counts only against history it has: its first session
 * (or its first bodyweight session) breaks nothing. `prior` holds each
 * movement's records before this session; a movement missing from it (not
 * read yet) breaks nothing.
 */
export function findNewRecords(
  sets: ReadonlyArray<{ exercise_id: string; weight: number | string | null; reps: number | string | null; completed?: boolean | null; exercise?: { name?: string | null } | null }>,
  prior: Readonly<Record<string, MovementRecords | undefined>>,
): NewRecord[] {
  const order: string[] = [];
  const byExercise = new Map<string, { name: string; sets: SetFigures[] }>();
  for (const set of sets) {
    if (!set.completed) continue;
    const figures = setFigures(set);
    if (!figures) continue;
    if (!byExercise.has(set.exercise_id)) {
      order.push(set.exercise_id);
      byExercise.set(set.exercise_id, { name: set.exercise?.name || 'Movement', sets: [] });
    }
    byExercise.get(set.exercise_id)!.sets.push(figures);
  }

  return order.flatMap((exerciseId): NewRecord[] => {
    const before = prior[exerciseId];
    if (!before) return [];
    const { name, sets: done } = byExercise.get(exerciseId)!;
    const bests = sessionBests(done);
    if (bests.topLoad && bests.estMax !== null && before.estMax && bests.estMax > before.estMax.value + MAX_TOLERANCE) {
      return [{ exerciseId, name, kind: 'max', set: bests.topLoad }];
    }
    const heaviest = heaviestOf(done);
    if (heaviest && before.heaviest && heaviest.weight > before.heaviest.weight + WEIGHT_TOLERANCE) {
      return [{ exerciseId, name, kind: 'heaviest', set: heaviest }];
    }
    if (bests.topReps && before.mostReps && bests.topReps.reps > before.mostReps.reps) {
      return [{ exerciseId, name, kind: 'reps', set: bests.topReps }];
    }
    return [];
  });
}

/** Rows per request: the API's own cap. */
const PAGE_SIZE = 1_000;

const SELECT = 'id, workout_id, exercise_id, set_number, weight, reps, completed, completed_at, workout:workouts!workout_id(date, created_at, completed)';

/**
 * Every logged set of these movements, with its workout's day and whether it
 * finished, a page at a time (after the last id read, so a set added or
 * deleted mid-read never shifts another past a page). Null when a read fails.
 */
export async function fetchMovementSets(exerciseIds: string[]): Promise<MovementSetRow[] | null> {
  if (exerciseIds.length === 0) return [];
  const rows: MovementSetRow[] = [];
  let after: string | null = null;
  for (;;) {
    let query = supabase.from('sets').select(SELECT).in('exercise_id', exerciseIds).eq('completed', true);
    if (after !== null) query = query.gt('id', after);
    const { data, error } = await query.order('id', { ascending: true }).limit(PAGE_SIZE);
    if (error) {
      console.error('Error loading movement history:', error);
      return null;
    }
    const page = (data || []) as unknown as MovementSetRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    after = page[page.length - 1].id;
  }
}

/** Each movement's records before `workoutId`, from one read of all their sets. Null when the read fails. */
export async function fetchPriorRecords(exerciseIds: string[], workoutId: string): Promise<Record<string, MovementRecords> | null> {
  const rows = await fetchMovementSets(exerciseIds);
  if (!rows) return null;
  const byExercise = new Map<string, MovementSetRow[]>(exerciseIds.map((id) => [id, []]));
  for (const row of rows) byExercise.get(row.exercise_id)?.push(row);
  return Object.fromEntries(
    [...byExercise.entries()].map(([exerciseId, sets]) => [exerciseId, buildMovementHistory(sets, { excludeWorkoutId: workoutId }).records]),
  );
}
