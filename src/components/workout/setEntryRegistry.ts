/**
 * Each mounted WorkoutSetRow registers a handle here, keyed by its set id, so
 * the command capsule can read a row's draft and log it through the row's own
 * save (the same handler as the inline check), instead of a second save path.
 */

export type SetEntryField = 'weight' | 'reps' | 'rpe';

export interface SetEntryValues {
  weight: string;
  reps: string;
  rpe: string;
}

export interface SetEntryState extends SetEntryValues {
  /** The user typed or applied values that are not saved yet. */
  hasDraft: boolean;
  saving: boolean;
  /** The row's save error, retained until a retry succeeds. */
  error: string | null;
  completed: boolean;
}

export interface SetEntryHandle {
  read(): SetEntryState;
  /**
   * Run the row's save. With `values`, they become the row's draft first, so
   * a failed save keeps exactly what was shown.
   */
  save(values?: SetEntryValues): Promise<void>;
  /** Open the row's inline editor and focus one field (the first by default). */
  focus(field?: SetEntryField): void;
}

const entries = new Map<string, SetEntryHandle>();
const listeners = new Set<() => void>();
let version = 0;

export function registerSetEntry(setId: string, handle: SetEntryHandle): () => void {
  entries.set(setId, handle);
  notifySetEntries();
  return () => {
    if (entries.get(setId) !== handle) return;
    entries.delete(setId);
    notifySetEntries();
  };
}

export function getSetEntry(setId: string | null | undefined): SetEntryHandle | undefined {
  return setId ? entries.get(setId) : undefined;
}

export function notifySetEntries(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function subscribeSetEntries(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Changes whenever any row's entry state changes (for useSyncExternalStore). */
export function readSetEntriesVersion(): number {
  return version;
}
