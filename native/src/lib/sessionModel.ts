// Pure: the live workout as the screens need it. No React, no React Native, so
// the web test suite can cover it (tests/nativeSessionModel.test.ts). Order,
// targets, swaps and superset rounds follow the shared session plan rules
// (src/lib/sessionPlan), the same ones the web Train page uses.
import { nextWorkoutSet } from '@/lib/workoutFocus';
import {
  orderSessionSets,
  sessionExercises,
  sessionOrder,
  sessionPlanItems,
  sessionSetRanges,
  sessionSubstitutions,
  supersetFlows,
  supersetLogBlock,
  type SessionExercise,
  type SupersetFlow,
  type SupersetRole,
} from '@/lib/sessionPlan';
import type { SetRangeNotesResult } from '@/lib/setRangeNotes';
import { parseWorkoutNotes } from '@/lib/workoutNotes';
import type { ExerciseSubstitution, Split, Workout, WorkoutDayPlan, WorkoutSet } from '@/types';

export type Movement = {
  exerciseId: string;
  name: string;
  sets: WorkoutSet[];
  done: number;
  plan: SessionExercise | null;
  /** The planned movement this one replaces for this session only. */
  substitutesFor: ExerciseSubstitution | null;
  /** The program's set range, shown for reference; it does not limit changes. */
  range: SetRangeNotesResult | null;
  /** Whether a set can be added, or an unfinished one removed (see MAX_SETS). */
  canAddSet: boolean;
  canRemoveSet: boolean;
  /** The saved movement note ('' when there is none). */
  note: string;
  /** The superset this movement belongs to, with its partner, when it is one of a pair. */
  superset: { groupId: string; role: SupersetRole; partnerId: string; partnerName: string } | null;
};

export type SessionModel = {
  workoutId: string;
  date: string;
  dayName: string;
  /** A flexible session: built as it goes, so movements can be added, removed and paired. */
  flexible: boolean;
  startedAt: Date;
  /** Every set in session order: movement by movement, set by set. */
  sets: WorkoutSet[];
  doneCount: number;
  movements: Movement[];
  /** The movement and set the next "Log set" applies to, or null when all are done. */
  current: {
    movement: Movement;
    set: WorkoutSet;
    /** 1-based position of the set within its movement. */
    setNumber: number;
    /** 0-based position in `sets`. */
    index: number;
    /** Why this set cannot be logged yet (a superset round out of turn), or null. */
    blocked: string | null;
  } | null;
  /** Superset pairs by exercise id, for what comes after a logged set. */
  pairings: ReadonlyMap<string, SupersetFlow>;
};

/**
 * A movement may hold 1 to 12 sets in a session, whatever its program says
 * (the owner's call; the web keeps to the program's range). Only unfinished
 * sets are ever removed.
 */
export const MAX_SETS = 12;

export type SessionSources = {
  split: Split | null;
  /** The workout's own session plan, when it has one (swaps, reorders, flexible sessions). */
  plan?: WorkoutDayPlan | null;
};

/**
 * Groups the workout's sets into movements in session order, and picks the set
 * the next log applies to: the first unlogged set of the focused movement, or
 * else the next one in turn, with superset rounds alternating A1, B1, A2, B2
 * as on the web.
 */
export function buildSessionModel(
  workout: Workout | null,
  { split, plan = null }: SessionSources,
  focusedExerciseId: string | null,
  now = Date.now(),
): SessionModel | null {
  if (!workout || workout.completed) return null;
  const day = split?.days.find((candidate) => candidate.id === workout.split_day_id) ?? null;
  const items = sessionPlanItems(plan, workout.id);
  const flexible = workout.split_day_id === null && items !== undefined;
  const planned = sessionExercises(items, day?.exercises);
  const plans = new Map(planned.map((exercise) => [exercise.exercise_id, exercise]));
  const substitutions = sessionSubstitutions(items);
  const ranges = sessionSetRanges(planned);
  const notes = parseWorkoutNotes(workout.notes).movementNotes;
  // A movement taken out of a flexible session keeps its logged sets in the
  // totals but leaves the list, as on the web.
  const removed = new Set(flexible ? planned.filter((exercise) => exercise.hidden).map((exercise) => exercise.exercise_id) : []);

  // Grouped in session order; a Map keeps the order sets first appear in.
  const allSets = orderSessionSets(workout.sets, sessionOrder(planned));
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of allSets) {
    const list = byExercise.get(set.exercise_id) ?? [];
    list.push(set);
    byExercise.set(set.exercise_id, list);
  }
  const order = [...byExercise.keys()].filter((exerciseId) => !removed.has(exerciseId));
  const names = new Map([...byExercise].map(([exerciseId, sets]) => [exerciseId, sets[0]?.exercise?.name ?? 'Exercise']));

  const groups = new Map(
    planned.flatMap((exercise) => (exercise.superset_group_id && !exercise.hidden ? [[exercise.exercise_id, exercise.superset_group_id] as const] : [])),
  );
  const pairings = supersetFlows(order, groups);

  const movements: Movement[] = order.map((exerciseId) => {
    const sets = byExercise.get(exerciseId) ?? [];
    const flow = pairings.get(exerciseId);
    return {
      exerciseId,
      name: names.get(exerciseId) ?? 'Exercise',
      sets,
      done: sets.filter((set) => set.completed).length,
      plan: plans.get(exerciseId) ?? null,
      substitutesFor: substitutions.get(exerciseId) ?? null,
      range: ranges.get(exerciseId) ?? null,
      canAddSet: sets.length < MAX_SETS,
      canRemoveSet: sets.length > 1 && sets.some((set) => !set.completed),
      note: notes[exerciseId] ?? '',
      superset: flow
        ? { groupId: flow.groupId, role: flow.role, partnerId: flow.partnerExerciseId, partnerName: names.get(flow.partnerExerciseId) ?? 'Exercise' }
        : null,
    };
  });

  const sets = movements.flatMap((movement) => movement.sets);
  const focused = movements.find((movement) => movement.exerciseId === focusedExerciseId);
  const nextSet = focused?.sets.find((set) => !set.completed) ?? nextWorkoutSet(sets, order, undefined, undefined, pairings) ?? null;
  const chosen = nextSet ? movements.find((movement) => movement.exerciseId === nextSet.exercise_id) ?? null : null;

  return {
    workoutId: workout.id,
    date: workout.date,
    dayName: day?.day_name ?? (items && plan?.day_label ? plan.day_label : 'Workout'),
    flexible,
    startedAt: new Date(workout.created_at ?? now),
    sets: allSets,
    doneCount: allSets.filter((set) => set.completed).length,
    movements,
    current:
      chosen && nextSet
        ? {
            movement: chosen,
            set: nextSet,
            setNumber: chosen.sets.indexOf(nextSet) + 1,
            index: allSets.indexOf(nextSet),
            blocked: supersetLogBlock(nextSet, pairings.get(chosen.exerciseId), sets),
          }
        : null,
    pairings,
  };
}

/**
 * After a set is logged: the movement that is up next (a superset's partner
 * for the same round, else more of the same movement, else the next in turn),
 * and whether to rest. A superset rests only after B, as on the web.
 */
export function afterLoggedSet(
  session: Pick<SessionModel, 'movements' | 'pairings'>,
  logged: WorkoutSet,
  latestSets: readonly WorkoutSet[],
): { nextExerciseId: string | null; rest: boolean } {
  const order = session.movements.map((movement) => movement.exerciseId);
  const flow = session.pairings.get(logged.exercise_id);
  const listed = latestSets.filter((set) => order.includes(set.exercise_id));
  const next = nextWorkoutSet(listed, order, logged, flow, session.pairings);
  return { nextExerciseId: next?.exercise_id ?? null, rest: !flow || flow.role === 'B' };
}
