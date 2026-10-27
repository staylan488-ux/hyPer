// A live workout's movements as planned, shared by the web Train page and the
// native app. A workout with its own session plan (workout_day_plans: flexible
// sessions, swaps, reorders) follows that plan; otherwise the program day.
import { parseSetRangeNotes, type SetRangeNotesResult } from '@/lib/setRangeNotes';
import type { ExerciseSubstitution, FlexiblePlanItem, SplitExercise, WorkoutDayPlan, WorkoutSet } from '@/types';

/** One planned movement, from a session-plan item or a program-day exercise. */
export interface SessionExercise {
  exercise_id: string;
  exercise_order: number;
  target_sets: number;
  target_reps_min?: number | null;
  target_reps_max?: number | null;
  notes: string | null;
  superset_group_id?: string | null;
  /** Set when this movement replaced a planned one for this session only. */
  substitutes_for?: ExerciseSubstitution | null;
  hidden?: boolean;
}

/** The session plan's items, when the plan belongs to this workout. */
export function sessionPlanItems(
  plan: Pick<WorkoutDayPlan, 'workout_id' | 'items'> | null | undefined,
  workoutId: string | null | undefined,
): FlexiblePlanItem[] | undefined {
  return workoutId && plan?.workout_id === workoutId ? plan.items : undefined;
}

/** The session's movements: its plan items when it has a plan, else the program day's exercises. */
export function sessionExercises(
  planItems: readonly FlexiblePlanItem[] | undefined,
  dayExercises: readonly SplitExercise[] | undefined,
): SessionExercise[] {
  if (planItems) {
    return planItems.map((item) => ({
      ...item,
      exercise_order: item.order,
      target_sets: item.target_sets ?? 3,
      notes: item.notes ?? null,
    }));
  }
  return [...(dayExercises ?? [])];
}

/** For each visible swap, the planned movement it replaced. */
export function sessionSubstitutions(planItems: readonly FlexiblePlanItem[] | undefined): Map<string, ExerciseSubstitution> {
  return new Map(
    (planItems ?? []).flatMap((item) => (
      item.substitutes_for && !item.hidden ? [[item.exercise_id, item.substitutes_for] as const] : []
    )),
  );
}

/** Each movement's place in the session. */
export function sessionOrder(exercises: readonly SessionExercise[]): Map<string, number> {
  return new Map(exercises.map((exercise, index) => [exercise.exercise_id, exercise.exercise_order ?? index]));
}

/** Sets in session order: by their movement's place (unplanned movements last), then set number. */
export function orderSessionSets<T extends Pick<WorkoutSet, 'exercise_id' | 'set_number'>>(
  sets: readonly T[],
  order: ReadonlyMap<string, number>,
): T[] {
  return [...sets].sort((a, b) => {
    const orderA = order.get(a.exercise_id) ?? Number.MAX_SAFE_INTEGER;
    const orderB = order.get(b.exercise_id) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.set_number - b.set_number;
  });
}

/** Each planned movement's set range, from its [set-range] note. */
export function sessionSetRanges(exercises: readonly SessionExercise[]): Map<string, SetRangeNotesResult> {
  return new Map(exercises.map((exercise) => [exercise.exercise_id, parseSetRangeNotes(exercise.notes, exercise.target_sets)] as const));
}

/**
 * Whether a movement can gain or lose a set during the session. Without a
 * planned range it may hold 1 to 12 sets. A set is only ever removed from the
 * unfinished ones, so a movement with every set logged cannot shrink.
 */
export function setCountChanges(
  range: Pick<SetRangeNotesResult, 'minSets' | 'maxSets'> | undefined,
  sets: readonly Pick<WorkoutSet, 'completed'>[],
): { canAdd: boolean; canRemove: boolean } {
  const { minSets, maxSets } = range ?? { minSets: 1, maxSets: 12 };
  return {
    canAdd: sets.length < maxSets,
    canRemove: sets.length > minSets && sets.some((set) => !set.completed),
  };
}
