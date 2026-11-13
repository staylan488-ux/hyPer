/**
 * Weekly sets per muscle, measured against the person's own program.
 *
 * A finished set counts 1 for its movement's main muscle and 0.5 for its
 * second (the "fractional" count that fit the research best). Every count
 * gets one of three bands with the same edges for every muscle; what the
 * edges rest on is in docs/training-volume.md. There is no upper limit: "high" is
 * never a warning.
 *
 * Bands describe a program's design only. A person's own weeks are counted
 * (done of planned, the usual week) but never banded, and nothing here works
 * out how often someone trains.
 */
import { addDays, format, parseISO, startOfWeek, subWeeks } from 'date-fns';

import { plannedDayForDate, type PlanSchedule, type ScheduleWorkout } from '@/lib/planSchedule';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import { TRAINING_WEEK } from '@/lib/workoutSessions';
import { MUSCLE_GROUP_LABELS, type MuscleGroup, type SplitDay, type WorkoutMode } from '@/types';

// ── Muscle names ────────────────────────────────────────────────────

/**
 * Library values counted as another muscle. `shoulders` holds only presses,
 * so it counts with front delts. The rest are values the live library has
 * that the app's own list lacks.
 */
const MUSCLE_ALIASES: Readonly<Record<string, string>> = {
  shoulders: 'front_delts',
  abs: 'core',
  brachialis: 'biceps',
  legs: 'quads',
};

/** The muscle a library value counts as, or null for an empty value. Unknown values pass through. */
export function volumeMuscle(raw: string | null | undefined): string | null {
  const key = raw?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  return MUSCLE_ALIASES[key] ?? key;
}

/** The only muscles a suggestion is ever made for, in the order screens list them on a tie. */
export const MAIN_MUSCLES = ['chest', 'back', 'quads', 'hamstrings', 'glutes', 'side_delts', 'biceps', 'triceps'] as const;
export type MainMuscle = (typeof MAIN_MUSCLES)[number];

export function isMainMuscle(muscle: string): muscle is MainMuscle {
  return (MAIN_MUSCLES as readonly string[]).includes(muscle);
}

/** A readable name for any muscle value, including ones the app has no label for. */
export function muscleLabel(muscle: string): string {
  const known = MUSCLE_GROUP_LABELS[muscle as MuscleGroup];
  if (known) return known;
  const words = muscle.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Other';
}

// ── Bands ───────────────────────────────────────────────────────────

export type VolumeBand = 'low' | 'solid' | 'high';

/**
 * The edges, in fractional sets a week, the same for every muscle. Low is
 * under the smallest dose with detectable growth (4); solid runs to the end
 * of the most efficient tier (10); high is everything past it.
 * docs/training-volume.md gives the sources.
 */
export const VOLUME_BAND_EDGES = { solidFrom: 4, highAbove: 10 } as const;

export const VOLUME_BAND_LABELS: Readonly<Record<VolumeBand, string>> = {
  low: 'Low',
  solid: 'Solid',
  high: 'High',
};

export function volumeBand(sets: number): VolumeBand {
  if (sets < VOLUME_BAND_EDGES.solidFrom) return 'low';
  if (sets > VOLUME_BAND_EDGES.highAbove) return 'high';
  return 'solid';
}

/** A set count for a screen: halves kept, anything finer rounded to the nearest half. */
export function formatSetCount(sets: number): string {
  const rounded = Math.round(sets * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ── Counting ────────────────────────────────────────────────────────

export interface MuscleSource {
  muscle_group: string;
  muscle_group_secondary: string | null;
}

/** Sets per muscle. Keys are `volumeMuscle` values. */
export type MuscleSets = Map<string, number>;

/** Adds `sets` of one movement: all to its main muscle, half to its second. */
export function addMovementSets(into: MuscleSets, exercise: MuscleSource | null | undefined, sets: number): MuscleSets {
  if (!exercise || !(sets > 0)) return into;
  const primary = volumeMuscle(exercise.muscle_group);
  const secondary = volumeMuscle(exercise.muscle_group_secondary);
  if (primary) into.set(primary, (into.get(primary) ?? 0) + sets);
  // A press filed as shoulders with front delts second is still one muscle.
  if (secondary && secondary !== primary) into.set(secondary, (into.get(secondary) ?? 0) + sets * 0.5);
  return into;
}

export function addMuscleSets(into: MuscleSets, from: MuscleSets, times = 1): MuscleSets {
  for (const [muscle, sets] of from) into.set(muscle, (into.get(muscle) ?? 0) + sets * times);
  return into;
}

// ── The program's week ──────────────────────────────────────────────

export interface VolumeProgramExercise {
  exercise: MuscleSource | null | undefined;
  target_sets: number;
  /** A saved program keeps its set range here; the editor's draft has it stripped. */
  notes?: string | null;
}

export interface VolumeProgramDay {
  exercises?: readonly VolumeProgramExercise[] | null;
}

/** The sets a movement is planned for: its target, inside its set range. */
export function plannedMovementSets(exercise: VolumeProgramExercise): number {
  if (!(exercise.target_sets > 0)) return 0;
  return parseSetRangeNotes(exercise.notes ?? null, exercise.target_sets).targetSets;
}

export function dayVolume(day: VolumeProgramDay): MuscleSets {
  const sets: MuscleSets = new Map();
  for (const exercise of day.exercises ?? []) addMovementSets(sets, exercise.exercise, plannedMovementSets(exercise));
  return sets;
}

/** Every day of a program done once. Works on a saved Split and on the editor's DraftSplit. */
export function programVolume(program: { days: readonly VolumeProgramDay[] }): MuscleSets {
  const sets: MuscleSets = new Map();
  for (const day of program.days) addMuscleSets(sets, dayVolume(day));
  return sets;
}

export interface MuscleVolumeRow {
  muscle: string;
  label: string;
  sets: number;
  band: VolumeBand;
  /** Only a main muscle is ever called low or given a suggestion. */
  main: boolean;
}

/**
 * Every counted muscle, plus every main muscle the counts never reach (at 0).
 * Most sets first; ties keep the main muscles' order, then the name.
 */
export function volumeRows(sets: MuscleSets): MuscleVolumeRow[] {
  const muscles = new Set<string>([...MAIN_MUSCLES, ...sets.keys()]);
  const order = (muscle: string) => {
    const index = (MAIN_MUSCLES as readonly string[]).indexOf(muscle);
    return index < 0 ? MAIN_MUSCLES.length : index;
  };
  return [...muscles]
    .map((muscle) => {
      const count = sets.get(muscle) ?? 0;
      return { muscle, label: muscleLabel(muscle), sets: count, band: volumeBand(count), main: isMainMuscle(muscle) };
    })
    .sort((a, b) => b.sets - a.sets || order(a.muscle) - order(b.muscle) || a.label.localeCompare(b.label));
}

/** Main muscles in the low band, fewest sets first. */
export function lowMainMuscles(sets: MuscleSets): MuscleVolumeRow[] {
  return volumeRows(sets)
    .filter((row) => row.main && row.band === 'low')
    .sort((a, b) => a.sets - b.sets || MAIN_MUSCLES.indexOf(a.muscle as MainMuscle) - MAIN_MUSCLES.indexOf(b.muscle as MainMuscle));
}

// ── Finished sessions ───────────────────────────────────────────────

export interface VolumeSet {
  completed: boolean;
  exercise: MuscleSource | null | undefined;
}

/** A workout as these rules read it. `date` is the account's local day (yyyy-MM-dd). */
export interface VolumeSession {
  date: string;
  /** A workout that was never finished is left out. Missing means finished. */
  completed?: boolean;
  split_day_id?: string | null;
  sets: readonly VolumeSet[];
}

/** A finished workout with at least one finished set. */
export function isFinishedSession(session: VolumeSession): boolean {
  return session.completed !== false && session.sets.some((set) => set.completed);
}

export function sessionVolume(session: VolumeSession): MuscleSets {
  const sets: MuscleSets = new Map();
  for (const set of session.sets) if (set.completed) addMovementSets(sets, set.exercise, 1);
  return sets;
}

/** The Monday of the training week holding a local day (yyyy-MM-dd in, yyyy-MM-dd out). */
export function trainingWeekStart(dayKey: string): string {
  return format(startOfWeek(parseISO(dayKey), TRAINING_WEEK), 'yyyy-MM-dd');
}

// ── The usual week ──────────────────────────────────────────────────

export const USUAL_WEEK = {
  /** Training weeks averaged. */
  weeks: 4,
  /** Furthest back a training week may start, in weeks before the current one. */
  lookbackWeeks: 8,
  /** Fewer training weeks than this is no usual week yet. */
  minWeeks: 2,
} as const;

/**
 * A plain average with no band: it describes what was done, never how often,
 * and is never set against the plan on a screen.
 */
export interface UsualWeek {
  /** The Mondays averaged, newest first. */
  weekStarts: string[];
  sets: MuscleSets;
}

/**
 * The average week over the last 4 finished training weeks (weeks with at
 * least one finished session), looking back at most 8 weeks before the
 * current one. Null with fewer than 2 such weeks.
 */
export function usualWeek(sessions: readonly VolumeSession[], dayKey: string): UsualWeek | null {
  const current = trainingWeekStart(dayKey);
  const earliest = format(subWeeks(parseISO(current), USUAL_WEEK.lookbackWeeks), 'yyyy-MM-dd');
  const byWeek = new Map<string, VolumeSession[]>();
  for (const session of sessions) {
    if (!isFinishedSession(session)) continue;
    const week = trainingWeekStart(session.date);
    if (week >= current || week < earliest) continue;
    byWeek.set(week, [...(byWeek.get(week) ?? []), session]);
  }

  const weekStarts = [...byWeek.keys()].sort().reverse().slice(0, USUAL_WEEK.weeks);
  if (weekStarts.length < USUAL_WEEK.minWeeks) return null;

  const total: MuscleSets = new Map();
  for (const week of weekStarts) {
    for (const session of byWeek.get(week) ?? []) addMuscleSets(total, sessionVolume(session));
  }
  const sets: MuscleSets = new Map();
  for (const [muscle, count] of total) sets.set(muscle, count / weekStarts.length);
  return { weekStarts, sets };
}

// ── This week, done of planned ──────────────────────────────────────

export interface WeekProgressInput {
  workoutMode: WorkoutMode;
  /** The active program's days; null or empty with no program. */
  splitDays: readonly SplitDay[] | null | undefined;
  daysPerWeek: number | null | undefined;
  schedule: PlanSchedule | null;
  scheduleWorkouts: readonly ScheduleWorkout[];
  adaptiveSchedulingEnabled: boolean;
  /** Today, the account's local day (yyyy-MM-dd). */
  dayKey: string;
  /** Finished sessions; only this training week's are read. */
  sessions: readonly VolumeSession[];
}

export interface WeekProgress {
  weekStart: string;
  sessionsDone: number;
  /** The program days this week expects, in order; empty with no plan. */
  plannedDays: SplitDay[];
  /** Sets per muscle the planned days add up to; null in flexible mode or with no program. */
  planned: MuscleSets | null;
  /** Every finished set this week, off-plan movements and swaps included. */
  done: MuscleSets;
}

/**
 * The program days expected this training week: a fixed schedule's days, or a
 * rotation's days done this week, then the next ones in turn until the week's
 * count is met. A rotation with a schedule takes its done days from the
 * schedule's own completions; without one, from the finished sessions.
 */
export function plannedWeekDays(input: Omit<WeekProgressInput, 'workoutMode' | 'sessions'> & { sessions?: readonly VolumeSession[] }): SplitDay[] {
  const days = [...(input.splitDays ?? [])];
  if (!days.length) return [];
  const weekStart = parseISO(trainingWeekStart(input.dayKey));
  const history = [...input.scheduleWorkouts];

  if (input.schedule?.mode === 'fixed' && input.schedule.weekdays.length > 0) {
    const schedule = input.schedule;
    return Array.from({ length: 7 }, (_, offset) => (
      plannedDayForDate(addDays(weekStart, offset), days, schedule, 0, history, input.adaptiveSchedulingEnabled)
    )).filter((day): day is SplitDay => day !== null);
  }

  const target = Math.max(1, Math.round(input.daysPerWeek || days.length));
  const weekKey = format(weekStart, 'yyyy-MM-dd');
  const inWeek = (date: string) => trainingWeekStart(date) === weekKey && date <= input.dayKey;
  const doneIds = input.schedule
    ? history
      .filter((workout) => workout.completed && inWeek(workout.date))
      .sort((a, b) => a.date.localeCompare(b.date) || Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((workout) => workout.split_day_id)
    : (input.sessions ?? [])
      .filter((session) => isFinishedSession(session) && inWeek(session.date))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((session) => session.split_day_id);
  const done = doneIds.flatMap((id) => days.filter((day) => day.id === id));

  let next: number;
  const last = done.at(-1);
  if (last) {
    next = days.indexOf(last) + 1;
  } else if (input.schedule) {
    const upcoming = plannedDayForDate(parseISO(input.dayKey), days, input.schedule, 0, history, input.adaptiveSchedulingEnabled);
    next = upcoming ? days.indexOf(upcoming) : 0;
  } else {
    next = 0;
  }

  const planned = [...done];
  for (let step = 0; planned.length < target; step += 1) planned.push(days[(next + step) % days.length]);
  return planned;
}

export function weekProgress(input: WeekProgressInput): WeekProgress {
  const weekStart = trainingWeekStart(input.dayKey);
  const thisWeek = input.sessions.filter((session) => (
    isFinishedSession(session) && trainingWeekStart(session.date) === weekStart && session.date <= input.dayKey
  ));
  const done: MuscleSets = new Map();
  for (const session of thisWeek) addMuscleSets(done, sessionVolume(session));

  const hasPlan = input.workoutMode !== 'flexible' && (input.splitDays?.length ?? 0) > 0;
  const plannedDays = hasPlan ? plannedWeekDays(input) : [];
  const planned = hasPlan ? programVolume({ days: plannedDays }) : null;
  return { weekStart, sessionsDone: thisWeek.length, plannedDays, planned, done };
}
