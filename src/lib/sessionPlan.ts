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

/** A superset member's place in its pair: A leads each round, B closes it. */
export type SupersetRole = 'A' | 'B';

export interface SupersetFlow {
  groupId: string;
  role: SupersetRole;
  partnerExerciseId: string;
}

/**
 * Superset pairs in session order: the first member of a group is A, the
 * second B. A group without exactly two movements is not a pair.
 */
export function supersetFlows(
  orderedExerciseIds: readonly string[],
  groupByExerciseId: ReadonlyMap<string, string>,
): Map<string, SupersetFlow> {
  const groups = new Map<string, string[]>();
  for (const exerciseId of orderedExerciseIds) {
    const groupId = groupByExerciseId.get(exerciseId);
    if (!groupId) continue;
    groups.set(groupId, [...(groups.get(groupId) ?? []), exerciseId]);
  }
  const flows = new Map<string, SupersetFlow>();
  for (const [groupId, members] of groups) {
    if (members.length !== 2) continue;
    const [a, b] = members;
    flows.set(a, { groupId, role: 'A', partnerExerciseId: b });
    flows.set(b, { groupId, role: 'B', partnerExerciseId: a });
  }
  return flows;
}

/**
 * Why a superset set cannot be logged yet, or null. Rounds go A1, B1, A2, B2:
 * A waits for the partner's previous round, B for the same round of A.
 * Correcting a logged set is never blocked.
 */
export function supersetLogBlock(
  candidate: Pick<WorkoutSet, 'completed' | 'set_number'>,
  flow: SupersetFlow | undefined,
  sets: readonly Pick<WorkoutSet, 'exercise_id' | 'set_number' | 'completed'>[],
): string | null {
  if (candidate.completed || !flow) return null;
  const round = candidate.set_number;
  const partner = sets.filter((set) => set.exercise_id === flow.partnerExerciseId);
  if (flow.role === 'A') {
    const previous = partner.find((set) => set.set_number === round - 1);
    return round > 1 && !previous?.completed ? `Complete B${round - 1} before starting A${round}.` : null;
  }
  const matching = partner.find((set) => set.set_number === round);
  return matching?.completed ? null : `Complete A${round} before logging B${round}.`;
}
