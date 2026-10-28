import { pendingExercises } from '@/lib/customExercises';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import type { Exercise, Split } from '@/types';

// ═══════════════════════════════════
// DRAFT TYPES
// ═══════════════════════════════════

export interface DraftExercise {
  /** Original DB id or a temp id for new exercises */
  id: string;
  exercise_id: string;
  exercise: Exercise;
  target_sets: number;
  target_sets_min: number;
  target_sets_max: number;
  target_reps_min: number;
  target_reps_max: number;
  exercise_order: number;
  notes: string | null;
  superset_group_id: string | null;
  /** true if this was created during the edit session */
  _isNew?: boolean;
}

export interface DraftDay {
  id: string;
  day_name: string;
  day_order: number;
  exercises: DraftExercise[];
  _isNew?: boolean;
}

export interface DraftSplit {
  id: string;
  name: string;
  description: string | null;
  days_per_week: number;
  days: DraftDay[];
  /** A program that does not exist yet; saving creates it. */
  _isNew?: boolean;
}

// ═══════════════════════════════════
// IDS
// ═══════════════════════════════════

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTempId(): string {
  return `new-${randomId()}`;
}

export function createSupersetGroupId(): string {
  return randomId();
}

// ═══════════════════════════════════
// CONVERSION
// ═══════════════════════════════════

export function splitToDraft(split: Split): DraftSplit {
  return {
    id: split.id,
    name: split.name,
    description: split.description,
    days_per_week: split.days_per_week,
    days: split.days.map((day) => ({
      id: day.id,
      day_name: day.day_name,
      day_order: day.day_order,
      exercises: (day.exercises || []).map((ex) => {
        const parsedRange = parseSetRangeNotes(ex.notes, ex.target_sets);
        return {
          id: ex.id,
          exercise_id: ex.exercise_id,
          exercise: ex.exercise,
          target_sets: parsedRange.targetSets,
          target_sets_min: parsedRange.minSets,
          target_sets_max: parsedRange.maxSets,
          target_reps_min: ex.target_reps_min,
          target_reps_max: ex.target_reps_max,
          exercise_order: ex.exercise_order,
          notes: parsedRange.baseNotes,
          superset_group_id: ex.superset_group_id ?? null,
        };
      }),
    })),
  };
}

/** Renumbers days and exercises, keeping every object whose order is already right. */
export function fixDayOrders(days: DraftDay[]): DraftDay[] {
  return days.map((day, index) => {
    const exercises = day.exercises.some((ex, exIdx) => ex.exercise_order !== exIdx)
      ? day.exercises.map((ex, exIdx) => (ex.exercise_order === exIdx ? ex : { ...ex, exercise_order: exIdx }))
      : day.exercises;
    return day.day_order === index && exercises === day.exercises ? day : { ...day, day_order: index, exercises };
  });
}

// ═══════════════════════════════════
// ORDERING
// ═══════════════════════════════════

/**
 * Splits a day into the units that move together: a superset pair is one
 * block, every other exercise its own. Only neighbours share a block, the same
 * rule the up/down moves have always used.
 */
export function exerciseBlocks<T extends { superset_group_id?: string | null }>(exercises: readonly T[]): T[][] {
  const blocks: T[][] = [];
  for (const exercise of exercises) {
    const last = blocks.at(-1);
    if (last && exercise.superset_group_id && last[0].superset_group_id === exercise.superset_group_id) {
      last.push(exercise);
    } else {
      blocks.push([exercise]);
    }
  }
  return blocks;
}

function flattenBlocks(blocks: DraftExercise[][]): DraftExercise[] {
  return blocks.flat().map((entry, order) => (
    entry.exercise_order === order ? entry : { ...entry, exercise_order: order }
  ));
}

/**
 * Moves an exercise's block to where another exercise's block is, the drop of
 * a drag. A superset pair always moves as one block and nothing lands inside
 * one. Returns the same array when nothing moves.
 */
export function moveExerciseBlock(exercises: DraftExercise[], exerciseId: string, overExerciseId: string): DraftExercise[] {
  const blocks = exerciseBlocks(exercises);
  const from = blocks.findIndex((block) => block.some((entry) => entry.id === exerciseId));
  const to = blocks.findIndex((block) => block.some((entry) => entry.id === overExerciseId));
  if (from < 0 || to < 0 || from === to) return exercises;
  const next = [...blocks];
  const [moving] = next.splice(from, 1);
  next.splice(to, 0, moving);
  return flattenBlocks(next);
}

/**
 * Moves an exercise one place. A superset pair moves as one block and other
 * exercises step over the whole pair, so a pair is never split apart.
 */
export function moveExercise(exercises: DraftExercise[], exerciseId: string, direction: -1 | 1): DraftExercise[] {
  const blocks = exerciseBlocks(exercises);
  const from = blocks.findIndex((block) => block.some((entry) => entry.id === exerciseId));
  const neighbour = blocks[from + direction];
  if (from < 0 || !neighbour) return exercises;
  return moveExerciseBlock(exercises, exerciseId, neighbour[0].id);
}

/** Moves a day to another day's place (a drag drop). */
export function moveDayTo(days: DraftDay[], dayId: string, overDayId: string): DraftDay[] {
  const from = days.findIndex((day) => day.id === dayId);
  const to = days.findIndex((day) => day.id === overDayId);
  if (from < 0 || to < 0 || from === to) return days;
  const next = [...days];
  const [moving] = next.splice(from, 1);
  next.splice(to, 0, moving);
  return fixDayOrders(next);
}

// ═══════════════════════════════════
// NEW ROWS
// ═══════════════════════════════════

export function newDraftExercise(exercise: Exercise, order: number, overrides: Partial<DraftExercise> = {}): DraftExercise {
  return {
    id: createTempId(),
    exercise_id: exercise.id,
    exercise,
    target_sets: 3,
    target_sets_min: 3,
    target_sets_max: 3,
    target_reps_min: 8,
    target_reps_max: 12,
    exercise_order: order,
    notes: null,
    superset_group_id: null,
    _isNew: true,
    ...overrides,
  };
}

export function newDraftDay(dayName: string, order: number, exercises: DraftExercise[] = []): DraftDay {
  return { id: createTempId(), day_name: dayName, day_order: order, exercises, _isNew: true };
}

// ═══════════════════════════════════
// LABELS AND PICKER
// ═══════════════════════════════════

/** A day's name, or "Day N" when it has none. */
export function dayLabel(day: Pick<DraftDay, 'day_name'>, index: number): string {
  return day.day_name.trim() || `Day ${index + 1}`;
}

/** A day's exercises in one line, or "No exercises yet". */
export function daySummary(day: Pick<DraftDay, 'exercises'>): string {
  return day.exercises.map((exercise) => exercise.exercise.name).join(' · ') || 'No exercises yet';
}

/** Where each block's first exercise sits in the day, for its number. */
export function blockStartIndexes(blocks: ReadonlyArray<readonly unknown[]>): number[] {
  const starts: number[] = [];
  let start = 0;
  for (const block of blocks) {
    starts.push(start);
    start += block.length;
  }
  return starts;
}

export type ProgramPickMode = 'add' | 'swap' | 'superset';

export interface ProgramPickerTarget {
  dayId: string;
  mode: ProgramPickMode;
  exerciseId?: string;
  /** Swap and superset open on the source's muscle; add opens on all. */
  initialMuscleGroup?: Exercise['muscle_group'];
  /** The day's exercises, never offered again. */
  excludeExerciseIds: string[];
  /** Custom exercises typed in this edit, not in the library until save. */
  extraExercises: Exercise[];
}

export const PROGRAM_PICKER_TITLES: Record<ProgramPickMode, string> = {
  add: 'Add exercises',
  swap: 'Swap exercise',
  superset: 'Add superset exercise',
};

/** What the exercise picker offers for a day of the draft. */
export function pickerTargetFor(draft: DraftSplit, dayId: string, mode: ProgramPickMode, exerciseId?: string): ProgramPickerTarget {
  const day = draft.days.find((entry) => entry.id === dayId);
  const source = exerciseId ? day?.exercises.find((entry) => entry.id === exerciseId) : undefined;
  return {
    dayId,
    mode,
    exerciseId,
    initialMuscleGroup: mode === 'add' ? undefined : source?.exercise.muscle_group,
    excludeExerciseIds: day?.exercises.map((entry) => entry.exercise_id) ?? [],
    extraExercises: pendingExercises(draft),
  };
}
