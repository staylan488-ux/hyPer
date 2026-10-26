// Pure: the live workout as the screens need it. No React, no React Native, so
// the web test suite can cover it (tests/nativeSessionModel.test.ts).
import type { Split, SplitExercise, Workout, WorkoutSet } from '@/types';

export type Movement = {
  exerciseId: string;
  name: string;
  sets: WorkoutSet[];
  done: number;
  plan: SplitExercise | null;
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
 * Groups the workout's sets into movements in program order, and picks the set
 * the next log applies to: the first unlogged set of the focused movement, or
 * of the first movement with one left.
 */
export function buildSessionModel(
  workout: Workout | null,
  split: Split | null,
  focusedExerciseId: string | null,
  now = Date.now(),
): SessionModel | null {
  if (!workout || workout.completed) return null;
  const day = split?.days.find((candidate) => candidate.id === workout.split_day_id) ?? null;
  const plans = new Map(day?.exercises.map((exercise) => [exercise.exercise_id, exercise]) ?? []);

  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of workout.sets) {
    const list = byExercise.get(set.exercise_id) ?? [];
    list.push(set);
    byExercise.set(set.exercise_id, list);
  }

  // Map keeps first-appearance order, the fallback for movements without a plan.
  const movements: Movement[] = [...byExercise.entries()]
    .map(([exerciseId, sets], appearance) => {
      const ordered = [...sets].sort((a, b) => a.set_number - b.set_number);
      return {
        appearance,
        movement: {
          exerciseId,
          name: ordered[0]?.exercise?.name ?? 'Exercise',
          sets: ordered,
          done: ordered.filter((set) => set.completed).length,
          plan: plans.get(exerciseId) ?? null,
        },
      };
    })
    .sort((a, b) => {
      const orderA = a.movement.plan?.exercise_order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.movement.plan?.exercise_order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB || a.appearance - b.appearance;
    })
    .map(({ movement }) => movement);

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
    dayName: day?.day_name ?? 'Workout',
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
