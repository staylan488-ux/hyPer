export interface SetPerformanceInput {
  weight: number | string | null | undefined;
  reps: number | string | null | undefined;
}

export interface PreviousWorkoutSummary {
  id: string;
}

export interface PreviousSetSummary {
  workout_id: string;
  exercise_id: string;
  set_number: number | string;
  weight: number | string | null;
  reps: number | string | null;
}

export type SetPerformanceResult = 'beat' | 'matched' | 'below' | 'unknown';

const WEIGHT_TOLERANCE = 0.01;
const REP_TOLERANCE = 0.01;
const E1RM_TOLERANCE = 0.25;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toComparableSet(input: SetPerformanceInput): { weight: number; reps: number } | null {
  const weight = toFiniteNumber(input.weight);
  const reps = toFiniteNumber(input.reps);

  if (weight === null || reps === null || weight < 0 || reps <= 0) {
    return null;
  }

  return { weight, reps };
}

function approximatelyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function calculateE1RM(weight: number, reps: number): number | null {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight < 0 || reps <= 0) {
    return null;
  }

  return weight * (1 + reps / 30);
}

export function compareSetPerformance(current: SetPerformanceInput, previous: SetPerformanceInput): SetPerformanceResult {
  const currentSet = toComparableSet(current);
  const previousSet = toComparableSet(previous);

  if (!currentSet || !previousSet) return 'unknown';

  const sameWeight = approximatelyEqual(currentSet.weight, previousSet.weight, WEIGHT_TOLERANCE);
  const sameReps = approximatelyEqual(currentSet.reps, previousSet.reps, REP_TOLERANCE);

  if (sameWeight && sameReps) return 'matched';

  if (sameWeight) {
    return currentSet.reps > previousSet.reps ? 'beat' : 'below';
  }

  if (sameReps) {
    return currentSet.weight > previousSet.weight ? 'beat' : 'below';
  }

  const currentE1RM = calculateE1RM(currentSet.weight, currentSet.reps);
  const previousE1RM = calculateE1RM(previousSet.weight, previousSet.reps);

  if (currentE1RM === null || previousE1RM === null) return 'unknown';

  if (currentE1RM > previousE1RM + E1RM_TOLERANCE) return 'beat';
  if (currentE1RM < previousE1RM - E1RM_TOLERANCE) return 'below';
  return 'matched';
}

export function formatSetPerformanceTarget(input: SetPerformanceInput): string {
  const comparable = toComparableSet(input);
  if (!comparable) return '';

  const formattedWeight = Number.isInteger(comparable.weight)
    ? String(comparable.weight)
    : comparable.weight.toFixed(1);

  const formattedReps = Number.isInteger(comparable.reps)
    ? String(comparable.reps)
    : comparable.reps.toFixed(1);

  return `${formattedWeight} × ${formattedReps}`;
}
