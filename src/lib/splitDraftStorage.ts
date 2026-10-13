/**
 * A copy of the program being edited, kept on this device so a closed app or
 * reload can offer it back. It never leaves the device: only Save writes to
 * the backend. One copy per account and program, plus one for a new program.
 */
import type { DraftSplit } from '@/lib/splitDraft';
import type { Split } from '@/types';

const VERSION = 1;
const PREFIX = 'hyper:split-draft:v1';

export const NEW_SPLIT_DRAFT_ID = 'new';

export interface StoredSplitDraft {
  version: typeof VERSION;
  draft: DraftSplit;
  savedAt: number;
  /** Fingerprint of the saved program the edits started from; null for a new one. */
  baseSignature: string | null;
}

export function splitDraftId(draft: Pick<DraftSplit, 'id' | '_isNew'>): string {
  return draft._isNew ? NEW_SPLIT_DRAFT_ID : draft.id;
}

export function splitDraftKey(userId: string, splitId: string): string {
  return `${PREFIX}:${userId}:${splitId}`;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isDraftSplit(value: unknown): value is DraftSplit {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<DraftSplit>;
  return typeof draft.id === 'string'
    && typeof draft.name === 'string'
    && Array.isArray(draft.days)
    && draft.days.every((day) => day
      && typeof day.id === 'string'
      && typeof day.day_name === 'string'
      && Array.isArray(day.exercises)
      && day.exercises.every((entry) => entry
        && typeof entry.id === 'string'
        && typeof entry.exercise_id === 'string'
        && typeof entry.exercise?.name === 'string'));
}

export function readSplitDraft(userId: string, splitId: string): StoredSplitDraft | null {
  const store = storage();
  if (!store) return null;
  const key = splitDraftKey(userId, splitId);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSplitDraft>;
    if (parsed.version !== VERSION || !isDraftSplit(parsed.draft) || typeof parsed.savedAt !== 'number') {
      store.removeItem(key);
      return null;
    }
    return {
      version: VERSION,
      draft: parsed.draft,
      savedAt: parsed.savedAt,
      baseSignature: typeof parsed.baseSignature === 'string' ? parsed.baseSignature : null,
    };
  } catch {
    return null;
  }
}

export function writeSplitDraft(userId: string, draft: DraftSplit, baseSignature: string | null, now = Date.now()): void {
  const value: StoredSplitDraft = { version: VERSION, draft, savedAt: now, baseSignature };
  try {
    storage()?.setItem(splitDraftKey(userId, splitDraftId(draft)), JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the editor keeps working without the copy.
  }
}

export function clearSplitDraft(userId: string, splitId: string): void {
  try {
    storage()?.removeItem(splitDraftKey(userId, splitId));
  } catch {
    // nothing to clear
  }
}

/** A short fingerprint of a saved program, to tell whether it changed since a draft began. */
export function splitSignature(split: Split): string {
  const text = JSON.stringify([
    split.name,
    split.description,
    split.days.map((day) => [
      day.id,
      day.day_name,
      (day.exercises ?? []).map((ex) => [ex.id, ex.exercise_id, ex.target_sets, ex.target_reps_min, ex.target_reps_max, ex.notes, ex.superset_group_id ?? null]),
    ]),
  ]);
  // FNV-1a
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export interface DraftAutosaveSource {
  draft: DraftSplit | null;
  isDirty: boolean;
  storageScope: string | null;
  baseSignature: string | null;
}

/**
 * Writes the dirty draft after `delayMs` without edits. Returns `update` (call
 * on every state change), `flush` (write a pending copy now, e.g. when the app
 * is hidden) and `cancel`. A draft that closes cancels its pending write, so a
 * save or discard is never followed by a stale copy.
 */
export function createSplitDraftAutosaver({
  delayMs,
  write = writeSplitDraft,
}: {
  delayMs: number;
  write?: (userId: string, draft: DraftSplit, baseSignature: string | null) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: DraftAutosaveSource | null = null;
  let lastDraft: DraftSplit | null = null;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  const flush = () => {
    const next = pending;
    cancel();
    if (next?.draft && next.storageScope) write(next.storageScope, next.draft, next.baseSignature);
  };

  const update = (state: DraftAutosaveSource) => {
    if (!state.draft || !state.storageScope) {
      lastDraft = state.draft;
      cancel();
      return;
    }
    if (state.draft === lastDraft) return;
    lastDraft = state.draft;
    if (!state.isDirty) return;
    pending = state;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  };

  return { update, flush, cancel };
}
