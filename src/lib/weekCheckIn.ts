// The Monday check-in: how the training week before today went. Body weight
// against the goal's pace, calories and protein a day, sets per muscle and the
// records set. The rules are pure; `readWeekCheckIn` does the reads.
import { addDays, format, parseISO, startOfWeek, subDays } from 'date-fns';

import { fetchWeeklyNutrition, type DailyNutrition } from '@/hooks/useWeeklyNutrition';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { supabase } from '@/lib/supabase';
import { computeWeeklyVolume, type WeeklyVolumeWorkoutRow } from '@/lib/weeklyVolume';
import { dailyMedianWeights, type WeightSampleLike } from '@/lib/weightTrend';
import {
  buildMovementHistory, countsAsSession, fetchMovementSets, findNewRecords, setFigures,
  type MovementRecords, type MovementSetRow, type RecordKind, type SetFigures,
} from '@/lib/movementHistory';
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
  const logged = days.filter((day) => day.calories > 0 || day.protein > 0);
  if (logged.length === 0) return null;
  // Both figures over the same days, the ones counted beside them: a day with
  // calories and no protein (a soda alone) still counts toward protein a day.
  const average = (key: 'calories' | 'protein') => logged.reduce((sum, day) => sum + day[key], 0) / logged.length;
  return { days: logged.length, calories: average('calories'), protein: average('protein') };
}

// ── Records ──────────────────────────────────────────────────────────────

/** A set with the day it was done. Weight 0 is bodyweight. */
export interface RecordSet extends SetFigures {
  date: DayKey;
}

export interface WeekRecord {
  exerciseId: string;
  name: string;
  /** As the movement's own Records name it: estimated max, heaviest, most reps. */
  kind: RecordKind;
  /** The set that set it. */
  set: RecordSet;
  /** The best before it, by the same measure. */
  previous: RecordSet;
}

/** A completed set of the week, from a workout that is over. */
export interface WeekSet {
  exercise_id: string;
  name: string | null;
  weight: number;
  reps: number;
  date: DayKey;
}

/**
 * The movements whose best this week beats every finished set before it, by
 * the movement history's own rule (`findNewRecords`, one record a movement:
 * a higher estimated max first, else a heavier load, else more bodyweight
 * reps; a movement's first week breaks nothing). `prior` holds each
 * movement's records before the week. Newest records first, then by name.
 */
export function weekRecords(weekSets: WeekSet[], prior: Readonly<Record<string, MovementRecords | undefined>>): WeekRecord[] {
  const found = findNewRecords(
    weekSets.map((set) => ({ ...set, completed: true, exercise: { name: set.name } })),
    prior,
  );
  return found
    .flatMap((record): WeekRecord[] => {
      const before = prior[record.exerciseId];
      const previous = record.kind === 'max' ? before?.estMax : record.kind === 'heaviest' ? before?.heaviest : before?.mostReps;
      if (!previous) return [];
      // The first day of the week the set was done.
      const date = weekSets
        .filter((set) => set.exercise_id === record.exerciseId && set.weight === record.set.weight && set.reps === record.set.reps)
        .map((set) => set.date)
        .sort()[0];
      return [{
        exerciseId: record.exerciseId,
        name: record.name,
        kind: record.kind,
        set: { weight: record.set.weight, reps: record.set.reps, date: date ?? '' },
        previous: { weight: previous.weight, reps: previous.reps, date: previous.day },
      }];
    })
    .sort((a, b) => b.set.date.localeCompare(a.set.date) || a.name.localeCompare(b.name));
}

/** Each movement's records from workouts before `before`, from its logged sets. */
export function priorRecords(rows: MovementSetRow[], exerciseIds: string[], before: DayKey): Record<string, MovementRecords> {
  const earlier = rows.filter((row) => row.workout && row.workout.date < before);
  return Object.fromEntries(
    exerciseIds.map((exerciseId) => [exerciseId, buildMovementHistory(earlier.filter((row) => row.exercise_id === exerciseId)).records]),
  );
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

type WeekWorkoutRow = { id: string; date: string; created_at?: string | null; completed: boolean | null; sets: WeekSetRow[] | null };

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
}): Promise<WeekCheckIn> {
  const week = checkInWeek(input.todayKey);
  const nextMonday = format(addDays(parseISO(week.end), 1), 'yyyy-MM-dd');

  const [workoutsRead, weightsRead, nutrition, landmarksRead] = await Promise.all([
    supabase
      .from('workouts')
      .select('id, date, created_at, completed, sets(exercise_id, weight, reps, completed, exercise:exercises(name, muscle_group, muscle_group_secondary))')
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

  // Records come from workouts that are over, as the movement's history counts them.
  const weekSets: WeekSet[] = [];
  for (const workout of workouts) {
    if (!countsAsSession(workout)) continue;
    for (const row of workout.sets) {
      const figures = setFigures(row);
      if (figures) weekSets.push({ exercise_id: row.exercise_id, name: row.exercise?.name ?? null, ...figures, date: workout.date });
    }
  }
  const exerciseIds = [...new Set(weekSets.map((set) => set.exercise_id))];
  let prior: Record<string, MovementRecords> = {};
  if (exerciseIds.length) {
    const rows = await fetchMovementSets(exerciseIds);
    if (!rows) throw new Error('Couldn’t read the movements’ history.');
    prior = priorRecords(rows, exerciseIds, week.start);
  }

  return {
    week,
    weight: weekWeight((weightsRead.data ?? []) as WeightSampleLike[], week),
    eating: weekEating(nutrition.weeklyNutrition),
    sets: weekSetCount(volumeRows),
    muscles: weekMuscles(volumeRows, landmarks),
    records: weekRecords(weekSets, prior),
  };
}
