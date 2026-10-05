import { parseSetRangeNotes, serializeSetRangeNotes } from '@/lib/setRangeNotes';
import type { Exercise, ExerciseSubstitution, FlexiblePlanItem } from '@/types';

interface SessionSet {
  exercise_id: string;
  set_number: number;
  completed: boolean;
}

export interface SubstitutionPlan {
  /** The session plan after the swap, in order. */
  items: FlexiblePlanItem[];
  /** Set numbers for the replacement's new sets, one per unfinished set moved. */
  setNumbers: number[];
  /** The replacement is the planned movement, so the slot is no longer a swap. */
  switchingBack: boolean;
}

/** Reads a stored swap marker, or null when it is missing or malformed. */
export function parseExerciseSubstitution(raw: unknown): ExerciseSubstitution | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.exercise_id !== 'string' || !value.exercise_id) return null;
  return {
    exercise_id: value.exercise_id,
    exercise_name: typeof value.exercise_name === 'string' ? value.exercise_name : null,
    notes: typeof value.notes === 'string' ? value.notes : null,
  };
}

/** The item without its swap marker, e.g. for a template that outlives the session. */
export function withoutSubstitution(item: FlexiblePlanItem): FlexiblePlanItem {
  const { substitutes_for: substitution, ...rest } = item;
  void substitution;
  return rest;
}

/**
 * Swaps a movement for another exercise in this session only. The replacement
 * takes the movement's place, superset and rep target, with one new set for
 * each unfinished set; its loads come from its own history, never the
 * original's. Finished sets stay recorded under the exercise that did them.
 *
 * Swapping a swap keeps pointing at the planned movement, and choosing the
 * planned movement again switches back: its plan notes return, and if it
 * already finished sets this session the moved sets rejoin them.
 */
export function planExerciseSubstitution({
  items,
  sets,
  sourceId,
  sourceName = null,
  replacement,
  splitSession,
}: {
  items: readonly FlexiblePlanItem[];
  sets: readonly SessionSet[];
  sourceId: string;
  sourceName?: string | null;
  replacement: Pick<Exercise, 'id' | 'name'>;
  splitSession: boolean;
}): SubstitutionPlan {
  const sourceSets = sets.filter((set) => set.exercise_id === sourceId);
  const pendingNumbers = sourceSets.filter((set) => !set.completed).map((set) => set.set_number).sort((a, b) => a - b);
  const pending = pendingNumbers.length;
  const finished = sourceSets.length - pending;
  if (pending === 0) throw new Error('This movement has no remaining sets.');
  if (replacement.id === sourceId) throw new Error('That exercise is already in this workout.');

  const sourceItem = items.find((item) => item.exercise_id === sourceId);
  const origin: ExerciseSubstitution = sourceItem?.substitutes_for ?? {
    exercise_id: sourceId,
    exercise_name: sourceItem?.exercise_name ?? sourceName,
    notes: sourceItem?.notes ?? null,
  };
  const switchingBack = replacement.id === origin.exercise_id;
  const rejoinSets = sets.filter((set) => set.exercise_id === replacement.id);
  const rejoining = rejoinSets.length > 0;
  if (rejoining && !switchingBack) throw new Error('That exercise is already in this workout.');

  // Rejoining continues after the planned movement's sets. A superset pairs
  // rounds by set number, so a replacement there keeps the moved sets' rounds;
  // anywhere else it starts from set 1 against its own history.
  const supersetGroupId = sourceItem?.superset_group_id ?? null;
  const firstNumber = rejoinSets.reduce((highest, set) => Math.max(highest, set.set_number), 0) + 1;
  const setNumbers = !rejoining && supersetGroupId
    ? pendingNumbers
    : Array.from({ length: pending }, (_, index) => firstNumber + index);
  const restoredRange = parseSetRangeNotes(origin.notes, pending);

  const slotItem = withoutSubstitution({
    ...sourceItem,
    order: sourceItem?.order ?? items.length,
    exercise_id: replacement.id,
    exercise_name: replacement.name,
    target_sets: pending,
    target_reps_min: sourceItem?.target_reps_min ?? 8,
    target_reps_max: sourceItem?.target_reps_max ?? 12,
    // A program cue belongs to the planned movement; a split session keeps
    // the set count adjustable from 1 to 10 sets. Switching back restores the
    // planned notes with a range that still admits the sets now left.
    notes: !switchingBack
      ? splitSession ? serializeSetRangeNotes(null, 1, pending, 10) : null
      : splitSession
        ? serializeSetRangeNotes(origin.notes, Math.min(restoredRange.minSets, pending), pending, Math.max(restoredRange.maxSets, pending))
        : origin.notes ?? null,
    hidden: false,
    superset_group_id: supersetGroupId,
  });
  if (!switchingBack) slotItem.substitutes_for = origin;

  const nextItems = items
    // An earlier, removed copy of the replacement gives way to the slot.
    .filter((item) => rejoining || item.exercise_id !== replacement.id)
    .flatMap((item): FlexiblePlanItem[] => {
      if (rejoining && item.exercise_id === replacement.id) {
        return [{
          ...item,
          hidden: false,
          target_sets: rejoinSets.length + pending,
          superset_group_id: item.superset_group_id ?? sourceItem?.superset_group_id ?? null,
        }];
      }
      if (item.exercise_id !== sourceId) return [item];
      const kept = finished > 0 ? [{ ...item, target_sets: finished, superset_group_id: null }] : [];
      return rejoining ? kept : [...kept, slotItem];
    });

  const placed = nextItems.some((item) => item.exercise_id === replacement.id);
  if (!placed) nextItems.push(rejoining ? { ...slotItem, target_sets: rejoinSets.length + pending } : slotItem);

  return {
    items: nextItems.map((item, order) => ({ ...item, order })),
    setNumbers,
    switchingBack,
  };
}
