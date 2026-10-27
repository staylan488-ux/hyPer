// Pure: the live workout as the screens need it. No React, no React Native, so
// the web test suite can cover it (tests/nativeSessionModel.test.ts). Order,
// targets and swaps follow the shared session plan rules (src/lib/sessionPlan),
// the same ones the web Train page uses.
import {
  orderSessionSets,
  sessionExercises,
  sessionOrder,
  sessionPlanItems,
  sessionSetRanges,
  sessionSubstitutions,
  type SessionExercise,
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
};

export type SessionModel = {
  workoutId: string;
  date: string;
  dayName: string;
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
  } | null;
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
 * of the first movement with one left.
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
  const planned = sessionExercises(items, day?.exercises);
  const plans = new Map(planned.map((exercise) => [exercise.exercise_id, exercise]));
  const substitutions = sessionSubstitutions(items);
  const ranges = sessionSetRanges(planned);
  const notes = parseWorkoutNotes(workout.notes).movementNotes;

  // Grouped in session order; a Map keeps the order sets first appear in.
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of orderSessionSets(workout.sets, sessionOrder(planned))) {
    const list = byExercise.get(set.exercise_id) ?? [];
    list.push(set);
    byExercise.set(set.exercise_id, list);
  }

  const movements: Movement[] = [...byExercise.entries()].map(([exerciseId, sets]) => {
    return {
      exerciseId,
      name: sets[0]?.exercise?.name ?? 'Exercise',
      sets,
      done: sets.filter((set) => set.completed).length,
      plan: plans.get(exerciseId) ?? null,
      substitutesFor: substitutions.get(exerciseId) ?? null,
      range: ranges.get(exerciseId) ?? null,
      canAddSet: sets.length < MAX_SETS,
      canRemoveSet: sets.length > 1 && sets.some((set) => !set.completed),
      note: notes[exerciseId] ?? '',
    };
  });

  const sets = movements.flatMap((movement) => movement.sets);
  const unfinished = (movement: Movement) => movement.sets.some((set) => !set.completed);
  const chosen =
    movements.find((movement) => movement.exerciseId === focusedExerciseId && unfinished(movement)) ??
    movements.find(unfinished) ??
    null;
  const nextSet = chosen?.sets.find((set) => !set.completed) ?? null;

  return {
    workoutId: workout.id,
    date: workout.date,
    dayName: day?.day_name ?? (items && plan?.day_label ? plan.day_label : 'Workout'),
    startedAt: new Date(workout.created_at ?? now),
    sets,
    doneCount: sets.filter((set) => set.completed).length,
    movements,
    current:
      chosen && nextSet
        ? { movement: chosen, set: nextSet, setNumber: chosen.sets.indexOf(nextSet) + 1, index: sets.indexOf(nextSet) }
        : null,
  };
}
