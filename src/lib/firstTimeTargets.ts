// A movement with nothing in the recent history the set targets read: either
// it was last trained longer ago than that read reaches, or it has never been
// trained. One wider read settles which (fetchMovementSets, every logged set
// of the movement and of its close relatives), and this file turns the rows
// into what the targets need:
//   - the movement's own older sessions, so the usual rule eases it back in;
//   - or, for a true first time, a light start from a close relative the
//     person has trained lately, when there is one.
// Pure. What the choices rest on is in docs/set-targets.md, "The first time".
import { movementProfile, type EquipmentKind, type MovementProfile } from '@/lib/movementProfiles';
import type { MovementSetRow } from '@/lib/movementHistory';
import {
  daysBetween,
  learnWeightStep,
  sessionWorkingSet,
  type FirstTimeStart,
  type MovementHistoryMap,
  type PastSession,
  type RepRange,
} from '@/lib/setTargets';
import { toFiniteNumber } from '@/lib/workoutProgress';
import type { Exercise } from '@/types';

type Named = Pick<Exercise, 'id' | 'name' | 'equipment'>;

/**
 * The share of a relative's weight a first session starts on. Variants of one
 * movement on the same equipment differ by up to about a fifth (a front squat
 * against a back squat, a rope pushdown against a bar), and a first set that
 * is too heavy is the costly mistake: too light costs one set, and set 2
 * corrects it. A judgment; no study gives the figure.
 */
export const RELATIVE_START_SHARE = 0.75;

/** A relative last trained longer ago than this says too little about today (the layoff in src/lib/setTargets). */
export const RELATIVE_MAX_AGE_DAYS = 84;

/**
 * Equipment whose weights carry from one movement to its variant: the same
 * bar, dumbbells or cable stack. A machine's number belongs to that machine
 * (its levers and its stack), so a leg press says nothing about a hack squat.
 */
const CARRIES: ReadonlySet<EquipmentKind> = new Set(['barbell', 'dumbbell', 'kettlebell', 'cable', 'smith']);

/**
 * Variants done far lighter than their pattern's main lifts, or with one arm
 * where the name does not say so (a Bayesian curl): never started from a
 * relative. The list errs wide; a name on it only loses the head start.
 */
const MUCH_LIGHTER = /\b(good morning|pull through|overhead squat|zercher|jefferson|snatch grip|behind the neck|bayesian|drag|reverse|21s|pause|tempo|deficit)\b/;

const plain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function carries(profile: MovementProfile | null): profile is MovementProfile {
  return Boolean(profile) && CARRIES.has(profile!.equipment) && !profile!.hardToLoad;
}

/**
 * Whether `relative`'s weights say where `exercise` should start: the same
 * movement pattern on the same equipment, both sides or one side alike.
 */
export function isCloseRelative(exercise: Named, relative: Named): boolean {
  if (exercise.id === relative.id) return false;
  const a = movementProfile(exercise);
  const b = movementProfile(relative);
  if (!carries(a) || !carries(b)) return false;
  if (MUCH_LIGHTER.test(plain(exercise.name))) return false;
  return a.pattern === b.pattern && a.equipment === b.equipment && a.unilateral === b.unilateral;
}

/** The library's close relatives of a movement, for the wider read. */
export function closeRelatives<T extends Named>(exercise: Named, library: readonly T[]): T[] {
  return library.filter((candidate) => isCloseRelative(exercise, candidate));
}

/**
 * Each movement's finished sessions before `date`, newest first, from the
 * wider read's rows: sets by the movement's own set position, as the recent
 * read lays them out. The live workout is left out.
 */
export function pastSessionsFromRows(rows: readonly MovementSetRow[], { workoutId, date }: { workoutId: string; date: string }): MovementHistoryMap {
  const groups = new Map<string, { exerciseId: string; workoutId: string; date: string; startedAt: string; sets: MovementSetRow[] }>();
  for (const row of rows) {
    const day = row.workout?.date;
    if (row.workout_id === workoutId || !day || day > date || row.completed === false) continue;
    if (!Number.isFinite(Number(row.set_number))) continue;
    const key = `${row.exercise_id}:${row.workout_id}`;
    const group = groups.get(key) ?? { exerciseId: row.exercise_id, workoutId: row.workout_id, date: day, startedAt: row.workout?.created_at ?? '', sets: [] };
    group.sets.push(row);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => b.date.localeCompare(a.date) || b.startedAt.localeCompare(a.startedAt) || b.workoutId.localeCompare(a.workoutId));
  const history: MovementHistoryMap = {};
  for (const group of ordered) {
    group.sets.sort((a, b) => Number(a.set_number) - Number(b.set_number));
    const sets: PastSession['sets'][number][] = [];
    let previous: number | undefined;
    for (const row of group.sets) {
      const number = Number(row.set_number);
      if (number === previous) continue;
      previous = number;
      sets.push({ weight: toFiniteNumber(row.weight), reps: toFiniteNumber(row.reps) });
    }
    (history[group.exerciseId] ??= []).push({ workoutId: group.workoutId, date: group.date, sets });
  }
  return history;
}

/**
 * Where a first session starts, from the close relative trained most
 * recently: three quarters of its working weight, down to a weight its own
 * history shows it loads, for its first set's reps brought inside the new
 * movement's range. Null with no relative trained in the last twelve weeks,
 * or none that moves a load.
 */
export function startFromRelatives({
  range,
  today,
  relatives,
}: {
  range: RepRange | null;
  today: string;
  relatives: ReadonlyArray<{ exercise: Named; history: readonly PastSession[] }>;
}): (FirstTimeStart & { step: number }) | null {
  let best: { exercise: Named; history: readonly PastSession[]; date: string } | null = null;
  for (const relative of relatives) {
    const latest = relative.history.find((session) => sessionWorkingSet(session) !== null);
    if (!latest) continue;
    const age = daysBetween(latest.date, today);
    if (age === null || age < 0 || age > RELATIVE_MAX_AGE_DAYS) continue;
    if (!best || latest.date > best.date) best = { ...relative, date: latest.date };
  }
  if (!best) return null;
  const working = sessionWorkingSet(best.history.find((session) => sessionWorkingSet(session) !== null)!);
  if (!working || working.weight <= 0) return null;
  const step = learnWeightStep(best.history, best.exercise.equipment);
  const weight = Math.round(Math.floor((working.weight * RELATIVE_START_SHARE) / step + 1e-6) * step * 100) / 100;
  if (weight <= 0) return null;
  const reps = range ? Math.min(range.max, Math.max(range.min, working.reps)) : working.reps;
  return { weight, reps, from: best.exercise.name, step };
}

export type FirstTimeRead = {
  /** Older sessions of the movements themselves, to add to the recent history. */
  history: MovementHistoryMap;
  /** Movements with no session at all, by exercise id: where to start, or null when nothing says. */
  starts: Record<string, (FirstTimeStart & { step: number }) | null>;
};

/**
 * What the wider read says about the movements the recent history has
 * nothing on. `ranges` holds each movement's rep range, where it has one.
 */
export function readFirstTimes({
  movements,
  library,
  rows,
  workoutId,
  date,
  ranges = {},
}: {
  movements: readonly Named[];
  library: readonly Named[];
  rows: readonly MovementSetRow[];
  workoutId: string;
  date: string;
  ranges?: Readonly<Record<string, RepRange | null | undefined>>;
}): FirstTimeRead {
  const sessions = pastSessionsFromRows(rows, { workoutId, date });
  const read: FirstTimeRead = { history: {}, starts: {} };
  for (const movement of movements) {
    const own = sessions[movement.id];
    if (own && own.length > 0) {
      read.history[movement.id] = own;
      continue;
    }
    const relatives = closeRelatives(movement, library).flatMap((exercise) => {
      const history = sessions[exercise.id];
      return history && history.length > 0 ? [{ exercise, history }] : [];
    });
    read.starts[movement.id] = startFromRelatives({ range: ranges[movement.id] ?? null, today: date, relatives });
  }
  return read;
}
