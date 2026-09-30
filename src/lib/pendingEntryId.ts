// The row id a new-entry form writes under until its save is confirmed. A save
// whose response was lost may still have committed on the server, so the retry
// must reuse the same id (persistNutritionEntry upserts on it) instead of
// inserting a second row. Cleared after every confirmed save, so the next save
// (including the next item of a multi-item photo log) is a different entry.
export function createPendingEntryId(generate: () => string = () => crypto.randomUUID()) {
  let pending: string | null = null;
  return {
    take: (): string => (pending ??= generate()),
    clear: () => { pending = null; },
  };
}

export type PendingEntryId = ReturnType<typeof createPendingEntryId>;

/**
 * Which id a nutrition save writes under. An explicit retry id (trial items,
 * meal builder) always wins; editing an existing entry keeps its update path
 * and never takes a pending id; any other new entry uses the pending id.
 */
export function entryWriteId(
  editing: boolean,
  retryEntryId: string | undefined,
  pending: PendingEntryId,
): string | undefined {
  return retryEntryId ?? (editing ? undefined : pending.take());
}
