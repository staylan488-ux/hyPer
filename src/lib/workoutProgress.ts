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
  rpe?: number | string | null;
}

export type SetPerformanceResult = 'beat' | 'matched' | 'below' | 'unknown';

const WEIGHT_TOLERANCE = 0.01;
const REP_TOLERANCE = 0.01;
const E1RM_TOLERANCE = 0.25;

export function toFiniteNumber(value: unknown): number | null {
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

  // Zero is a real result: bodyweight work logs 0 lb, and a failed first rep logs 0 reps.
  if (weight === null || reps === null || weight < 0 || reps < 0) {
    return null;
  }

  return { weight, reps };
}

/**
 * Whether typed set fields can be saved: weight and reps may be 0 (a
 * bodyweight movement, or an attempt that failed on the first rep); RPE is
 * optional.
 */
export function isLoggableSetEntry(weight: string, reps: string, rpe: string): boolean {
  const weightValue = Number(weight);
  const repsValue = Number(reps);
  const rpeValue = Number(rpe);
  return weight.trim() !== '' && Number.isFinite(weightValue) && weightValue >= 0
    && reps.trim() !== '' && Number.isInteger(repsValue) && repsValue >= 0
    && (rpe.trim() === '' || (Number.isFinite(rpeValue) && rpeValue >= 1 && rpeValue <= 10));
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
    // Two failed attempts at different loads: neither lifted anything.
    if (currentSet.reps <= REP_TOLERANCE) return 'unknown';
    return currentSet.weight > previousSet.weight ? 'beat' : 'below';
  }

  const currentE1RM = calculateE1RM(currentSet.weight, currentSet.reps);
  const previousE1RM = calculateE1RM(previousSet.weight, previousSet.reps);

  if (currentE1RM === null || previousE1RM === null) {
    // A 0-rep set has no estimated max, so only call it when one set has
    // both more weight and more reps than the other.
    if (currentSet.weight > previousSet.weight && currentSet.reps > previousSet.reps) return 'beat';
    if (currentSet.weight < previousSet.weight && currentSet.reps < previousSet.reps) return 'below';
    return 'unknown';
  }

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

function formatAmount(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Short, honest description of how a set beat its previous-workout target:
 * "+5 lb", "+2 reps", "+10 lb · +1 rep", or "+6 lb est. max" when reps were
 * traded for weight (estimated one-rep max still rose).
 * Null unless the comparison is a clear beat.
 */
export function describeSetGain(current: SetPerformanceInput, previous: SetPerformanceInput): string | null {
  if (compareSetPerformance(current, previous) !== 'beat') return null;
  const now = toComparableSet(current);
  const then = toComparableSet(previous);
  if (!now || !then) return null;

  if (approximatelyEqual(now.weight, then.weight, WEIGHT_TOLERANCE)) {
    const reps = now.reps - then.reps;
    return `+${formatAmount(reps)} ${Math.abs(reps - 1) < REP_TOLERANCE ? 'rep' : 'reps'}`;
  }
  if (approximatelyEqual(now.reps, then.reps, REP_TOLERANCE)) {
    return `+${formatAmount(now.weight - then.weight)} lb`;
  }
  const weightGain = now.weight - then.weight;
  const repGain = now.reps - then.reps;
  if (weightGain > 0 && repGain > 0) {
    return `+${formatAmount(weightGain)} lb · +${formatAmount(repGain)} ${Math.abs(repGain - 1) < REP_TOLERANCE ? 'rep' : 'reps'}`;
  }
  // Traded reps for weight (or the reverse) and still came out stronger.
  const gain = (calculateE1RM(now.weight, now.reps) ?? 0) - (calculateE1RM(then.weight, then.reps) ?? 0);
  return gain > 0 ? `+${formatAmount(gain)} lb est. max` : null;
}

export interface SessionGain {
  exerciseId: string;
  setNumber: number;
  gain: string;
}

/**
 * Every completed set in a session that beat the same set last workout, in
 * the order given. `previous` is keyed by exercise id, then set number.
 */
export function collectSessionGains(
  sets: Array<SetPerformanceInput & { exercise_id: string; set_number: number; completed?: boolean | null }>,
  previous: Record<string, Record<number, SetPerformanceInput | undefined> | undefined>,
): SessionGain[] {
  const gains: SessionGain[] = [];
  for (const set of sets) {
    if (!set.completed) continue;
    const target = previous[set.exercise_id]?.[set.set_number];
    if (!target) continue;
    const gain = describeSetGain(set, target);
    if (gain) gains.push({ exerciseId: set.exercise_id, setNumber: set.set_number, gain });
  }
  return gains;
}

/** Total completed load (weight × reps) for a session, in the logged unit. */
export function sessionTonnage(sets: Array<SetPerformanceInput & { completed?: boolean | null }>): number {
  return sets.reduce((sum, set) => {
    if (!set.completed) return sum;
    const comparable = toComparableSet(set);
    return comparable ? sum + comparable.weight * comparable.reps : sum;
  }, 0);
}
