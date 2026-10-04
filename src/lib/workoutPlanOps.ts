export interface PlannedSet {
  id: string;
  set_number: number;
  completed: boolean;
}

export interface SetCountChange {
  /** Set numbers to create, in order. */
  insertNumbers: number[];
  /** Unfinished sets to delete, highest set number first. */
  deleteIds: string[];
}

/**
 * The one rule for changing how many sets an exercise has, shared by the live
 * workout and History. Growing numbers new sets after the highest existing
 * number, so a gap left by a removed set never produces a duplicate number.
 * Shrinking removes unfinished sets from the highest number down, never one
 * numbered within the target and never below the target count. Finished sets
 * are never removed, so an exercise can keep more sets than the target.
 */
export function planSetCountChange(existing: readonly PlannedSet[], desired: number): SetCountChange {
  const count = existing.length;

  if (count < desired) {
    const highest = existing.reduce((max, set) => Math.max(max, set.set_number), 0);
    return {
      insertNumbers: Array.from({ length: desired - count }, (_, index) => highest + index + 1),
      deleteIds: [],
    };
  }

  const deleteIds: string[] = [];
  const removable = existing
    .filter((set) => !set.completed && set.set_number > desired)
    .sort((a, b) => b.set_number - a.set_number);
  for (const set of removable) {
    if (count - deleteIds.length <= desired) break;
    deleteIds.push(set.id);
  }

  return { insertNumbers: [], deleteIds };
}
