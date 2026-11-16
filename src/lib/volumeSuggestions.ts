/**
 * One-tap fixes for a program whose main muscle sits in the low band, as plain
 * data the program editor and the program builder both use. Applying one is a
 * pure step on the editor's draft.
 *
 * A fix is offered only under the floor (4 sets a week), and it aims past it:
 * the floor is the least that grows a muscle measurably, not the goal, so one
 * tap adds what one movement can take toward about 10.
 */
import {
  MAIN_MUSCLES,
  VOLUME_AIM,
  VOLUME_BAND_EDGES,
  dayVolume,
  lowMainMuscles,
  muscleLabel,
  plannedMovementSets,
  programVolume,
  volumeMuscle,
  type MainMuscle,
} from '@/lib/muscleVolume';
import { dayLabel, newDraftExercise, type DraftDay, type DraftExercise, type DraftSplit } from '@/lib/splitDraft';
import type { Exercise } from '@/types';

/** A suggestion never takes a movement past this many sets. */
export const MAX_SUGGESTED_SETS = 5;

interface SuggestionBase {
  muscle: MainMuscle;
  /** "Side delts" */
  label: string;
  dayId: string;
  /** "Push A", or "Day 2" for an unnamed day. */
  dayName: string;
  /** The muscle's sets a week now, and after this suggestion. */
  setsBefore: number;
  setsAfter: number;
  /** "Add a set to Cable Lateral Raise on Push A" */
  title: string;
}

export type VolumeSuggestion =
  | (SuggestionBase & {
    kind: 'raise';
    /** The draft row raised. */
    draftExerciseId: string;
    exerciseName: string;
    fromSets: number;
    toSets: number;
  })
  | (SuggestionBase & {
    kind: 'add';
    exercise: Exercise;
    sets: number;
  });

/**
 * Library movements offered for each main muscle, best first. Every name is
 * in the seeded library (tests/volumeSuggestions.test.ts checks schema.sql and
 * the migrations). Only names the account's library holds are offered.
 */
export const SUGGESTED_MOVEMENTS: Readonly<Record<MainMuscle, readonly string[]>> = {
  chest: ['Incline Dumbbell Bench Press', 'Flat Dumbbell Bench Press', 'Machine Chest Press', 'Cable Fly', 'Push-Up'],
  back: ['Seated Cable Row', 'Lat Pulldown', 'One-Arm Dumbbell Row', 'Pull-Up'],
  quads: ['Leg Press', 'Hack Squat', 'Goblet Squat', 'Leg Extension', 'Bulgarian Split Squat'],
  hamstrings: ['Lying Leg Curl', 'Seated Leg Curl', 'Romanian Deadlift', 'Dumbbell Romanian Deadlift'],
  glutes: ['Hip Thrust', '45° Back Extension', 'Cable Glute Kickback'],
  side_delts: ['Lateral Raise', 'Cable Lateral Raise', 'Machine Lateral Raise'],
  biceps: ['Dumbbell Curl', 'Cable Curl', 'Barbell Curl', 'Hammer Curl'],
  triceps: ['Tricep Pushdown', 'Overhead Tricep Extension', 'Rope Pushdown', 'Dips'],
};

export interface VolumeSuggestionOptions {
  /**
   * Most sets a day may hold (the program builder's session length). A
   * suggestion never takes a day past it; without it, days have no limit.
   */
  maxDaySets?: number;
  /**
   * The sets a week a suggestion works toward. Left out, about 10. The
   * program builder passes the floor, so room goes round its muscles.
   */
  aim?: number;
}

/** Sets a day can still take under the options' limit. */
function roomOn(day: DraftDay, options: VolumeSuggestionOptions): number {
  return options.maxDaySets === undefined ? Infinity : options.maxDaySets - daySets(day);
}

const LOWER_BODY = new Set(['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'tibialis', 'hip_flexors']);

function region(muscle: string | null): 'upper' | 'lower' | 'any' {
  if (!muscle || muscle === 'core') return 'any';
  return LOWER_BODY.has(muscle) ? 'lower' : 'upper';
}

function primaryOf(exercise: DraftExercise): string | null {
  return volumeMuscle(exercise.exercise?.muscle_group);
}

function daySets(day: DraftDay): number {
  return day.exercises.reduce((sum, exercise) => sum + plannedMovementSets(exercise), 0);
}

function setsWord(count: number): string {
  return count === 1 ? 'a set' : `${count} sets`;
}

/** Raise a movement the program already has for the muscle, the one with the most room on the lightest day. */
function raiseFor(draft: DraftSplit, muscle: MainMuscle, have: number, need: number, options: VolumeSuggestionOptions): VolumeSuggestion | null {
  let best: { day: DraftDay; index: number; exercise: DraftExercise; sets: number; dayTotal: number } | null = null;
  draft.days.forEach((day, index) => {
    const dayTotal = daySets(day);
    if (roomOn(day, options) < 1) return;
    for (const exercise of day.exercises) {
      if (primaryOf(exercise) !== muscle) continue;
      const sets = plannedMovementSets(exercise);
      if (sets >= MAX_SUGGESTED_SETS) continue;
      if (!best || sets < best.sets || (sets === best.sets && dayTotal < best.dayTotal)) {
        best = { day, index, exercise, sets, dayTotal };
      }
    }
  });
  if (!best) return null;
  const { day, index, exercise, sets } = best as { day: DraftDay; index: number; exercise: DraftExercise; sets: number };
  const added = Math.min(need, MAX_SUGGESTED_SETS - sets, roomOn(day, options));
  const dayName = dayLabel(day, index);
  return {
    kind: 'raise',
    muscle,
    label: muscleLabel(muscle),
    dayId: day.id,
    dayName,
    draftExerciseId: exercise.id,
    exerciseName: exercise.exercise.name,
    fromSets: sets,
    toSets: sets + added,
    setsBefore: have,
    setsAfter: have + added,
    title: `Add ${setsWord(added)} to ${exercise.exercise.name} on ${dayName}`,
  };
}

function libraryCandidates(muscle: MainMuscle, library: readonly Exercise[], equipment: ReadonlySet<string>): Exercise[] {
  const offered = library.filter((exercise) => !exercise.retired_at && exercise.category !== 'calisthenics');
  const byName = new Map(offered.map((exercise) => [exercise.name.toLowerCase(), exercise]));
  const named = SUGGESTED_MOVEMENTS[muscle].flatMap((name) => byName.get(name.toLowerCase()) ?? []);
  // A library without any of the staples still offers its own movements for the muscle.
  const candidates = named.length ? named : offered.filter((exercise) => volumeMuscle(exercise.muscle_group) === muscle);
  // Prefer equipment the program already uses.
  const fits = (exercise: Exercise) => !exercise.equipment || exercise.equipment === 'bodyweight' || equipment.has(exercise.equipment);
  return [...candidates.filter(fits), ...candidates.filter((exercise) => !fits(exercise))];
}

/** Add a library movement to the lightest day that already trains that part of the body. */
function addFor(draft: DraftSplit, muscle: MainMuscle, have: number, need: number, library: readonly Exercise[], options: VolumeSuggestionOptions): VolumeSuggestion | null {
  if (!draft.days.length) return null;
  const equipment = new Set(draft.days.flatMap((day) => day.exercises.flatMap((entry) => entry.exercise?.equipment ?? [])));
  const candidates = libraryCandidates(muscle, library, equipment);
  if (!candidates.length) return null;

  // A new movement needs room for at least 2 sets.
  const days = draft.days
    .map((day, index) => ({ day, index, total: daySets(day) }))
    .filter(({ day }) => roomOn(day, options) >= 2);
  const suits = days.filter(({ day }) => day.exercises.some((exercise) => {
    const area = region(primaryOf(exercise));
    return area === 'any' || area === region(muscle);
  }));
  const pool = (suits.length ? suits : days).sort((a, b) => a.total - b.total || a.index - b.index);

  for (const exercise of candidates) {
    const target = pool.find(({ day }) => !day.exercises.some((entry) => entry.exercise_id === exercise.id));
    if (!target) continue;
    const sets = Math.min(Math.max(2, Math.min(3, need)), roomOn(target.day, options));
    // A compound's second muscle may be this one; count only what lands here.
    const gained = dayVolume({ exercises: [{ exercise, target_sets: sets }] }).get(muscle) ?? 0;
    if (gained <= 0) continue;
    const dayName = dayLabel(target.day, target.index);
    return {
      kind: 'add',
      muscle,
      label: muscleLabel(muscle),
      dayId: target.day.id,
      dayName,
      exercise,
      sets,
      setsBefore: have,
      setsAfter: have + gained,
      title: `Add ${sets} sets of ${exercise.name} to ${dayName}`,
    };
  }
  return null;
}

/**
 * One suggestion for each main muscle in the low band, most needed first:
 * raise a movement the program already has for it, otherwise add one from
 * the library. A muscle with neither gets none.
 */
export function volumeSuggestions(draft: DraftSplit, library: readonly Exercise[], options: VolumeSuggestionOptions = {}): VolumeSuggestion[] {
  const sets = programVolume(draft);
  const aim = Math.max(VOLUME_BAND_EDGES.solidFrom, options.aim ?? VOLUME_AIM);
  return lowMainMuscles(sets).flatMap((row) => {
    const muscle = row.muscle as MainMuscle;
    const need = Math.max(1, Math.ceil(aim - row.sets));
    return raiseFor(draft, muscle, row.sets, need, options) ?? addFor(draft, muscle, row.sets, need, library, options) ?? [];
  });
}

/** The draft with one suggestion applied. A suggestion that no longer fits the draft changes nothing. */
export function applyVolumeSuggestion(draft: DraftSplit, suggestion: VolumeSuggestion): DraftSplit {
  const dayIndex = draft.days.findIndex((day) => day.id === suggestion.dayId);
  if (dayIndex < 0) return draft;
  const day = draft.days[dayIndex];

  let exercises: DraftExercise[];
  if (suggestion.kind === 'raise') {
    const at = day.exercises.findIndex((exercise) => exercise.id === suggestion.draftExerciseId);
    if (at < 0) return draft;
    const current = day.exercises[at];
    if (plannedMovementSets(current) !== suggestion.fromSets) return draft;
    const target = suggestion.toSets;
    exercises = day.exercises.map((exercise, index) => (index !== at ? exercise : {
      ...exercise,
      target_sets: target,
      target_sets_min: Math.min(exercise.target_sets_min, target),
      target_sets_max: Math.max(exercise.target_sets_max, target),
    }));
  } else {
    if (day.exercises.some((exercise) => exercise.exercise_id === suggestion.exercise.id)) return draft;
    exercises = [...day.exercises, newDraftExercise(suggestion.exercise, day.exercises.length, {
      target_sets: suggestion.sets,
      target_sets_min: suggestion.sets,
      target_sets_max: suggestion.sets,
    })];
  }

  const days = [...draft.days];
  days[dayIndex] = { ...day, exercises };
  return { ...draft, days };
}

/**
 * Applies the first suggestion until none remain. Every step raises a low
 * muscle by at least one set and nothing ever falls, so it ends; the step cap
 * only guards against a library that changes underneath.
 */
export function applyAllVolumeSuggestions(
  draft: DraftSplit,
  library: readonly Exercise[],
  maxSteps = MAIN_MUSCLES.length * VOLUME_BAND_EDGES.solidFrom * 2,
  options: VolumeSuggestionOptions = {},
): DraftSplit {
  let current = draft;
  for (let step = 0; step < maxSteps; step += 1) {
    const [first] = volumeSuggestions(current, library, options);
    if (!first) break;
    const next = applyVolumeSuggestion(current, first);
    if (next === current) break;
    current = next;
  }
  return current;
}
