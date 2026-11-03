// Set writes belong to the workout, including corrections from its movement
// sheet. A Finish confirmation keeps their outcomes even if they settle while
// the question is on screen or notes are being saved.
const pending = new Map<string, Set<Promise<boolean>>>();

export function trackWorkoutSetSave<T>(workoutId: string, save: Promise<T>): Promise<T> {
  const saves = pending.get(workoutId) ?? new Set<Promise<boolean>>();
  pending.set(workoutId, saves);
  const outcome = save.then(() => true, () => false);
  saves.add(outcome);
  void outcome.then(() => {
    saves.delete(outcome);
    if (saves.size === 0 && pending.get(workoutId) === saves) pending.delete(workoutId);
  });
  return save;
}

type FinishPreparation<T> = { kind: 'ready'; session: T } | { kind: 'save-failed' } | { kind: 'changed' };

/** Call when opening the question, then await the result when confirming. */
export function prepareWorkoutFinish<T extends { workoutId: string }>(workoutId: string, readLatest: () => T | null) {
  const savingWhenOpened = [...(pending.get(workoutId) ?? [])];
  return async (): Promise<FinishPreparation<T>> => {
    const saves = new Set([...savingWhenOpened, ...(pending.get(workoutId) ?? [])]);
    if ((await Promise.all(saves)).some((saved) => !saved)) return { kind: 'save-failed' };
    const session = readLatest();
    // Never finish a replacement workout, or summarize a captured copy after
    // a set, a skip or the account changed while the question was visible.
    return session?.workoutId === workoutId ? { kind: 'ready', session } : { kind: 'changed' };
  };
}
