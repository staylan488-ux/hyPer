import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';

import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import { supabase } from '@/lib/supabase';
import { getWorkoutStartDateKey, resolveEditedSetCompletedAt, resolveWorkoutTitle } from '@/lib/workoutSessions';
import { useAppStore } from '@/stores/appStore';
import type { ActivitySession, ExerciseSubstitution, FlexiblePlanItem, Workout, WorkoutDayPlan, WorkoutSet } from '@/types';

// History's rules, shared by the web History page and the native History screens.

/** A month's workout with the names History titles it by. */
export interface HistoryWorkout extends Workout {
  split_day?: { day_name: string } | null;
  day_label?: string | null;
}

/** A month grid starting on Sunday, padded with the neighbouring months' days. */
export function buildCalendarDays(baseDate: Date): Date[] {
  const monthStart = startOfMonth(baseDate);
  const endDate = endOfWeek(endOfMonth(baseDate));

  const days: Date[] = [];
  let day = startOfWeek(monthStart);
  while (day <= endDate) {
    days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

/** The day a workout belongs to: the local day it started, else its date. */
export function historyDayKey(workout: Pick<Workout, 'created_at' | 'date'>): string {
  return getWorkoutStartDateKey(workout) || workout.date;
}

export function groupSetsByExercise(sets: WorkoutSet[]): Record<string, WorkoutSet[]> {
  const grouped = sets.reduce<Record<string, WorkoutSet[]>>((acc, set) => {
    (acc[set.exercise_id] ||= []).push(set);
    return acc;
  }, {});
  Object.keys(grouped).forEach((exerciseId) => {
    grouped[exerciseId] = grouped[exerciseId].slice().sort((a, b) => a.set_number - b.set_number);
  });
  return grouped;
}

export function progressFromSets(sets: WorkoutSet[]) {
  const totalSets = sets.length;
  const completedSets = sets.filter((set) => set.completed).length;
  const percent = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
  const completed = totalSets > 0 && completedSets === totalSets;
  return { totalSets, completedSets, percent, completed };
}

export function historyWorkoutTitle(workout: HistoryWorkout, plan?: WorkoutDayPlan | null): string {
  return resolveWorkoutTitle({
    splitDayName: workout.split_day?.day_name,
    dayLabel: workout.day_label || plan?.day_label || null,
    exerciseNames: workout.sets.map((set) => set.exercise?.name || null),
  });
}

/** "1 lift · 2 activities", or "0 sessions" for an empty day. */
export function summarizeHistoryDay(lifts: number, activities: number): string {
  const parts: string[] = [];
  if (lifts > 0) parts.push(`${lifts} lift${lifts !== 1 ? 's' : ''}`);
  if (activities > 0) parts.push(`${activities} activit${activities !== 1 ? 'ies' : 'y'}`);
  return parts.length > 0 ? parts.join(' · ') : '0 sessions';
}

export interface HistoryMovement {
  exerciseId: string;
  name: string;
  sets: WorkoutSet[];
  plan: FlexiblePlanItem | null;
  /** The plan's set count, else the logged count, kept to 1–12. */
  targetSets: number;
  substitutesFor: ExerciseSubstitution | null;
  supersetGroupId: string | null;
  partnerId: string | null;
  partnerName: string | null;
  /** The plan's note with its set-range tag removed. */
  planNote: string;
}

/**
 * A past workout's movements as History shows them: only movements with sets,
 * in the plan's order first, then the rest; with their superset partners
 * (pairs only) and the plan's note without its set-range tag.
 */
export function orderHistoryMovements(sets: WorkoutSet[], plan: WorkoutDayPlan | null): HistoryMovement[] {
  const groupedSets = groupSetsByExercise(sets);
  const plannedVisible = plan ? plan.items.filter((item) => !item.hidden).sort((a, b) => a.order - b.order) : [];
  const plannedIds = plannedVisible.map((item) => item.exercise_id);
  const groupedIds = Object.keys(groupedSets);
  const orderedIds = [
    ...plannedIds.filter((exerciseId) => groupedIds.includes(exerciseId)),
    ...groupedIds.filter((exerciseId) => !plannedIds.includes(exerciseId)),
  ];
  const planByExercise = new Map(plannedVisible.map((item) => [item.exercise_id, item]));
  const bySuperset = new Map<string, string[]>();
  plannedVisible.forEach((item) => {
    if (!item.superset_group_id) return;
    bySuperset.set(item.superset_group_id, [...(bySuperset.get(item.superset_group_id) ?? []), item.exercise_id]);
  });
  const partnerByExercise = new Map<string, string>();
  bySuperset.forEach((ids) => {
    if (ids.length !== 2) return;
    partnerByExercise.set(ids[0], ids[1]);
    partnerByExercise.set(ids[1], ids[0]);
  });
  const nameOf = (exerciseId: string, fallback: string) =>
    planByExercise.get(exerciseId)?.exercise_name
    || (groupedSets[exerciseId]?.[0]?.exercise as { name?: string } | undefined)?.name
    || fallback;

  return orderedIds.map((exerciseId) => {
    const movementSets = groupedSets[exerciseId] ?? [];
    const planItem = planByExercise.get(exerciseId) ?? null;
    const partnerId = partnerByExercise.get(exerciseId) ?? null;
    return {
      exerciseId,
      name: nameOf(exerciseId, 'Unknown Exercise'),
      sets: movementSets,
      plan: planItem,
      targetSets: Math.max(1, Math.min(12, planItem?.target_sets || movementSets.length || 1)),
      substitutesFor: planItem?.substitutes_for ?? null,
      supersetGroupId: planItem?.superset_group_id ?? null,
      partnerId,
      partnerName: partnerId ? nameOf(partnerId, 'Exercise') : null,
      planNote: parseSetRangeNotes(planItem?.notes, 1).baseNotes || '',
    };
  });
}

/** Swaps a movement with its neighbour, as History's Move earlier / later does. */
export function moveHistoryMovement(orderedIds: string[], exerciseId: string, direction: -1 | 1): string[] | null {
  const index = orderedIds.indexOf(exerciseId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= orderedIds.length) return null;
  const next = [...orderedIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * The update for a corrected past set: complete only with both weight and
 * reps; its completion time keeps the set's own, else the workout's, else now.
 */
export function buildPastSetUpdate(
  set: Pick<WorkoutSet, 'completed_at'>,
  values: { weight: number | null; reps: number | null; rpe: number | null },
  workoutCompletedAt: string | null | undefined,
): Partial<WorkoutSet> {
  const completed = values.weight !== null && values.reps !== null;
  return {
    weight: values.weight,
    reps: values.reps,
    rpe: values.rpe,
    completed,
    completed_at: resolveEditedSetCompletedAt({
      completed,
      existingSetCompletedAt: set.completed_at,
      workoutCompletedAt,
    }),
  };
}

/**
 * Loads a History month: its workouts with their program-day or session
 * names, and its activities. The store fetchers return [] when nobody is
 * signed in.
 */
export async function fetchHistoryMonth(month: Date): Promise<{ workouts: HistoryWorkout[]; activities: ActivitySession[] }> {
  const store = useAppStore.getState();
  const [workouts, activities] = await Promise.all([
    store.fetchWorkoutsByMonth(month),
    store.fetchActivitySessionsByMonth(month),
  ]);
  const splitDayIds = [...new Set(workouts.filter((workout) => workout.split_day_id).map((workout) => workout.split_day_id as string))];
  const flexibleIds = workouts.filter((workout) => workout.split_day_id === null).map((workout) => workout.id);

  // The two name lookups are independent; an empty id list makes no request.
  const [splitDayResult, planResult] = await Promise.all([
    splitDayIds.length > 0
      ? supabase.from('split_days').select('id, day_name').in('id', splitDayIds)
      : Promise.resolve({ data: null }),
    flexibleIds.length > 0
      ? supabase.from('workout_day_plans').select('workout_id, day_label').in('workout_id', flexibleIds)
      : Promise.resolve({ data: null }),
  ]);
  const splitDays = new Map(((splitDayResult.data || []) as { id: string; day_name: string }[]).map((row) => [row.id, row.day_name]));
  const labels = new Map(((planResult.data || []) as { workout_id: string; day_label: string }[]).map((row) => [row.workout_id, row.day_label]));

  return {
    workouts: workouts.map((workout) => ({
      ...workout,
      split_day: workout.split_day_id ? { day_name: splitDays.get(workout.split_day_id) || 'Unknown' } : null,
      day_label: labels.get(workout.id) || null,
    })),
    activities,
  };
}
