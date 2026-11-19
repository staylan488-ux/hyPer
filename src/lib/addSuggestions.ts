/**
 * What fits when a movement is added to the live workout.
 *
 * Swapping opens on the closest matches (src/lib/swapSuggestions.ts). Adding
 * used to open on the whole library. This leads the list with up to three
 * movements, one for each of the muscles today's session trains that has the
 * most of its week still open, each with the week's count for that muscle as
 * Progress shows it.
 *
 * It states a count and stops (owner decision, 2026-11-12): nothing here
 * says behind, missed or short, counts days, or appears before the person has
 * chosen to add something. Pure. What the choices rest on is in
 * docs/training-volume.md, "Add opens on what fits".
 */
import { movementProfile, patternNearness, type MovementProfile } from '@/lib/movementProfiles';
import {
  MAIN_MUSCLES,
  VOLUME_AIM,
  addMovementSets,
  formatSetCount,
  muscleLabel,
  volumeMuscle,
  type MainMuscle,
  type MuscleSets,
} from '@/lib/muscleVolume';
import { SUGGESTED_MOVEMENTS } from '@/lib/volumeSuggestions';
import type { Exercise } from '@/types';

/** How many movements lead the Add list. */
export const ADD_FIT_LIMIT = 3;

/** One movement of today's session, with its sets logged and still to do. */
export interface SessionMovementSets {
  exercise: Pick<Exercise, 'id' | 'name' | 'equipment' | 'muscle_group' | 'muscle_group_secondary'>;
  done: number;
  left: number;
}

export interface AddFitInput<T extends Exercise = Exercise> {
  /** The movements on offer: the library without what the workout already holds. */
  library: readonly T[];
  /** Today's session so far. */
  session: readonly SessionMovementSets[];
  /** A planned session keeps to the muscles its day trains; a flexible one may reach across the same half of the body. */
  flexible: boolean;
  /** Finished sets this training week in every other workout, per muscle. */
  elsewhere: MuscleSets;
  /** The week's planned sets per muscle, as Progress counts them; null with no plan. */
  planned: MuscleSets | null;
  /** Movements the person's program holds on any day: known ground, offered first. */
  programExerciseIds?: ReadonlySet<string>;
  /** Adding a superset: the movement the pick alternates with. */
  pairWith?: Pick<Exercise, 'id' | 'name' | 'equipment' | 'muscle_group' | 'muscle_group_secondary'> | null;
}

export interface AddFit<T extends Exercise = Exercise> {
  exercise: T;
  muscle: MainMuscle;
  /** The muscle's finished sets this week, today's included. */
  done: number;
  /** Its planned sets this week; null with no plan for it. */
  planned: number | null;
  /** "Hamstrings · 3 of 8 sets so far this week" */
  line: string;
}

const LOWER_BODY: ReadonlySet<string> = new Set(['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);
const half = (muscle: string): 'lower' | 'upper' | 'any' => (muscle === 'core' ? 'any' : LOWER_BODY.has(muscle) ? 'lower' : 'upper');

function musclesOf(exercise: SessionMovementSets['exercise']): string[] {
  return [volumeMuscle(exercise.muscle_group), volumeMuscle(exercise.muscle_group_secondary)].filter((muscle): muscle is string => Boolean(muscle));
}

/** "3 of 8 sets so far this week", "none yet this week", "1 set so far this week". */
export function weekCountLine(done: number, planned: number | null): string {
  const count = formatSetCount(done);
  if (planned && planned > 0) return `${count} of ${formatSetCount(planned)} sets so far this week`;
  if (!(done > 0)) return 'none yet this week';
  return `${count} ${count === '1' ? 'set' : 'sets'} so far this week`;
}

// Scores for choosing one movement for a muscle. Judgments, written out.
const IN_PROGRAM = 4; // a movement the person already trains
const STAPLE_TOP = 3; // the first of the muscle's staples (volumeSuggestions), each later one half a point less
const SAME_PATTERN = 2; // times the nearness to a movement already in the session: a second curl adds less than a different movement
const HARD_TO_LOAD = 2;

/**
 * Up to three movements to lead the Add list, most open muscle first; empty
 * when no muscle that fits has room. With `pairWith`, movements that do not
 * train what the paired movement trains.
 */
export function suggestAdds<T extends Exercise>(input: AddFitInput<T>): AddFit<T>[] {
  const { library, session, flexible, elsewhere, planned, programExerciseIds, pairWith = null } = input;

  // The week so far, and what today's unlogged sets will still add.
  const done: MuscleSets = new Map(elsewhere);
  const coming: MuscleSets = new Map();
  for (const movement of session) {
    addMovementSets(done, movement.exercise, movement.done);
    addMovementSets(coming, movement.exercise, movement.left);
  }

  const today = new Set(session.flatMap((movement) => musclesOf(movement.exercise)));
  const halves = new Set<string>([...today].map(half).filter((area) => area !== 'any'));
  const paired = pairWith ? new Set(musclesOf(pairWith)) : null;
  const pairProfile = pairWith ? movementProfile(pairWith) : null;
  const pairHalf = pairWith ? half(volumeMuscle(pairWith.muscle_group) ?? 'core') : 'any';

  const fits = (muscle: MainMuscle): boolean => {
    if (paired) return !paired.has(muscle) && (pairHalf === 'any' || half(muscle) === pairHalf);
    if (session.length === 0) return true;
    return flexible ? halves.size === 0 || halves.has(half(muscle)) : today.has(muscle);
  };

  const open = MAIN_MUSCLES.filter(fits)
    .map((muscle, order) => {
      const have = (done.get(muscle) ?? 0) + (coming.get(muscle) ?? 0);
      const plan = planned?.get(muscle) ?? 0;
      // With a plan for the muscle, the room is what the week still holds; without, how far it is from the usual aim.
      const room = (plan > 0 ? plan : VOLUME_AIM) - have;
      return { muscle, order, room, planned: plan > 0 ? plan : null };
    })
    .filter((entry) => entry.room >= 1)
    .sort((a, b) => b.room - a.room || a.order - b.order);

  const sessionProfiles = session.map((movement) => movementProfile(movement.exercise)).filter((profile): profile is MovementProfile => profile !== null);
  const offered = library.filter((exercise) => !exercise.retired_at && exercise.category !== 'calisthenics');
  const picked = new Set<string>();
  const result: AddFit<T>[] = [];

  for (const entry of open) {
    if (result.length >= ADD_FIT_LIMIT) break;
    const staples = SUGGESTED_MOVEMENTS[entry.muscle].map((name) => name.toLowerCase());
    let best: { exercise: T; score: number } | null = null;
    for (const exercise of offered) {
      if (picked.has(exercise.id) || volumeMuscle(exercise.muscle_group) !== entry.muscle) continue;
      const profile = movementProfile(exercise);
      // A superset partner must leave the paired movement's muscles alone, and not load the lower back twice.
      if (paired) {
        if (musclesOf(exercise).some((muscle) => paired.has(muscle))) continue;
        if (profile?.loadsLowerBack && pairProfile?.loadsLowerBack) continue;
      }
      const staple = staples.indexOf(exercise.name.toLowerCase());
      const inProgram = programExerciseIds?.has(exercise.id) ?? false;
      // Only movements with a reason to lead: the person's own, or a staple for the muscle.
      if (!inProgram && staple < 0) continue;
      const nearest = profile ? Math.max(0, ...sessionProfiles.map((other) => patternNearness(profile.pattern, other.pattern))) : 0;
      const score =
        (inProgram ? IN_PROGRAM : 0) +
        (staple >= 0 ? Math.max(0, STAPLE_TOP - staple * 0.5) : 0) -
        nearest * SAME_PATTERN -
        (profile?.hardToLoad ? HARD_TO_LOAD : 0);
      if (!best || score > best.score || (score === best.score && exercise.name.localeCompare(best.exercise.name) < 0)) best = { exercise, score };
    }
    if (!best) continue;
    picked.add(best.exercise.id);
    const weekDone = done.get(entry.muscle) ?? 0;
    result.push({
      exercise: best.exercise,
      muscle: entry.muscle,
      done: weekDone,
      planned: entry.planned,
      line: `${muscleLabel(entry.muscle)} · ${weekCountLine(weekDone, entry.planned)}`,
    });
  }
  return result;
}
