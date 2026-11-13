/**
 * The guided builder's last steps, after the template is chosen and shaped:
 * keep the person's own movements when they already have a program, then
 * fill by muscle until every main muscle is at least solid, inside a cap on
 * sets per session.
 *
 * Counting, bands and suggestions all come from the weekly-sets rules
 * (muscleVolume, volumeSuggestions); nothing here grades sets on its own.
 */
import {
  MAIN_MUSCLES,
  VOLUME_BAND_EDGES,
  isMainMuscle,
  lowMainMuscles,
  muscleLabel,
  plannedMovementSets,
  programVolume,
  volumeMuscle,
  type MainMuscle,
  type MuscleSets,
} from '@/lib/muscleVolume';
import {
  LOWER_BODY,
  SESSION_MINUTES,
  SESSION_SET_CAPS,
  WEEKLY_SET_TARGETS,
  weeklySetTarget,
  type EquipmentProfile,
  type ExperienceLevel,
  type ProgramFocus,
  type SessionLength,
} from '@/lib/programDesigner';
import { createTempId, type DraftExercise, type DraftSplit } from '@/lib/splitDraft';
import { SUGGESTED_MOVEMENTS, applyVolumeSuggestion, volumeSuggestions } from '@/lib/volumeSuggestions';
import type { Exercise } from '@/types';

// ── Limits ──────────────────────────────────────────────────────────

export { SESSION_MINUTES, SESSION_SET_CAPS };

/**
 * Where a beginner's guided plan starts each main muscle: about this many
 * sets a week, the low edge of solid (4 to 10), not the middle. It shapes the
 * plan the builder hands over and nothing else; the person can add any
 * number of sets, and no screen holds them to it.
 */
export const BEGINNER_STARTING_SETS = WEEKLY_SET_TARGETS.beginner;

/** Weekly sets a muscle keeps when sets are taken away for room: solid for a main muscle, 2 for the rest. */
function floorOf(muscle: string): number {
  return isMainMuscle(muscle) ? VOLUME_BAND_EDGES.solidFrom : 2;
}

/** True for a muscle the Emphasis answer does not favour: it gives up sets first and gets room last. */
function outsideFocus(muscle: string, focus: ProgramFocus): boolean {
  if (focus === 'upper_focus') return LOWER_BODY.has(muscle);
  if (focus === 'lower_focus') return !LOWER_BODY.has(muscle) && muscle !== 'core';
  return false;
}

// ── Draft helpers ───────────────────────────────────────────────────

function daySets(exercises: readonly DraftExercise[]): number {
  return exercises.reduce((sum, exercise) => sum + plannedMovementSets(exercise), 0);
}

/** A new set count; a movement without a set range keeps none. */
function withSets(exercise: DraftExercise, sets: number): DraftExercise {
  if (exercise.target_sets_min === exercise.target_sets_max) {
    return { ...exercise, target_sets: sets, target_sets_min: sets, target_sets_max: sets };
  }
  return {
    ...exercise,
    target_sets: sets,
    target_sets_min: Math.min(exercise.target_sets_min, sets),
    target_sets_max: Math.max(exercise.target_sets_max, sets),
  };
}

function replaceDay(draft: DraftSplit, dayIndex: number, exercises: DraftExercise[]): DraftSplit {
  const days = [...draft.days];
  days[dayIndex] = {
    ...days[dayIndex],
    exercises: exercises.map((exercise, order) => (exercise.exercise_order === order ? exercise : { ...exercise, exercise_order: order })),
  };
  return { ...draft, days };
}

function musclesOf(exercise: DraftExercise): { primary: string | null; secondary: string | null } {
  const primary = volumeMuscle(exercise.exercise?.muscle_group);
  const secondary = volumeMuscle(exercise.exercise?.muscle_group_secondary);
  return { primary, secondary: secondary === primary ? null : secondary };
}

// ── Taking sets away ────────────────────────────────────────────────

interface TakeOptions {
  focus: ProgramFocus;
  /** Never take below a muscle's floor. Without it, the cheapest set goes even when a muscle drops. */
  keepFloors: boolean;
  /** A muscle that must not lose sets (the one room is being made for). */
  protect?: string;
}

/**
 * The draft with one set taken from one day: from the muscle with the most
 * sets past its floor, favoured muscles last. A movement at one set leaves
 * the day. Null when nothing can go.
 */
function takeOneSet(draft: DraftSplit, dayIndex: number, sets: MuscleSets, options: TakeOptions): DraftSplit | null {
  const day = draft.days[dayIndex];
  let best: { at: number; score: number } | null = null;

  day.exercises.forEach((exercise, at) => {
    const current = plannedMovementSets(exercise);
    if (current < 1) return;
    const { primary, secondary } = musclesOf(exercise);
    if (!primary || primary === options.protect || secondary === options.protect) return;
    // The day's first movement keeps at least 2 sets, and nothing is removed while room can be found elsewhere.
    if (current === 1 && options.keepFloors) return;
    if (at === 0 && current <= 2) return;

    const primaryLeft = (sets.get(primary) ?? 0) - 1;
    const secondaryLeft = secondary ? (sets.get(secondary) ?? 0) - 0.5 : Infinity;
    const keepsFloors = primaryLeft >= floorOf(primary) && (!secondary || secondaryLeft >= floorOf(secondary));
    if (options.keepFloors && !keepsFloors) return;

    const weight = outsideFocus(primary, options.focus) ? 2 : 1;
    // Sets past the floor decide; a muscle that would drop under its floor goes last, a main one after the rest.
    let score = (primaryLeft + 1 - floorOf(primary)) * weight;
    if (!keepsFloors) score -= isMainMuscle(primary) ? 1000 : 500;
    // On a tie, the movement with the most sets, then the later one.
    score += current * 0.01 + at * 0.001;
    if (!best || score > best.score) best = { at, score };
  });

  if (!best) return null;
  const { at } = best as { at: number };
  const exercise = day.exercises[at];
  const current = plannedMovementSets(exercise);
  const exercises = current <= 1
    ? day.exercises.filter((_, index) => index !== at)
    : day.exercises.map((entry, index) => (index === at ? withSets(entry, current - 1) : entry));
  return replaceDay(draft, dayIndex, exercises);
}

/** Every day brought down to the cap, taking first from the muscles with the most to spare. */
export function trimToCap(draft: DraftSplit, cap: number, focus: ProgramFocus): DraftSplit {
  let current = draft;
  current.days.forEach((_, dayIndex) => {
    for (let guard = 0; guard < 100 && daySets(current.days[dayIndex].exercises) > cap; guard += 1) {
      const sets = programVolume(current);
      const next = takeOneSet(current, dayIndex, sets, { focus, keepFloors: true })
        ?? takeOneSet(current, dayIndex, sets, { focus, keepFloors: false });
      if (!next) break;
      current = next;
    }
  });
  return current;
}

/**
 * Main muscles past the starting count lose sets from their own movements,
 * never taking another muscle under its floor. The count is one number for
 * every muscle, or each muscle's own.
 */
export function trimToStartingSets(draft: DraftSplit, startingSets: number | ((muscle: MainMuscle) => number)): DraftSplit {
  const limit = typeof startingSets === 'number' ? () => startingSets : startingSets;
  let current = draft;
  for (let guard = 0; guard < 200; guard += 1) {
    const sets = programVolume(current);
    const over = MAIN_MUSCLES
      .filter((muscle) => (sets.get(muscle) ?? 0) > limit(muscle))
      .sort((a, b) => (sets.get(b) ?? 0) - (sets.get(a) ?? 0));
    let next: DraftSplit | null = null;
    for (const muscle of over) {
      // The movement of this muscle with the most sets (3 or more), latest on a tie.
      let pick: { dayIndex: number; at: number; sets: number } | null = null;
      current.days.forEach((day, dayIndex) => day.exercises.forEach((exercise, at) => {
        const { primary, secondary } = musclesOf(exercise);
        if (primary !== muscle) return;
        const movementSets = plannedMovementSets(exercise);
        // A movement keeps at least 2 sets.
        if (movementSets <= 2) return;
        if (secondary && (sets.get(secondary) ?? 0) - 0.5 < floorOf(secondary)) return;
        if (!pick || movementSets >= pick.sets) pick = { dayIndex, at, sets: movementSets };
      }));
      if (!pick) continue;
      const { dayIndex, at, sets: movementSets } = pick as { dayIndex: number; at: number; sets: number };
      const day = current.days[dayIndex];
      next = replaceDay(current, dayIndex, day.exercises.map((entry, index) => (index === at ? withSets(entry, movementSets - 1) : entry)));
      break;
    }
    if (!next) break;
    current = next;
  }
  return current;
}

// ── Filling ─────────────────────────────────────────────────────────

/** Applies the weekly-sets suggestions inside the cap, favoured muscles first, until none fit. */
function applySuggestions(draft: DraftSplit, library: readonly Exercise[], cap: number, focus: ProgramFocus): DraftSplit {
  let current = draft;
  for (let step = 0; step < MAIN_MUSCLES.length * VOLUME_BAND_EDGES.solidFrom * 2; step += 1) {
    const suggestions = volumeSuggestions(current, library, { maxDaySets: cap });
    const first = [...suggestions].sort((a, b) => Number(outsideFocus(a.muscle, focus)) - Number(outsideFocus(b.muscle, focus)))[0];
    if (!first) break;
    const next = applyVolumeSuggestion(current, first);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Frees up to 2 sets on one full day, taken from muscles with sets to spare,
 * so a suggestion for `muscle` fits there. Null when no day can make room.
 */
function makeRoom(draft: DraftSplit, library: readonly Exercise[], cap: number, focus: ProgramFocus, muscle: MainMuscle): DraftSplit | null {
  const before = programVolume(draft).get(muscle) ?? 0;
  for (let dayIndex = 0; dayIndex < draft.days.length; dayIndex += 1) {
    let trial: DraftSplit = draft;
    for (let freed = 0; freed < 2; freed += 1) {
      const next = takeOneSet(trial, dayIndex, programVolume(trial), { focus, keepFloors: true, protect: muscle });
      if (!next) break;
      trial = next;
      const suggestion = volumeSuggestions(trial, library, { maxDaySets: cap }).find((entry) => entry.muscle === muscle);
      if (!suggestion || suggestion.dayId !== draft.days[dayIndex].id) continue;
      const placed = applyVolumeSuggestion(trial, suggestion);
      if ((programVolume(placed).get(muscle) ?? 0) > before) return placed;
    }
  }
  return null;
}

export interface FillAnswers {
  focus: ProgramFocus;
  equipment: EquipmentProfile;
  sessionLength: SessionLength;
  experience: ExperienceLevel;
}

/** Library rows the builder may add: never retired, never a bodyweight skill, and only dumbbells or bodyweight for a dumbbells-only plan. */
export function builderLibrary(library: readonly Exercise[], equipment: EquipmentProfile): Exercise[] {
  return library.filter((exercise) => (
    !exercise.retired_at
    && exercise.category !== 'calisthenics'
    && (equipment === 'full_gym' || fitsDumbbellsOnly(exercise))
  ));
}

export function fitsDumbbellsOnly(exercise: Pick<Exercise, 'equipment'>): boolean {
  const equipment = exercise.equipment?.trim().toLowerCase();
  return equipment === 'dumbbells' || equipment === 'bodyweight';
}

/** Id prefix of a stand-in row: a template movement the library lacks, held in its slot until it is filled. */
export const STAND_IN_PREFIX = 'stand-in:';

export function isStandIn(exercise: Pick<Exercise, 'id'>): boolean {
  return exercise.id.startsWith(STAND_IN_PREFIX);
}

/**
 * A movement the plan's equipment rules out, a stand-in for a movement the
 * library lacks, or a second copy of one in a day, becomes another library
 * movement for the same muscle (the same role first, the suggestions'
 * staples before the rest) that the day lacks; with none, it leaves the day,
 * its name goes into `dropped`, and the fill makes up its sets.
 */
export function fitToLibrary(draft: DraftSplit, library: readonly Exercise[], equipment: EquipmentProfile, dropped: string[] = []): DraftSplit {
  const offered = builderLibrary(library, equipment);
  const staples = new Map<string, number>();
  for (const names of Object.values(SUGGESTED_MOVEMENTS)) names.forEach((name, index) => staples.set(name.toLowerCase(), index));
  const rank = (exercise: Exercise) => staples.get(exercise.name.toLowerCase()) ?? Infinity;

  let changed = false;
  const days = draft.days.map((day) => {
    const inDay = new Set<string>();
    const exercises = day.exercises.flatMap((slot): DraftExercise[] => {
      const fits = !isStandIn(slot.exercise) && (equipment === 'full_gym' || fitsDumbbellsOnly(slot.exercise));
      if (fits && !inDay.has(slot.exercise_id)) {
        inDay.add(slot.exercise_id);
        return [slot];
      }
      changed = true;
      const muscle = volumeMuscle(slot.exercise.muscle_group);
      const options = offered
        .filter((exercise) => volumeMuscle(exercise.muscle_group) === muscle && !inDay.has(exercise.id)
          && !day.exercises.some((entry) => entry.exercise_id === exercise.id))
        .sort((a, b) => Number(a.is_compound !== slot.exercise.is_compound) - Number(b.is_compound !== slot.exercise.is_compound)
          || rank(a) - rank(b) || a.name.localeCompare(b.name));
      const swap = options[0];
      if (!swap) {
        if (isStandIn(slot.exercise)) dropped.push(slot.exercise.name);
        return [];
      }
      inDay.add(swap.id);
      return [{ ...slot, exercise_id: swap.id, exercise: swap }];
    });
    return { ...day, exercises: exercises.map((exercise, order) => (exercise.exercise_order === order ? exercise : { ...exercise, exercise_order: order })) };
  });
  return changed ? { ...draft, days } : draft;
}

/**
 * Every main muscle brought to at least solid inside the session cap. Days
 * over the cap give up sets first, from the muscles with the most to spare;
 * a beginner's main muscles come back to the low edge of solid. When the days
 * cannot hold everything, the Emphasis answer decides who gets the room, and
 * what stays low is left for `thinMuscles` to name.
 */
export function fillByMuscle(draft: DraftSplit, library: readonly Exercise[], answers: FillAnswers): DraftSplit {
  const cap = SESSION_SET_CAPS[answers.sessionLength];
  const offered = builderLibrary(library, answers.equipment);

  let current = trimToCap(draft, cap, answers.focus);
  // A beginner's own movements can bring more sets than a starting plan holds.
  // A set past the aim is left alone: that is as close as whole movements land.
  if (answers.experience === 'beginner') current = trimToStartingSets(current, (muscle) => weeklySetTarget(muscle, answers) + 1);

  for (let round = 0; round < 64; round += 1) {
    current = applySuggestions(current, offered, cap, answers.focus);
    const low = lowMainMuscles(programVolume(current))
      .map((row) => row.muscle as MainMuscle)
      .sort((a, b) => Number(outsideFocus(a, answers.focus)) - Number(outsideFocus(b, answers.focus)));
    if (!low.length) break;
    let next: DraftSplit | null = null;
    for (const muscle of low) {
      next = makeRoom(current, offered, cap, answers.focus, muscle);
      if (next) break;
    }
    if (!next) break;
    current = next;
  }
  return keepFixedSets(draft, current);
}

/**
 * A row that had no set range before the fill has none after it: a raise
 * makes "3 sets" into "4 sets", not "3 to 4 sets". The person's own ranges stay.
 */
function keepFixedSets(before: DraftSplit, after: DraftSplit): DraftSplit {
  const fixed = new Set(before.days.flatMap((day) => day.exercises.filter((exercise) => exercise.target_sets_min === exercise.target_sets_max).map((exercise) => exercise.id)));
  let changed = false;
  const days = after.days.map((day) => {
    const exercises = day.exercises.map((exercise) => {
      const loose = exercise.target_sets_min !== exercise.target_sets || exercise.target_sets_max !== exercise.target_sets;
      if (!loose || (!fixed.has(exercise.id) && before.days.some((entry) => entry.exercises.some((row) => row.id === exercise.id)))) return exercise;
      changed = true;
      return { ...exercise, target_sets_min: exercise.target_sets, target_sets_max: exercise.target_sets };
    });
    return exercises.some((exercise, index) => exercise !== day.exercises[index]) ? { ...day, exercises } : day;
  });
  return changed ? { ...after, days } : after;
}

/** Main muscles still under solid, in the order screens list them. */
export function thinMuscles(draft: DraftSplit): MainMuscle[] {
  const low = new Set(lowMainMuscles(programVolume(draft)).map((row) => row.muscle));
  return MAIN_MUSCLES.filter((muscle) => low.has(muscle));
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/** "Side delts and biceps stay under 4 sets a week: 3 days of 45 minutes leave no room for more." */
export function thinLine(thin: readonly MainMuscle[], days: number, sessionLength: SessionLength): string | null {
  if (!thin.length) return null;
  const names = thin.map((muscle, index) => (index === 0 ? muscleLabel(muscle) : muscleLabel(muscle).toLowerCase()));
  const verb = thin.length === 1 ? 'stays' : 'stay';
  const room = days === 1 ? '1 day of' : `${days} days of`;
  const leave = days === 1 ? 'leaves' : 'leave';
  return `${listWords(names)} ${verb} under ${VOLUME_BAND_EDGES.solidFrom} sets a week: ${room} ${SESSION_MINUTES[sessionLength]} minutes ${leave} no room for more.`;
}

// ── Keeping the person's movements ──────────────────────────────────

type Role = 'compound' | 'isolation';

function slotKey(exercise: Pick<Exercise, 'muscle_group' | 'is_compound'>): string | null {
  const muscle = volumeMuscle(exercise.muscle_group);
  if (!muscle) return null;
  const role: Role = exercise.is_compound ? 'compound' : 'isolation';
  return `${muscle}:${role}`;
}

interface Kept {
  exercise: Exercise;
  /** Its first row in the current program; sets, reps and notes come from here unless a day of the same name has it. */
  entry: DraftExercise;
  /** Sets a week in the current program, for "most used first". */
  weekly: number;
  firstSeen: number;
}

export interface KeepOptions {
  equipment: EquipmentProfile;
  /** Most sets a day may hold; a movement with no slot joins its day of the same name only within it. */
  maxDaySets?: number;
}

const dayKey = (name: string) => name.trim().toLowerCase();
const sameName = (a: Pick<Exercise, 'name'>, b: Pick<Exercise, 'name'>) => a.name.trim().toLowerCase() === b.name.trim().toLowerCase();

function keptRow(slot: DraftExercise, entry: DraftExercise): DraftExercise {
  const sets = plannedMovementSets(entry);
  return {
    ...slot,
    exercise_id: entry.exercise.id,
    exercise: entry.exercise,
    target_sets: sets,
    target_sets_min: Math.min(entry.target_sets_min, sets),
    target_sets_max: Math.max(entry.target_sets_max, sets),
    target_reps_min: entry.target_reps_min,
    target_reps_max: entry.target_reps_max,
    notes: entry.notes,
  };
}

/**
 * Each slot of the new plan takes a movement from the current program that
 * trains the same main muscle in the same role (a compound for a compound, an
 * isolation for an isolation), each once a day, with its own sets, rep range
 * and notes. Which one: first a movement from the current day of the same
 * name (Pull B keeps Pull B's), then the template's own movement when the
 * program has it, then the most used. A slot with no such movement keeps the
 * template's own, or another template movement for the same slot that the
 * day gave up, so nothing repeats within a day. A day the current program
 * also has (by name) takes only that day's movements, and the rest of them
 * join it while it has room, so a plan rebuilt with the same days gets its
 * days back. Retired movements, and for a
 * dumbbells-only plan anything without dumbbells or bodyweight, are never
 * taken.
 */
export function keepCurrentMovements(draft: DraftSplit, current: DraftSplit, options: KeepOptions): DraftSplit {
  const byKey = new Map<string, Kept[]>();
  const seen = new Map<string, Kept>();
  const onDay = new Map<string, Map<string, DraftExercise>>();
  for (const day of current.days) {
    for (const entry of day.exercises) {
      const exercise = entry.exercise;
      if (!exercise || exercise.retired_at) continue;
      if (options.equipment === 'dumbbell_only' && !fitsDumbbellsOnly(exercise)) continue;
      const key = slotKey(exercise);
      if (!key) continue;
      const rows = onDay.get(dayKey(day.day_name)) ?? new Map<string, DraftExercise>();
      if (!rows.has(exercise.id)) rows.set(exercise.id, entry);
      onDay.set(dayKey(day.day_name), rows);
      const known = seen.get(exercise.id);
      if (known) {
        known.weekly += plannedMovementSets(entry);
        continue;
      }
      const kept: Kept = { exercise, entry, weekly: plannedMovementSets(entry), firstSeen: seen.size };
      seen.set(exercise.id, kept);
      byKey.set(key, [...(byKey.get(key) ?? []), kept]);
    }
  }
  if (!seen.size) return draft;
  for (const list of byKey.values()) list.sort((a, b) => b.weekly - a.weekly || a.firstSeen - b.firstSeen);

  const days = draft.days.map((day) => {
    const sameDay = onDay.get(dayKey(day.day_name));
    const taken = new Set<string>();
    const result: (DraftExercise | null)[] = day.exercises.map(() => null);
    const pass = (pick: (slot: DraftExercise, free: Kept[]) => Kept | undefined) => {
      day.exercises.forEach((slot, index) => {
        if (result[index]) return;
        const key = slotKey(slot.exercise);
        const free = (key ? byKey.get(key) ?? [] : []).filter((kept) => !taken.has(kept.exercise.id));
        const mine = pick(slot, free);
        if (!mine) return;
        taken.add(mine.exercise.id);
        result[index] = keptRow(slot, sameDay?.get(mine.exercise.id) ?? mine.entry);
      });
    };
    pass((_, free) => free.find((kept) => sameDay?.has(kept.exercise.id)));
    pass((slot, free) => free.find((kept) => kept.exercise.id === slot.exercise_id || sameName(kept.exercise, slot.exercise)));
    // A day the current program also has keeps to that day's movements; others take the most used.
    if (!sameDay) pass((_, free) => free[0]);

    // Slots none of the person's movements fit keep the template's own, unless it is already in the day;
    // then a template movement for the same slot that the day gave up.
    const spare = day.exercises.filter((slot, index) => result[index] && result[index]!.exercise_id !== slot.exercise_id);
    const free = (candidate: DraftExercise) => !taken.has(candidate.exercise_id);
    const exercises = day.exercises.flatMap((slot, index): DraftExercise[] => {
      const kept = result[index];
      if (kept) return [kept];
      const own = free(slot) ? slot : spare.find((candidate) => free(candidate) && slotKey(candidate.exercise) === slotKey(slot.exercise));
      if (!own) return [];
      taken.add(own.exercise_id);
      return [own === slot ? slot : { ...own, id: slot.id, target_sets: slot.target_sets, target_sets_min: slot.target_sets_min, target_sets_max: slot.target_sets_max }];
    });
    return { ...day, exercises };
  });

  // The rest of a same-named day's movements join it, in their own order, while it has room.
  const filled = days.map((day) => {
    const sameDay = onDay.get(dayKey(day.day_name));
    if (!sameDay) return day;
    let exercises = day.exercises;
    for (const entry of sameDay.values()) {
      if (exercises.some((exercise) => exercise.exercise_id === entry.exercise.id)) continue;
      const room = (options.maxDaySets ?? Infinity) - daySets(exercises);
      const sets = plannedMovementSets(entry);
      if (sets > room) continue;
      exercises = [...exercises, keptRow({ ...entry, id: createTempId(), superset_group_id: null, _isNew: true }, entry)];
    }
    return { ...day, exercises: exercises.map((exercise, order) => (exercise.exercise_order === order ? exercise : { ...exercise, exercise_order: order })) };
  });
  return { ...draft, days: filled };
}

/** How many of the plan's exercises (rows, a movement on two days counts twice) come from the current program. */
export function keptExerciseCount(draft: DraftSplit, current: DraftSplit | null | undefined): number {
  if (!current) return 0;
  const mine = new Set(current.days.flatMap((day) => day.exercises.map((exercise) => exercise.exercise_id)));
  return draft.days.reduce((sum, day) => sum + day.exercises.filter((exercise) => mine.has(exercise.exercise_id)).length, 0);
}
