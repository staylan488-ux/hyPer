// The Monday check-in: how the training week before today went. Body weight
// against the goal's pace, calories and protein a day, sets per muscle and the
// records set. The rules are pure; `readWeekCheckIn` does the reads.
import { addDays, format, parseISO, startOfWeek, subDays } from 'date-fns';

import { fetchWeeklyNutrition, averageLoggedDays, type DailyNutrition } from '@/hooks/useWeeklyNutrition';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { supabase } from '@/lib/supabase';
import { computeWeeklyVolume, type WeeklyVolumeWorkoutRow } from '@/lib/weeklyVolume';
import { dailyMedianWeights, type WeightSampleLike } from '@/lib/weightTrend';
import { calculateE1RM, toFiniteNumber } from '@/lib/workoutProgress';
import { TRAINING_WEEK } from '@/lib/workoutSessions';
import type { MuscleGroup, MuscleVolume, VolumeLandmark } from '@/types';

/** A local calendar day as 'yyyy-MM-dd'. */
type DayKey = string;

export interface CheckInWeek {
  /** The Monday the week starts on. */
  start: DayKey;
  /** Its Sunday. */
  end: DayKey;
  /** The Monday a week earlier, whose weigh-ins the change is measured from. */
  before: DayKey;
}

/** The check-in shows on Mondays, the first day of the training week. */
export function isCheckInDay(todayKey: DayKey): boolean {
  return parseISO(todayKey).getDay() === 1;
}

/** The training week (Monday to Sunday) before the one holding `todayKey`. */
export function checkInWeek(todayKey: DayKey): CheckInWeek {
  const thisMonday = startOfWeek(parseISO(todayKey), TRAINING_WEEK);
  const start = subDays(thisMonday, 7);
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(subDays(thisMonday, 1), 'yyyy-MM-dd'),
    before: format(subDays(start, 7), 'yyyy-MM-dd'),
  };
}

/** "Nov 2–8", or "Oct 27–Nov 2" across a month. */
export function checkInWeekLabel(week: Pick<CheckInWeek, 'start' | 'end'>): string {
  const start = parseISO(week.start);
  const end = parseISO(week.end);
  return start.getMonth() === end.getMonth() ? `${format(start, 'MMM d')}–${format(end, 'd')}` : `${format(start, 'MMM d')}–${format(end, 'MMM d')}`;
}

// ── Body weight ──────────────────────────────────────────────────────────

export interface WeekWeight {
  /** The average of the week's weigh-in days (each day's median), in kg. */
  averageKg: number;
  /** Days weighed in that week. */
  days: number;
  /** Against the week before's average; null without a weigh-in that week. */
  changeKg: number | null;
}

function averageOfDays(medians: Map<string, number>, from: DayKey, to: DayKey): { average: number; days: number } | null {
  const values = [...medians].filter(([day]) => day >= from && day <= to).map(([, kg]) => kg);
  if (values.length === 0) return null;
  return { average: values.reduce((sum, kg) => sum + kg, 0) / values.length, days: values.length };
}

/**
 * The week's weight as the average of its weigh-in days, against the week
 * before's. Weekly averages, rather than one morning against another, keep a
 * day of water from reading as a week's gain.
 */
export function weekWeight(samples: WeightSampleLike[], week: CheckInWeek): WeekWeight | null {
  const medians = dailyMedianWeights(samples);
  const last = averageOfDays(medians, week.start, week.end);
  if (!last) return null;
  const before = averageOfDays(medians, week.before, format(subDays(parseISO(week.start), 1), 'yyyy-MM-dd'));
  return { averageKg: last.average, days: last.days, changeKg: before ? last.average - before.average : null };
}

export type PaceCall = 'on pace' | 'ahead of pace' | 'behind pace';

/**
 * The goal's weekly change in kg at this body weight: the saved rate is a
 * signed percentage of body weight a week. Null when maintaining or with no
 * rate saved, where there is no pace to keep.
 */
export function goalPaceKg(profile: { goal: NutritionGoal; rate_pct_per_week: number } | null | undefined, bodyKg: number): number | null {
  if (!profile || profile.goal === 'maintain') return null;
  const rate = Number(profile.rate_pct_per_week);
  if (!Number.isFinite(rate) || rate === 0 || !Number.isFinite(bodyKg) || bodyKg <= 0) return null;
  return (rate / 100) * bodyKg;
}

/** Within a quarter of the pace, or 0.1 kg (about 0.2 lb) for a slow one, counts as on pace. */
const PACE_TOLERANCE_SHARE = 0.25;
const PACE_TOLERANCE_KG = 0.1;

/**
 * How the week's change sits against the pace. "Ahead" is further in the
 * goal's direction: more gained while bulking, more lost while cutting.
 * Neither side is a failure; the words only say where it stands.
 */
export function paceCall(changeKg: number, paceKg: number): PaceCall {
  const tolerance = Math.max(Math.abs(paceKg) * PACE_TOLERANCE_SHARE, PACE_TOLERANCE_KG);
  const beyond = (changeKg - paceKg) * Math.sign(paceKg);
  if (beyond > tolerance) return 'ahead of pace';
  if (beyond < -tolerance) return 'behind pace';
  return 'on pace';
}

// ── Eating ───────────────────────────────────────────────────────────────

export interface WeekEating {
  /** Days with anything logged. */
  days: number;
  /** A day's average over those days. */
  calories: number;
  protein: number;
}

/** Calories and protein a day over the days logged; null with nothing logged. */
export function weekEating(days: DailyNutrition[]): WeekEating | null {
  const logged = days.filter((day) => day.calories > 0 || day.protein > 0).length;
  if (logged === 0) return null;
  return { days: logged, calories: averageLoggedDays(days, 'calories'), protein: averageLoggedDays(days, 'protein') };
}

// ── Records ──────────────────────────────────────────────────────────────

export interface RecordSet {
  exerciseId: string;
  weight: number;
  reps: number;
  date: DayKey;
}

export type RecordKind = 'estimated max' | 'heaviest' | 'most reps';

export interface WeekRecord {
  exerciseId: string;
  name: string;
  kind: RecordKind;
  /** The set that set it. */
  set: RecordSet;
  /** The best before it, by the same measure. */
  previous: RecordSet;
}

/** A set's estimated one-rep max; a single counts as its own weight. */
export function estimatedMax(set: Pick<RecordSet, 'weight' | 'reps'>): number | null {
  if (set.weight <= 0 || set.reps <= 0) return null;
  return set.reps === 1 ? set.weight : calculateE1RM(set.weight, set.reps);
}

const MEASURES: Array<{ kind: RecordKind; value: (set: RecordSet) => number | null }> = [
  { kind: 'estimated max', value: estimatedMax },
  { kind: 'heaviest', value: (set) => (set.weight > 0 && set.reps > 0 ? set.weight : null) },
  // Bodyweight work (0 lb): more reps.
  { kind: 'most reps', value: (set) => (set.weight === 0 && set.reps > 0 ? set.reps : null) },
];

/** Floating-point slack, so the same set logged again is never a record. */
const RECORD_EPSILON = 0.01;

function best(sets: RecordSet[], value: (set: RecordSet) => number | null): { set: RecordSet; value: number } | null {
  let top: { set: RecordSet; value: number } | null = null;
  for (const set of sets) {
    const measured = value(set);
    if (measured === null) continue;
    // Ties go to the earlier set, the first time it was done.
    if (!top || measured > top.value || (measured === top.value && set.date < top.set.date)) top = { set, value: measured };
  }
  return top;
}

/**
 * The movements whose best this week beats every finished set before it, one
 * record each: a higher estimated max first, else a heavier load, else more
 * reps at 0 lb. A movement's first week breaks nothing, having nothing to
 * beat. Newest records first, then by name.
 */
export function weekRecords(weekSets: RecordSet[], priorSets: RecordSet[], names: Map<string, string>): WeekRecord[] {
  const byExercise = (sets: RecordSet[]) => {
    const grouped = new Map<string, RecordSet[]>();
    for (const set of sets) grouped.set(set.exerciseId, [...(grouped.get(set.exerciseId) ?? []), set]);
    return grouped;
  };
  const prior = byExercise(priorSets);
  const records: WeekRecord[] = [];
  for (const [exerciseId, sets] of byExercise(weekSets)) {
    const before = prior.get(exerciseId);
    if (!before?.length) continue;
    for (const measure of MEASURES) {
      const now = best(sets, measure.value);
      const then = best(before, measure.value);
      if (!now || !then || now.value <= then.value + RECORD_EPSILON) continue;
      records.push({ exerciseId, name: names.get(exerciseId) ?? 'Movement', kind: measure.kind, set: now.set, previous: then.set });
      break;
    }
  }
  return records.sort((a, b) => b.set.date.localeCompare(a.set.date) || a.name.localeCompare(b.name));
}

// ── Sets per muscle ──────────────────────────────────────────────────────

/** The week's trained muscles, most sets first. */
export function weekMuscles(workouts: WeeklyVolumeWorkoutRow[], landmarks: VolumeLandmark[]): MuscleVolume[] {
  return computeWeeklyVolume(workouts, landmarks)
    .filter((volume) => volume.weekly_sets > 0)
    .sort((a, b) => b.weekly_sets - a.weekly_sets);
}

/** Every completed set in the week, primary muscles counted once ("58 sets"). */
export function weekSetCount(workouts: WeeklyVolumeWorkoutRow[]): number {
  return workouts.reduce((sum, workout) => sum + workout.sets.filter((set) => set.completed && set.exercise).length, 0);
}

// ── The reads ────────────────────────────────────────────────────────────

export interface WeekCheckIn {
  week: CheckInWeek;
  weight: WeekWeight | null;
  eating: WeekEating | null;
  /** Completed sets across the week. */
  sets: number;
  muscles: MuscleVolume[];
  records: WeekRecord[];
}

/** Whether the week holds anything to show. */
export function hasCheckIn(checkIn: WeekCheckIn): boolean {
  return Boolean(checkIn.weight || checkIn.eating || checkIn.sets > 0);
}

type WeekSetRow = {
  exercise_id: string;
  weight: number | string | null;
  reps: number | string | null;
  completed: boolean | null;
  exercise: { name: string | null; muscle_group: MuscleGroup; muscle_group_secondary: MuscleGroup | null } | null;
};

type WeekWorkoutRow = { id: string; date: string; completed: boolean | null; sets: WeekSetRow[] | null };

type PriorSetRow = {
  id: string;
  exercise_id: string;
  weight: number | string | null;
  reps: number | string | null;
  workout: { date: string; completed: boolean | null } | null;
};

/** Ids per request, so a long list of movements never overflows the URL. */
const EXERCISE_CHUNK = 100;
/** One request returns at most this many rows; the history is read a page at a time. */
const SET_PAGE = 1000;
const SET_MAX_PAGES = 50;

function recordSet(row: { exercise_id: string; weight: number | string | null; reps: number | string | null }, date: DayKey): RecordSet | null {
  const weight = toFiniteNumber(row.weight) ?? 0;
  const reps = toFiniteNumber(row.reps);
  if (reps === null || reps <= 0 || weight < 0) return null;
  return { exerciseId: row.exercise_id, weight, reps, date };
}

/** Every completed set of these movements in finished workouts before `before`, paged by id. */
async function readPriorSets(exerciseIds: string[], before: DayKey, pageSize: number): Promise<RecordSet[]> {
  const sets: RecordSet[] = [];
  for (let index = 0; index < exerciseIds.length; index += EXERCISE_CHUNK) {
    const chunk = exerciseIds.slice(index, index + EXERCISE_CHUNK);
    let after: string | null = null;
    for (let page = 0; page < SET_MAX_PAGES; page++) {
      let query = supabase
        .from('sets')
        .select('id, exercise_id, weight, reps, workout:workouts(date, completed)')
        .in('exercise_id', chunk)
        .eq('completed', true);
      if (after !== null) query = query.gt('id', after);
      const { data, error } = await query.order('id', { ascending: true }).limit(pageSize);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as PriorSetRow[];
      for (const row of rows) {
        // Only finished workouts count, as the movement's history shows them.
        if (!row.workout?.completed || row.workout.date >= before) continue;
        const set = recordSet(row, row.workout.date);
        if (set) sets.push(set);
      }
      if (rows.length < pageSize) break;
      after = rows[rows.length - 1].id;
    }
  }
  return sets;
}

/** Midnight at the start of a local day, as an ISO time. */
const dayStartIso = (day: DayKey) => parseISO(day).toISOString();

/**
 * Reads the week before `todayKey` and works out its check-in. Throws when a
 * read fails, so a half-read week never shows as a quiet one.
 */
export async function readWeekCheckIn(input: {
  userId: string;
  todayKey: DayKey;
  landmarks: VolumeLandmark[];
  /** Rows a page when reading the earlier sets (tests use a small one). */
  setPageSize?: number;
}): Promise<WeekCheckIn> {
  const week = checkInWeek(input.todayKey);
  const nextMonday = format(addDays(parseISO(week.end), 1), 'yyyy-MM-dd');

  const [workoutsRead, weightsRead, nutrition, landmarksRead] = await Promise.all([
    supabase
      .from('workouts')
      .select('id, date, completed, sets(exercise_id, weight, reps, completed, exercise:exercises(name, muscle_group, muscle_group_secondary))')
      .eq('user_id', input.userId)
      .gte('date', week.start)
      .lte('date', week.end),
    supabase
      .from('body_weight_measurements')
      .select('measured_at, kilograms')
      .eq('user_id', input.userId)
      .gte('measured_at', dayStartIso(week.before))
      .lt('measured_at', dayStartIso(nextMonday)),
    fetchWeeklyNutrition(week.end),
    // The account's own landmarks, as Progress grades against; the ones kept in memory if this read fails.
    Promise.resolve(supabase.from('volume_landmarks').select('*').eq('user_id', input.userId)).catch(() => ({ data: null })),
  ]);
  const landmarks = (landmarksRead.data as VolumeLandmark[] | null) ?? input.landmarks;
  if (workoutsRead.error) throw new Error(workoutsRead.error.message);
  if (weightsRead.error) throw new Error(weightsRead.error.message);
  if (!nutrition) throw new Error('Couldn’t read the week’s food.');

  const workouts = ((workoutsRead.data ?? []) as unknown as WeekWorkoutRow[]).map((workout) => ({
    ...workout,
    sets: (workout.sets ?? []).filter((set) => set.completed),
  }));
  // Sets per muscle count every completed set, as Progress does for this week.
  const volumeRows: WeeklyVolumeWorkoutRow[] = workouts.map((workout) => ({
    sets: workout.sets.map((set) => ({ exercise: set.exercise, completed: true })),
  }));

  // Records come from finished workouts only.
  const names = new Map<string, string>();
  const weekSets: RecordSet[] = [];
  for (const workout of workouts) {
    if (!workout.completed) continue;
    for (const row of workout.sets) {
      if (row.exercise?.name) names.set(row.exercise_id, row.exercise.name);
      const set = recordSet(row, workout.date);
      if (set) weekSets.push(set);
    }
  }
  const exerciseIds = [...new Set(weekSets.map((set) => set.exerciseId))];
  const priorSets = exerciseIds.length ? await readPriorSets(exerciseIds, week.start, input.setPageSize ?? SET_PAGE) : [];

  return {
    week,
    weight: weekWeight((weightsRead.data ?? []) as WeightSampleLike[], week),
    eating: weekEating(nutrition.weeklyNutrition),
    sets: weekSetCount(volumeRows),
    muscles: weekMuscles(volumeRows, landmarks),
    records: weekRecords(weekSets, priorSets, names),
  };
}
