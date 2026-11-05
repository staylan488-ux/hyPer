import type { WorkoutSet } from '@/types';

export interface AutofillSetValues {
  weight: string;
  reps: string;
  rpe: string;
  source: 'current_workout' | 'previous_workout';
}

/** Targets keyed by exercise and its 1-based set position, not superset round. */
export type PreviousWorkoutSetMap = Record<string, Record<number, Pick<WorkoutSet, 'weight' | 'reps' | 'rpe'>>>;

type SetPosition = Pick<WorkoutSet, 'exercise_id' | 'set_number'>;

/** A swap keeps its superset round in storage; compare by this movement's set position. */
export function previousSetTarget<T>(
  set: SetPosition,
  currentSets: readonly SetPosition[],
  previous: Record<string, Record<number, T | undefined> | undefined>,
): T | undefined {
  const earlier = new Set(currentSets
    .filter((candidate) => candidate.exercise_id === set.exercise_id && candidate.set_number < set.set_number)
    .map((candidate) => candidate.set_number));
  return previous[set.exercise_id]?.[earlier.size + 1];
}

function toInputValue(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  // Loads are saved to the hundredth (46.25), so keep both decimals.
  return String(Math.round(value * 100) / 100);
}

function hasAnyValue(set: Pick<WorkoutSet, 'weight' | 'reps' | 'rpe'> | null | undefined): boolean {
  return Boolean(set) && [set?.weight, set?.reps, set?.rpe].some((value) => value !== null && value !== undefined);
}

export function getSetAutofillValues({
  exerciseId,
  setNumber,
  currentExerciseSets,
  previousWorkoutSetsByExercise,
}: {
  exerciseId: string;
  setNumber: number;
  currentExerciseSets: WorkoutSet[];
  previousWorkoutSetsByExercise: PreviousWorkoutSetMap;
}): AutofillSetValues | null {
  // A movement's first set here starts from last time. A superset swap's sets
  // keep the round they took over, so its first can be past 1.
  if (setNumber <= 1 || !currentExerciseSets.some((set) => set.set_number < setNumber)) {
    const previousWorkoutSet = previousSetTarget({ exercise_id: exerciseId, set_number: setNumber }, currentExerciseSets, previousWorkoutSetsByExercise);
    if (!hasAnyValue(previousWorkoutSet)) return null;

    return {
      weight: toInputValue(previousWorkoutSet?.weight ?? null),
      reps: toInputValue(previousWorkoutSet?.reps ?? null),
      rpe: toInputValue(previousWorkoutSet?.rpe ?? null),
      source: 'previous_workout',
    };
  }

  const previousCompletedSet = [...currentExerciseSets]
    .filter((set) => set.completed && set.set_number < setNumber)
    .sort((a, b) => b.set_number - a.set_number)[0];

  if (!hasAnyValue(previousCompletedSet)) return null;

  return {
    weight: toInputValue(previousCompletedSet.weight),
    reps: toInputValue(previousCompletedSet.reps),
    rpe: toInputValue(previousCompletedSet.rpe),
    source: 'current_workout',
  };
}
