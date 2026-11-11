// Smart set targets: one weight and one rep count for each set of a movement,
// worked out from the person's own recent sessions on it. Pure: no I/O, no
// clock (the day comes in as `today`).
//
// The rule (approved 2026-11-11, plan "hyPer adaptive features plan"):
// 1. One weight for every set of a movement that day.
// 2. Go up in weight as soon as every set would still land inside the rep
//    range at the next weight up (by the app's own estimate, calculateE1RM).
// 3. Until then, add one rep to one set that is not yet at the top of the range.
// 4. If every set is at the top and the next weight is still too big a jump,
//    reps run past the top until it fits.
// Bad days, breaks and stalls follow the table in the plan: one session below
// target repeats the target, two in a row match what was done, more than
// three weeks away matches last time, three sessions without a gain mark the
// movement stalled.
import { calculateE1RM } from '@/lib/workoutProgress';

/** One logged set of a past session, as saved. Zero is a real value. */
export type PastSet = { weight: number | null; reps: number | null; rpe?: number | null };

/**
 * One past session of a movement: its sets by the movement's own set
 * position (index 0 is set 1). `null` is a slot that was never logged.
 */
export type PastSession = { workoutId: string; date: string; sets: ReadonlyArray<PastSet | null> };

/** Past sessions per exercise id, newest first. */
export type MovementHistoryMap = Record<string, PastSession[]>;

export type RepRange = { min: number; max: number };

/** Why a set's target is what it is. The set card turns this into one line. */
export type TargetWhy =
  /** This set gets the extra rep (or two, after an easy set). */
  | { kind: 'more_reps'; reps: number }
  /** Same as last time: another set gets the extra rep today. */
  | { kind: 'hold' }
  /** Up a weight step; `allTop` when every set had reached the top of the range. */
  | { kind: 'more_weight'; step: number; allTop: boolean; top: number | null }
  /** Every set is at the top, but the next weight is still too big a jump. */
  | { kind: 'past_top'; reps: number; nextWeight: number | null }
  /** Last session fell short: the same target again. */
  | { kind: 'repeat' }
  /** Match what was done last time: after two short sessions, or a break. */
  | { kind: 'match'; cause: 'missed_twice' | 'break' }
  /** Moved during the session: to the weight in use today, or with how an earlier set went. */
  | { kind: 'moved'; cause: 'weight' | 'reps' };

export type TargetFigures = { weight: number; reps: number };
export type SetTarget = TargetFigures & { why: TargetWhy };

export type MovementTargets = {
  /** By set position (index 0 is set 1); null where a set gets no target. */
  sets: Array<SetTarget | null>;
  /** Three sessions in a row without a gain (wave 3's Monday review reads it). */
  stalled: boolean;
  /** The weight step used for "the next weight up", in pounds. */
  step: number;
};

export type TargetOptions = {
  /** Reps under the estimate after a weight increase (never below the range). */
  margin: number;
  /** Which set gets the extra rep: the first not at the top, or the one furthest below it. */
  extraRep: 'first' | 'lowest';
  /** Days away after which the target matches last time. */
  breakDays: number;
  /** Sessions in a row without a gain before a movement reads as stalled. */
  stallSessions: number;
  /** An RPE at or under this lets the target step two reps. */
  easyRpe: number;
  /** Which logged set later sets move with during a session: set 1 (the replay's pick), or the latest. */
  follow: 'first' | 'latest';
};

export const DEFAULT_TARGET_OPTIONS: TargetOptions = {
  margin: 1,
  extraRep: 'first',
  breakDays: 21,
  stallSessions: 3,
  easyRpe: 7,
  follow: 'first',
};

const EPSILON = 1e-6;
const WEIGHT_TOLERANCE = 0.01;
const E1RM_TOLERANCE = 0.25;
/** Below this a gap between two logged weights is a typo or a unit slip, not a real step. */
const MIN_STEP = 1.25;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A logged set with a rep count: something to aim from. A 0-rep set (a hold, a miss) is not. */
function usable(set: PastSet | null | undefined): set is { weight: number; reps: number; rpe?: number | null } {
  return Boolean(set)
    && typeof set!.weight === 'number' && Number.isFinite(set!.weight) && set!.weight >= 0
    && typeof set!.reps === 'number' && Number.isFinite(set!.reps) && set!.reps > 0;
}

function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

/** Whole days from `from` to `to` (both yyyy-MM-dd), or null when either can't be read. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** Reps the estimate gives at `weight` for a set of `from`: weight × (1 + reps ÷ 30), solved for reps. */
export function repsAtWeight(from: TargetFigures, weight: number): number | null {
  const e1rm = calculateE1RM(from.weight, from.reps);
  if (e1rm === null || weight <= 0) return null;
  return 30 * (e1rm / weight - 1);
}

/** The step a weight goes up by when equipment alone has to decide: 5 lb for everything (pounds only). */
export function defaultWeightStep(equipment?: string | null): number {
  void equipment;
  return 5;
}

/**
 * "The next weight up" on this movement: the smallest gap between the
 * distinct weights the person has logged on it. With too little history, the
 * equipment's default. A gap bigger than the default needs three logged
 * weights to count (two could be any two days), and is never over 4 steps.
 */
export function learnWeightStep(history: readonly PastSession[], equipment?: string | null): number {
  const fallback = defaultWeightStep(equipment);
  const weights = new Set<number>();
  for (const session of history) {
    for (const set of session.sets) {
      if (usable(set) && set.weight > 0) weights.add(round2(set.weight));
    }
  }
  const sorted = [...weights].sort((a, b) => a - b);
  let smallest = Infinity;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = round2(sorted[index] - sorted[index - 1]);
    if (gap >= MIN_STEP && gap < smallest) smallest = gap;
  }
  if (!Number.isFinite(smallest)) return fallback;
  if (smallest <= fallback) return smallest;
  return sorted.length >= 3 && smallest <= fallback * 4 ? smallest : fallback;
}

type Base = Array<{ weight: number; reps: number; rpe: number | null } | null>;

/**
 * A set done at another weight than the session's working weight (a ramp-up
 * set, a drop set) takes the reps of the nearest set at the working weight,
 * the one before it first. Converting by the estimate gave silly targets for
 * light ramp-up sets, which are not hard sets (40 × 15 read as 50 × 6 for
 * someone who then did 50 × 16).
 */
function repsAtWorkingWeight(sets: PastSession['sets'], position: number, weight: number): number {
  const atWeight = (index: number) => {
    const set = sets[index];
    return usable(set) && Math.abs(set.weight - weight) <= WEIGHT_TOLERANCE ? set.reps : null;
  };
  for (let index = position - 1; index >= 0; index -= 1) {
    const reps = atWeight(index);
    if (reps !== null) return reps;
  }
  for (let index = position + 1; index < sets.length; index += 1) {
    const reps = atWeight(index);
    if (reps !== null) return reps;
  }
  return sets[position]?.reps ?? 1;
}

/**
 * A session's sets laid out for `setCount` positions under one weight: the
 * weight used on most sets (the heavier on a tie). Extra positions, and slots
 * never logged, take the last known set's figures. A 0-rep set keeps its
 * position with no figures.
 */
function baseFrom(session: PastSession, setCount: number): Base | null {
  const sets = session.sets;
  const counts = new Map<number, number>();
  for (const set of sets) {
    if (usable(set)) counts.set(round2(set.weight), (counts.get(round2(set.weight)) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let weight = -1;
  let most = 0;
  for (const [candidate, count] of counts) {
    if (count > most || (count === most && candidate > weight)) {
      weight = candidate;
      most = count;
    }
  }
  const base: Base = [];
  let lastKnown: { weight: number; reps: number; rpe: number | null } | null = null;
  for (let position = 0; position < setCount; position += 1) {
    const set = sets[position];
    if (usable(set)) {
      const reps = Math.abs(set.weight - weight) > WEIGHT_TOLERANCE ? repsAtWorkingWeight(sets, position, weight) : set.reps;
      lastKnown = { weight, reps, rpe: typeof set.rpe === 'number' && Number.isFinite(set.rpe) ? set.rpe : null };
      base.push(lastKnown);
    } else if (set && position < sets.length) {
      // Logged with no reps: a hold or a miss gets no target.
      base.push(null);
    } else {
      base.push(lastKnown ? { ...lastKnown } : null);
    }
  }
  // Slots before the first known set (a swap that joined late) take the first one's figures.
  const first = base.find((set) => set !== null);
  if (!first) return null;
  for (let position = 0; position < base.length; position += 1) {
    if (base[position] !== null) break;
    const set = sets[position];
    if (!set) base[position] = { ...first };
  }
  return base;
}

function sameFigures(base: Base, why: TargetWhy): Array<SetTarget | null> {
  return base.map((set) => (set ? { weight: set.weight, reps: set.reps, why } : null));
}

/** The next session's targets from a base, by the rule at the top of this file. */
function progress(base: Base, range: RepRange | null, step: number, options: TargetOptions): Array<SetTarget | null> {
  const known = base.filter((set): set is NonNullable<typeof set> => set !== null);
  if (known.length === 0) return base.map(() => null);
  const weight = known[0].weight;
  const bodyweight = weight <= 0;

  // Rule 2: a weight step once every set would still land in the range.
  if (range && !bodyweight && Number.isFinite(step) && step > 0) {
    const next = round2(weight + step);
    const landing = base.map((set) => (set ? repsAtWeight(set, next) : null));
    const allLand = landing.every((reps, index) => base[index] === null || (reps !== null && reps >= range.min - EPSILON));
    if (allLand) {
      const allTop = known.every((set) => set.reps >= range.max);
      const why: TargetWhy = { kind: 'more_weight', step: round2(step), allTop, top: allTop ? range.max : null };
      return base.map((set, index) => {
        const estimate = landing[index];
        if (!set || estimate === null) return null;
        const reps = Math.min(range.max, Math.max(range.min, Math.floor(estimate - options.margin + EPSILON)));
        return { weight: next, reps, why };
      });
    }
  }

  const top = range?.max ?? null;
  const notAtTop = top === null ? [] : base.flatMap((set, index) => (set && set.reps < top ? [index] : []));
  let chosen: number;
  let pastTop = false;
  if (notAtTop.length > 0) {
    chosen = options.extraRep === 'lowest'
      ? notAtTop.reduce((best, index) => (base[index]!.reps < base[best]!.reps ? index : best), notAtTop[0])
      : notAtTop[0];
  } else {
    // Rule 4 (and any movement with no range, or bodyweight past its range):
    // bring sets up to the best one, then set 1 again.
    pastTop = true;
    const most = Math.max(...known.map((set) => set.reps));
    const behind = base.findIndex((set) => set !== null && set.reps < most);
    chosen = behind >= 0 ? behind : base.findIndex((set) => set !== null);
  }
  const chosenSet = base[chosen]!;
  const easy = chosenSet.rpe !== null && chosenSet.rpe <= options.easyRpe;
  let add = easy ? 2 : 1;
  if (!pastTop && top !== null) add = Math.min(add, top - chosenSet.reps);
  const nextWeight = range && !bodyweight && Number.isFinite(step) && step > 0 ? round2(weight + step) : null;
  const moreWhy: TargetWhy = pastTop && range && !bodyweight
    ? { kind: 'past_top', reps: add, nextWeight }
    : { kind: 'more_reps', reps: add };
  return base.map((set, index) => {
    if (!set) return null;
    if (index === chosen) return { weight: set.weight, reps: set.reps + add, why: moreWhy };
    return { weight: set.weight, reps: set.reps, why: { kind: 'hold' } };
  });
}

/** Whether a done set reaches its target: as many reps at the weight or more, or a heavier set the estimate puts level. */
export function setReachesTarget(done: TargetFigures, target: TargetFigures): boolean {
  if (done.weight >= target.weight - WEIGHT_TOLERANCE && done.reps >= target.reps) return true;
  if (done.weight > target.weight + WEIGHT_TOLERANCE) {
    const doneMax = calculateE1RM(done.weight, done.reps);
    const targetMax = calculateE1RM(target.weight, target.reps);
    return doneMax !== null && targetMax !== null && doneMax >= targetMax - E1RM_TOLERANCE;
  }
  return false;
}

/**
 * A session met its targets when every set it logged against one reached it,
 * or when it moved reps between sets at the target weight without losing any.
 * Null when nothing compares (no target, nothing logged).
 */
function sessionMet(session: PastSession, targets: ReadonlyArray<SetTarget | null>): boolean | null {
  let compared = 0;
  let allHit = true;
  let allAtWeight = true;
  let doneReps = 0;
  let targetReps = 0;
  targets.forEach((target, index) => {
    const done = session.sets[index];
    if (!target || !done || typeof done.weight !== 'number' || typeof done.reps !== 'number') return;
    compared += 1;
    if (!setReachesTarget({ weight: done.weight, reps: done.reps }, target)) allHit = false;
    if (done.weight < target.weight - WEIGHT_TOLERANCE) allAtWeight = false;
    doneReps += done.reps;
    targetReps += target.reps;
  });
  if (compared === 0) return null;
  return allHit || (allAtWeight && doneReps >= targetReps);
}

/** A session's level for stall checks: its mean estimated max, or mean reps for bodyweight work. */
function sessionLevel(session: PastSession): number | null {
  const sets = session.sets.filter(usable);
  if (sets.length === 0) return null;
  const loaded = sets.filter((set) => set.weight > 0);
  if (loaded.length > 0) {
    return loaded.reduce((sum, set) => sum + (calculateE1RM(set.weight, set.reps) ?? 0), 0) / loaded.length;
  }
  return sets.reduce((sum, set) => sum + set.reps, 0) / sets.length;
}

/**
 * Whether a session was done at a different weight altogether from its
 * target: more than two steps and more than a tenth away.
 */
function movedWeight(done: Base, given: ReadonlyArray<SetTarget | null>, step: number): boolean {
  const doneWeight = done.find((set) => set !== null)?.weight;
  const targetWeight = given.find((set) => set !== null)?.weight;
  if (doneWeight === undefined || targetWeight === undefined) return false;
  const gap = Math.abs(doneWeight - targetWeight);
  return gap > 2 * step + WEIGHT_TOLERANCE && gap > 0.1 * Math.max(doneWeight, targetWeight);
}

type Walk = {
  last: PastSession;
  base: Base;
  mode: 'progress' | 'repeat' | 'match';
  /** The target the last session was given, for a repeat. */
  lastTargets: Array<SetTarget | null> | null;
  misses: number;
  best: number | null;
  noGain: number;
};

function targetsFor(walk: Walk, date: string, setCount: number, range: RepRange | null, step: number, options: TargetOptions): Array<SetTarget | null> {
  const gap = daysBetween(walk.last.date, date);
  if (gap !== null && gap > options.breakDays) {
    const base = baseFrom(walk.last, setCount);
    return base ? sameFigures(base, { kind: 'match', cause: 'break' }) : Array.from({ length: setCount }, () => null);
  }
  if (walk.mode === 'repeat' && walk.lastTargets) {
    const repeated = walk.lastTargets.map((target) => (target ? { weight: target.weight, reps: target.reps, why: { kind: 'repeat' } as TargetWhy } : null));
    return Array.from({ length: setCount }, (_, index) => {
      if (index < repeated.length) return repeated[index];
      const lastKnown = [...repeated].reverse().find((target) => target !== null);
      return lastKnown ? { ...lastKnown } : null;
    });
  }
  const base = walk.base.length === setCount ? walk.base : resize(walk.base, setCount);
  if (walk.mode === 'match') return sameFigures(base, { kind: 'match', cause: 'missed_twice' });
  return progress(base, range, step, options);
}

function resize(base: Base, setCount: number): Base {
  const out: Base = [];
  let lastKnown: Base[number] = null;
  for (let index = 0; index < setCount; index += 1) {
    if (index < base.length) {
      out.push(base[index]);
      if (base[index]) lastKnown = base[index];
    } else {
      out.push(lastKnown ? { ...lastKnown } : null);
    }
  }
  return out;
}

/**
 * Today's targets for one movement. `history` is its past sessions, newest
 * first (as the previous-sets read keeps them). Null when there is nothing to
 * aim from: no history, or no set with reps in it.
 *
 * With no rep range (a flexible session's movement with none set), the weight
 * never goes up on its own: reps climb one at a time and the person moves the
 * weight. That is the safer of the two choices; a range guessed from the
 * person's own sets could push a weight on a range nobody chose.
 */
export function planMovementTargets({
  history,
  today,
  setCount,
  range,
  equipment = null,
  options: partial,
}: {
  history: readonly PastSession[];
  today: string;
  setCount: number;
  range: RepRange | null;
  equipment?: string | null;
  options?: Partial<TargetOptions>;
}): MovementTargets | null {
  const options = { ...DEFAULT_TARGET_OPTIONS, ...partial };
  const count = Math.max(0, Math.floor(setCount));
  if (count === 0) return null;
  const cleanRange = range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min > 0 && range.max >= range.min
    ? range
    : null;
  const step = learnWeightStep(history, equipment);
  const sessions = [...history].reverse().filter((session) => session.sets.some(usable));
  if (sessions.length === 0) return null;

  let walk: Walk | null = null;
  for (const session of sessions) {
    const width = Math.max(count, session.sets.length);
    if (!walk) {
      const base = baseFrom(session, width);
      if (!base) continue;
      walk = { last: session, base, mode: 'progress', lastTargets: null, misses: 0, best: sessionLevel(session), noGain: 0 };
      continue;
    }
    const given = targetsFor(walk, session.date, session.sets.length, cleanRange, step, options);
    const done = baseFrom(session, width);
    if (done && movedWeight(done, given, step)) {
      // A different weight altogether (another machine, a new start): what was
      // done becomes the new starting point, not a miss to repeat.
      walk = { last: session, base: done, mode: 'progress', lastTargets: null, misses: 0, best: sessionLevel(session), noGain: 0 };
      continue;
    }
    const met = sessionMet(session, given);
    const level = sessionLevel(session);
    const improved = level !== null && (walk.best === null || level > walk.best + E1RM_TOLERANCE);
    const progressed = met === true && given.some((target) => target && (target.why.kind !== 'match' && target.why.kind !== 'hold'));
    walk.noGain = improved || progressed ? 0 : walk.noGain + 1;
    if (level !== null && (walk.best === null || level > walk.best)) walk.best = level;
    walk.last = session;
    if (met === false) {
      walk.misses += 1;
      if (walk.misses === 1) {
        walk.mode = 'repeat';
        walk.lastTargets = given;
        continue;
      }
      walk.mode = 'match';
      walk.base = done ?? walk.base;
      walk.lastTargets = null;
      continue;
    }
    walk.misses = 0;
    walk.mode = 'progress';
    walk.lastTargets = null;
    walk.base = done ?? walk.base;
  }
  if (!walk) return null;
  const sets = targetsFor(walk, today, count, cleanRange, step, options).slice(0, count);
  if (sets.every((set) => set === null)) return null;
  return { sets, stalled: walk.noGain >= options.stallSessions, step };
}

/** A logged set this session, by the movement's own set position (index 0 is set 1). */
export type LoggedSet = { weight: number; reps: number } | null;

/**
 * One set's target once part of the session is logged. `position` is 1-based.
 *
 * Later sets keep the planned drop from set to set, moved by how an earlier
 * set went (`options.follow`: set 1, or the latest set logged):
 * - on the planned weight, when it landed 2 or more reps off its target;
 * - on another weight (the person's call wins: one weight for the movement),
 *   always, at that weight. Converting by the estimate across a big weight
 *   change gave silly targets (70 × 1, 45 × 38) in the replay.
 */
export function liveSetTarget(
  targets: MovementTargets | null | undefined,
  logged: ReadonlyArray<LoggedSet>,
  position: number,
  options: Pick<TargetOptions, 'follow'> = DEFAULT_TARGET_OPTIONS,
): SetTarget | null {
  const planned = targets?.sets[position - 1] ?? null;
  if (!planned || !targets) return null;
  const candidates = logged.slice(0, position - 1).flatMap((set, index) => {
    const target = targets.sets[index];
    return set && target && set.reps > 0 && set.weight >= 0 ? [{ index, set, target }] : [];
  });
  const anchor = options.follow === 'first' ? candidates.find((candidate) => candidate.index === 0) : candidates[candidates.length - 1];
  if (!anchor) return planned;
  const off = anchor.set.reps - anchor.target.reps;
  if (Math.abs(anchor.set.weight - anchor.target.weight) > WEIGHT_TOLERANCE) {
    return { weight: anchor.set.weight, reps: Math.max(1, planned.reps + off), why: { kind: 'moved', cause: 'weight' } };
  }
  if (Math.abs(off) >= 2) {
    return { weight: planned.weight, reps: Math.max(1, planned.reps + off), why: { kind: 'moved', cause: 'reps' } };
  }
  return planned;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];
const count = (value: number, noun: string) => `${NUMBER_WORDS[value] ?? value} ${noun}${value === 1 ? '' : 's'}`;
const pounds = (value: number) => `${round2(value)} lb`;

/** The one quiet line under the set: "one more rep than last time". */
export function describeTarget(target: SetTarget): string {
  const why = target.why;
  switch (why.kind) {
    case 'more_reps':
      return `${count(why.reps, 'more rep')} than last time`;
    case 'hold':
      return 'same as last time';
    case 'more_weight':
      return why.allTop && why.top !== null
        ? `up ${pounds(why.step)}, every set reached ${why.top}`
        : `up ${pounds(why.step)}, every set stays in range`;
    case 'past_top':
      return why.nextWeight !== null
        ? `${count(why.reps, 'more rep')}, ${pounds(why.nextWeight)} is too big a jump yet`
        : `${count(why.reps, 'more rep')} than last time`;
    case 'repeat':
      return 'same target as last time';
    case 'match':
      return why.cause === 'break' ? 'match last time after a break' : 'match last time';
    case 'moved':
      return why.cause === 'weight' ? 'at the weight you are using' : 'moved with how set 1 went';
  }
}

export type TargetOutcome = { kind: 'hit' } | { kind: 'beat'; gain: string } | { kind: 'missed' };

/** How a logged set did against its target: hit, beat ("+1 rep", "+5 lb") or missed. */
export function targetOutcome(done: TargetFigures, target: TargetFigures): TargetOutcome {
  if (!setReachesTarget(done, target)) return { kind: 'missed' };
  const heavier = round2(done.weight - target.weight);
  if (heavier > WEIGHT_TOLERANCE && done.reps >= target.reps) return { kind: 'beat', gain: `+${round2(heavier)} lb` };
  const more = done.reps - target.reps;
  if (Math.abs(heavier) <= WEIGHT_TOLERANCE && more > 0) return { kind: 'beat', gain: `+${more} rep${more === 1 ? '' : 's'}` };
  return { kind: 'hit' };
}
