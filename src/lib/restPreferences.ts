import { supabase } from '@/lib/supabase';

export interface RestPreferenceEntry {
  restSeconds: number;
  // Must be an ISO-8601 UTC string (Date#toISOString) so lexical `>` equals chronological order.
  updatedAt: string;
}

/** Map of exerciseId -> preference entry. */
export type RestPreferences = Record<string, RestPreferenceEntry>;

type PrefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const DEFAULT_REST_SECONDS = 90;
const MIN_REST_SECONDS = 5;
const MAX_REST_SECONDS = 3600;
const STORAGE_PREFIX = 'hyper:rest-preferences:';

function getStorage(storage?: PrefStorage | null): PrefStorage | null {
  if (storage) return storage;
  if (typeof globalThis === 'undefined') return null;
  return globalThis.localStorage ?? null;
}

function keyFor(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function clampSeconds(seconds: number): number {
  return Math.max(MIN_REST_SECONDS, Math.min(MAX_REST_SECONDS, Math.round(seconds)));
}

function isValidEntry(value: unknown): value is RestPreferenceEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<RestPreferenceEntry>;
  return typeof entry.restSeconds === 'number' && typeof entry.updatedAt === 'string';
}

/** Keep only well-formed entries from a parsed cache object. */
function sanitize(parsed: unknown): RestPreferences {
  if (!parsed || typeof parsed !== 'object') return {};
  const result: RestPreferences = {};
  for (const [exerciseId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isValidEntry(value)) {
      result[exerciseId] = { restSeconds: value.restSeconds, updatedAt: value.updatedAt };
    }
  }
  return result;
}

// ── Cache helpers ──

export function loadRestPreferences(userId: string, storage?: PrefStorage | null): RestPreferences {
  const target = getStorage(storage);
  if (!target || !userId) return {};
  try {
    const raw = target.getItem(keyFor(userId));
    if (!raw) return {};
    return sanitize(JSON.parse(raw));
  } catch {
    return {};
  }
}

function saveLocalCache(userId: string, prefs: RestPreferences, storage?: PrefStorage | null): void {
  const target = getStorage(storage);
  if (!target || !userId) return;
  target.setItem(keyFor(userId), JSON.stringify(prefs));
}

// ── Resolution ──

export function getLastUsedRestSeconds(prefs: RestPreferences): number | null {
  let best: RestPreferenceEntry | null = null;
  for (const entry of Object.values(prefs)) {
    if (!best || entry.updatedAt > best.updatedAt) best = entry;
  }
  return best ? best.restSeconds : null;
}

export function resolveRestSeconds(
  prefs: RestPreferences,
  exerciseId: string,
  fallback: number = DEFAULT_REST_SECONDS,
): number {
  const own = prefs[exerciseId];
  if (own) return own.restSeconds;
  return getLastUsedRestSeconds(prefs) ?? fallback;
}

/** Merge two maps, keeping the entry with the newer updatedAt per movement. */
export function mergeRestPreferences(local: RestPreferences, remote: RestPreferences): RestPreferences {
  const merged: RestPreferences = { ...local };
  for (const [exerciseId, remoteEntry] of Object.entries(remote)) {
    const localEntry = merged[exerciseId];
    if (!localEntry || remoteEntry.updatedAt > localEntry.updatedAt) {
      merged[exerciseId] = remoteEntry;
    }
  }
  return merged;
}

// ── DB sync ──

async function saveToDB(userId: string, exerciseId: string, restSeconds: number, updatedAt: string): Promise<void> {
  try {
    await supabase
      .from('exercise_rest_preferences')
      .upsert({
        user_id: userId,
        exercise_id: exerciseId,
        rest_seconds: restSeconds,
        updated_at: updatedAt,
      }, { onConflict: 'user_id,exercise_id' });
  } catch {
    // Silently fail — the localStorage cache still has the value.
  }
}

/**
 * Save a movement's rest preference: write the cache instantly and upsert to the
 * DB in the background. Returns the updated map for optimistic in-memory use.
 */
export function saveRestPreference(
  userId: string,
  exerciseId: string,
  seconds: number,
  storage?: PrefStorage | null,
): RestPreferences {
  const restSeconds = clampSeconds(seconds);
  const updatedAt = new Date().toISOString();
  const next = loadRestPreferences(userId, storage);
  next[exerciseId] = { restSeconds, updatedAt };
  saveLocalCache(userId, next, storage);
  void saveToDB(userId, exerciseId, restSeconds, updatedAt);
  return next;
}

/**
 * Load preferences from the DB, merge with the local cache (newest wins per
 * movement), persist the merged result, and return it. On any DB failure,
 * returns the cached map. Call once on workout page mount.
 */
export async function loadRestPreferencesAsync(
  userId: string,
  storage?: PrefStorage | null,
): Promise<RestPreferences> {
  const cached = loadRestPreferences(userId, storage);
  if (!userId) return cached;

  try {
    const { data, error } = await supabase
      .from('exercise_rest_preferences')
      .select('exercise_id, rest_seconds, updated_at')
      .eq('user_id', userId);

    if (error || !data) return cached;

    const remote: RestPreferences = {};
    for (const row of data as Array<{ exercise_id: string; rest_seconds: number; updated_at: string }>) {
      remote[row.exercise_id] = { restSeconds: row.rest_seconds, updatedAt: row.updated_at };
    }

    const merged = mergeRestPreferences(cached, remote);
    saveLocalCache(userId, merged, storage);
    return merged;
  } catch {
    return cached;
  }
}
