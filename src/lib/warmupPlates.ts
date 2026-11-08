// Warm-up sets and the plates for a barbell weight, in pounds (Train logs in
// pounds). Warm-ups are guidance only: they are never logged, so they stay
// out of volume, "Last time" and Beat last time.

/** The plates loaded on each side, heaviest first: 45s, quarters, dimes, nickels and 2.5s. */
export const PLATES_LB = [45, 25, 10, 5, 2.5] as const;

/** An Olympic bar. */
export const DEFAULT_BAR_LB = 45;

/** The bars offered: Olympic, a 15 kg bar, an EZ or fixed curl bar and a light technique bar. */
export const BAR_CHOICES_LB = [45, 35, 25, 15] as const;

const EPSILON = 1e-6;

type MovementKind = { name?: string | null; equipment?: string | null };

const BARBELL = /barbell|smith|\bez[- ]?bar|\bez\b|trap bar|hex bar/i;
const EZ_BAR = /\bez[- ]?bar|\bez\b/i;

/** A movement loaded with plates on a bar, by its equipment or name. */
export function isBarbellMovement(exercise: MovementKind | null | undefined): boolean {
  if (!exercise) return false;
  return BARBELL.test(exercise.equipment ?? '') || BARBELL.test(exercise.name ?? '');
}

/** The bar a movement starts with before the person picks one: an EZ bar is about 25 lb, any other 45. */
export function defaultBarFor(exercise: MovementKind | null | undefined): number {
  if (exercise && (EZ_BAR.test(exercise.name ?? '') || EZ_BAR.test(exercise.equipment ?? ''))) return 25;
  return DEFAULT_BAR_LB;
}

export type PlateLoad = {
  /** Plates on each side, heaviest first (empty for the bar alone). */
  perSide: number[];
  /** What the bar weighs with them on. */
  total: number;
  /** The target can be loaded exactly; otherwise `total` is the closest below it. */
  exact: boolean;
};

/**
 * The plates for each side of the bar to reach `target`, fewest first (each
 * side takes the heaviest plate that still fits). Null below the bar's own
 * weight or for a weight that isn't a number. A target between plate steps
 * loads the closest weight under it.
 */
export function loadPlates(target: number, bar: number, plates: readonly number[] = PLATES_LB): PlateLoad | null {
  if (!Number.isFinite(target) || !Number.isFinite(bar) || bar < 0 || target < bar - EPSILON) return null;
  let side = (target - bar) / 2;
  const perSide: number[] = [];
  for (const plate of plates) {
    while (side >= plate - EPSILON) {
      perSide.push(plate);
      side -= plate;
    }
  }
  const loaded = perSide.reduce((sum, plate) => sum + plate, 0);
  const total = Math.round((bar + loaded * 2) * 100) / 100;
  return { perSide, total, exact: Math.abs(total - target) < EPSILON };
}

/** "45 · 25 · 2.5", the plates on one side; same plates repeat ("45 · 45"). */
export function describePlates(perSide: readonly number[]): string {
  return perSide.map(formatPounds).join(' · ');
}

/** A weight as it reads in Train: whole pounds bare, halves with one decimal. */
export function formatPounds(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

export type WarmupStep = {
  weight: number;
  reps: number;
  /** The empty bar, which reads as "Bar" rather than its weight. */
  bar: boolean;
};

/** Barbell ramp: the bar, then these shares of the working weight for fewer reps each time. */
const BARBELL_RAMP: readonly (readonly [share: number, reps: number])[] = [
  [0.4, 5],
  [0.6, 3],
  [0.8, 2],
];
/** Dumbbells, machines and cables need less: two lighter sets. */
const OTHER_RAMP: readonly (readonly [share: number, reps: number])[] = [
  [0.5, 8],
  [0.75, 4],
];
/** Steps closer than this to each other, or to the working weight, are left out. */
const BARBELL_GAP = 10;
const OTHER_GAP = 5;
/** Below this a dumbbell or machine movement needs no warm-up. */
const OTHER_MINIMUM = 20;

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** How far a barbell warm-up may move from its share to load with fewer plates. */
const barbellReach = (target: number) => (target >= 100 ? 10 : 5);

/**
 * The barbell weight for a warm-up near `target`: of the 5 lb steps within
 * reach that keep their distance from the step before and the working weight,
 * the one needing the fewest plates (so 95 rather than 90, one 25 a side),
 * then the closest. Null when none fits.
 */
function barbellStep(target: number, previous: number, working: number, bar: number): number | null {
  const reach = barbellReach(target);
  let best: { weight: number; plates: number; distance: number } | null = null;
  for (let weight = Math.ceil((target - reach) / 5) * 5; weight <= target + reach + EPSILON; weight += 5) {
    if (weight - previous < BARBELL_GAP || working - weight < BARBELL_GAP) continue;
    const load = loadPlates(weight, bar);
    if (!load?.exact) continue;
    const candidate = { weight, plates: load.perSide.length, distance: Math.abs(weight - target) };
    if (!best || candidate.plates < best.plates || (candidate.plates === best.plates && candidate.distance < best.distance)) best = candidate;
  }
  return best?.weight ?? null;
}

/**
 * Warm-up sets before a movement's first working set at `working` pounds.
 * Barbell: the empty bar for 10, then about 40%, 60% and 80% for 5, 3 and 2,
 * each moved up to 10 lb to load with fewer plates (225 ramps 95, 135, 185).
 * Anything else: about 50% for 8 and 75% for 4, on 5 lb steps. A step too
 * close to the one before or to the working weight is left out, so a light
 * movement gets fewer.
 */
export function warmupSteps({ working, barbell, bar = DEFAULT_BAR_LB }: { working: number; barbell: boolean; bar?: number }): WarmupStep[] {
  if (!Number.isFinite(working) || working <= 0) return [];
  if (barbell) {
    if (working - bar < BARBELL_GAP) return [];
    const steps: WarmupStep[] = [{ weight: bar, reps: 10, bar: true }];
    for (const [share, reps] of BARBELL_RAMP) {
      const weight = barbellStep(working * share, steps[steps.length - 1].weight, working, bar);
      if (weight !== null) steps.push({ weight, reps, bar: false });
    }
    return steps;
  }
  if (working < OTHER_MINIMUM) return [];
  const steps: WarmupStep[] = [];
  for (const [share, reps] of OTHER_RAMP) {
    const weight = roundTo(working * share, 5);
    const previous = steps.length > 0 ? steps[steps.length - 1].weight : 0;
    if (weight < 5 || weight - previous < OTHER_GAP || working - weight < OTHER_GAP) continue;
    steps.push({ weight, reps, bar: false });
  }
  return steps;
}

/**
 * Whether the set card offers warm-ups: the movement's first set with nothing
 * of it logged yet, on a barbell or compound movement with a weight to work
 * up to. Isolation work on dumbbells, machines and cables goes straight in.
 */
export function offersWarmup({
  setNumber,
  done,
  working,
  exercise,
  bar,
}: {
  setNumber: number;
  done: number;
  working: number | null;
  exercise: (MovementKind & { is_compound?: boolean | null }) | null | undefined;
  bar?: number;
}): boolean {
  if (setNumber !== 1 || done > 0 || working === null || !exercise) return false;
  if ((exercise.equipment ?? '').trim().toLowerCase() === 'bodyweight') return false;
  const barbell = isBarbellMovement(exercise);
  if (!barbell && !exercise.is_compound) return false;
  return warmupSteps({ working, barbell, bar: bar ?? defaultBarFor(exercise) }).length > 0;
}

// ── The bar each movement uses, kept on this device per account ──

type BarStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Bar weights by exercise id. */
export type BarWeights = Record<string, number>;

const BAR_KEY_PREFIX = 'hyper:bar-weights:';

function storageOf(storage?: BarStorage | null): BarStorage | null {
  if (storage) return storage;
  return globalThis.localStorage ?? null;
}

const validBar = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 200;

/** The bars this account has picked, by movement. */
export function loadBarWeights(userId: string | null | undefined, storage?: BarStorage | null): BarWeights {
  const target = storageOf(storage);
  if (!target || !userId) return {};
  try {
    const parsed: unknown = JSON.parse(target.getItem(`${BAR_KEY_PREFIX}${userId}`) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    const result: BarWeights = {};
    for (const [exerciseId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (validBar(value)) result[exerciseId] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/** Keeps a movement's bar and answers the account's bars with it. */
export function saveBarWeight(userId: string | null | undefined, exerciseId: string, bar: number, storage?: BarStorage | null): BarWeights {
  const current = loadBarWeights(userId, storage);
  if (!validBar(bar)) return current;
  const next = { ...current, [exerciseId]: bar };
  const target = storageOf(storage);
  if (!target || !userId) return next;
  try {
    target.setItem(`${BAR_KEY_PREFIX}${userId}`, JSON.stringify(next));
  } catch {
    // Storage full or unavailable: the choice still holds for this launch.
  }
  return next;
}
