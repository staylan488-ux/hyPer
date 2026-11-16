// Pure: the live workout's set targets, from the shared rule in
// src/lib/setTargets and each movement's recent sessions (the same read as
// "last time"). No React, so the root test suite covers it
// (tests/nativeSetTargets.test.ts). Targets fail soft: when one can't be
// worked out, the set behaves as it did before targets.
import {
  describeTarget,
  liveSetTarget,
  planMovementTargets,
  targetOutcome,
  type EffortWords,
  type LoggedSet,
  type MovementHistoryMap,
  type MovementTargets,
  type SetTarget,
} from '@/lib/setTargets';
import type { WorkoutSet } from '@/types';

import type { Movement, SessionModel } from './sessionModel';

export type SessionTargets = ReadonlyMap<string, MovementTargets>;

const NO_TARGETS: SessionTargets = new Map();

/** Today's targets for each movement of the session that has history to aim from. */
export function sessionTargets(session: Pick<SessionModel, 'date' | 'movements'> | null, history: MovementHistoryMap): SessionTargets {
  if (!session) return NO_TARGETS;
  const targets = new Map<string, MovementTargets>();
  for (const movement of session.movements) {
    const planned = movementTargets(movement, session.date, history);
    if (planned) targets.set(movement.exerciseId, planned);
  }
  return targets;
}

function movementTargets(movement: Movement, date: string, history: MovementHistoryMap): MovementTargets | null {
  const past = history[movement.exerciseId];
  if (!past || past.length === 0) return null;
  const min = movement.plan?.target_reps_min;
  const max = movement.plan?.target_reps_max;
  const range = typeof min === 'number' && typeof max === 'number' && min > 0 && max >= min ? { min, max } : null;
  const equipment = movement.sets.find((set) => set.exercise)?.exercise?.equipment ?? null;
  try {
    return planMovementTargets({ history: past, today: date, setCount: setPositions(movement.sets).length, range, equipment });
  } catch {
    return null;
  }
}

/**
 * A movement's sets by its own set position (1-based in the result's order),
 * counted as "last time" counts them: one position per set number.
 */
function setPositions(sets: readonly Pick<WorkoutSet, 'set_number'>[]): number[] {
  return [...new Set(sets.map((set) => set.set_number))].sort((a, b) => a - b);
}

/** This movement's logged sets by position, for moving later targets during the session. */
function loggedByPosition(sets: readonly WorkoutSet[]): LoggedSet[] {
  return setPositions(sets).map((number) => {
    const set = sets.find((candidate) => candidate.set_number === number && candidate.completed);
    return set && typeof set.weight === 'number' && typeof set.reps === 'number' ? { weight: set.weight, reps: set.reps } : null;
  });
}

/**
 * The target for one set of a movement, given what is logged so far this
 * session (only sets before it count). Null when the set has none.
 */
export function setTargetFor(
  set: Pick<WorkoutSet, 'exercise_id' | 'set_number'>,
  movementSets: readonly WorkoutSet[],
  targets: SessionTargets,
): SetTarget | null {
  const planned = targets.get(set.exercise_id);
  if (!planned) return null;
  const position = setPositions(movementSets).indexOf(set.set_number) + 1;
  if (position === 0) return null;
  try {
    return liveSetTarget(planned, loggedByPosition(movementSets).map((logged, index) => (index < position - 1 ? logged : null)), position);
  } catch {
    return null;
  }
}

/**
 * "100 × 11": a target's figures; a bodyweight target names its reps alone.
 * With `units`, "100 lb × 11 reps", for VoiceOver.
 */
export function targetFigures(target: SetTarget, units = false): string {
  const reps = `${target.reps} ${target.reps === 1 ? 'rep' : 'reps'}`;
  if (target.weight <= 0) return reps;
  const weight = Math.round(target.weight * 100) / 100;
  return units ? `${weight} lb × ${reps}` : `${weight} × ${target.reps}`;
}

/** Whether a set is the movement's last, by its own set position. */
export function isLastSet(set: Pick<WorkoutSet, 'set_number'>, movementSets: readonly Pick<WorkoutSet, 'set_number'>[]): boolean {
  const positions = setPositions(movementSets);
  return positions.length > 0 && positions[positions.length - 1] === set.set_number;
}

/**
 * The line's first word. A target is a floor, and the movement's last set is
 * where going past it costs nothing later: there it reads "Target, or more".
 * Not after a miss or a break, where the target is already the ask.
 */
export function targetLabel(target: SetTarget, lastSet: boolean): string {
  const why = target.why;
  const open = why.kind === 'more_reps' || why.kind === 'hold' || why.kind === 'more_weight' || why.kind === 'past_top'
    || (why.kind === 'moved' && why.off >= 0);
  return lastSet && open ? 'Target, or more' : 'Target';
}

/**
 * The card's one line: "Target · one more rep than last time". `scale` is
 * how the person rates a set, for a line that names last time's rating.
 */
export function targetLine(target: SetTarget, { scale = 'rir', lastSet = false }: { scale?: EffortWords; lastSet?: boolean } = {}): string {
  return `${targetLabel(target, lastSet)} · ${describeTarget(target, scale)}`;
}

/** What the card says once a set is logged against its target, or null when it missed. */
export function targetMoment(done: { weight: number; reps: number }, target: SetTarget): string | null {
  const outcome = targetOutcome(done, target);
  if (outcome.kind === 'missed') return null;
  return outcome.kind === 'hit' ? 'Target hit' : `Beat target · ${outcome.gain}`;
}

/** How a session did against its targets: logged sets that had one, and how many reached it. */
export function countTargets(session: Pick<SessionModel, 'movements'>, targets: SessionTargets): { hit: number; total: number } {
  let hit = 0;
  let total = 0;
  for (const movement of session.movements) {
    for (const set of movement.sets) {
      if (!set.completed || typeof set.weight !== 'number' || typeof set.reps !== 'number') continue;
      const target = setTargetFor(set, movement.sets, targets);
      if (!target) continue;
      total += 1;
      if (targetOutcome({ weight: set.weight, reps: set.reps }, target).kind !== 'missed') hit += 1;
    }
  }
  return { hit, total };
}
