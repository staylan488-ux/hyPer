import { supabase } from '@/lib/supabase';

export interface RestPreferenceEntry {
  restSeconds: number;
  // Must be an ISO-8601 UTC string (Date#toISOString) so lexical `>` equals chronological order.
  updatedAt: string;
}

/** Map of exerciseId -> preference entry. */
export type RestPreferences = Record<string, RestPreferenceEntry>;

type PrefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Where a movement's rest starts when the person has never set one: 90 s for
 * a single-joint movement, 2 min 30 for a multi-joint lift. Rests over a
 * minute help growth a little, mostly by keeping reps on later sets (Singer
 * et al. 2024, nine studies, wide uncertainty; past about 90 s the benefit is
 * unclear). Big lifts lose the most reps to a short rest, and reps kept on
 * later sets are what the set targets build on. The evidence is thin; the
 * figures are a sensible start, and one tap changes them.
 */
export const DEFAULT_REST_SECONDS = 90;
export const COMPOUND_REST_SECONDS = 150;

/** The starting rest for a movement of a known kind; 90 s when the kind is not known. */
export function defaultRestSeconds(isCompound: boolean | null | undefined): number {
  return isCompound ? COMPOUND_REST_SECONDS : DEFAULT_REST_SECONDS;
}
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

/**
 * A movement's rest length: its own when the person set one; else the length
 * last set on a movement of the same kind (a choice spreads among big lifts,
 * or among single-joint movements, never from a curl onto a squat); else the
 * kind's default. `isCompound` says each movement's kind, or null when it is
 * not known. Without it, or for a movement of unknown kind, the last length
 * set anywhere stands in, then `fallback`.
 */
export function resolveRestSeconds(
  prefs: RestPreferences,
  exerciseId: string,
  fallback: number = DEFAULT_REST_SECONDS,
  isCompound?: (exerciseId: string) => boolean | null | undefined,
): number {
  const own = prefs[exerciseId];
  if (own) return own.restSeconds;
  const kind = isCompound?.(exerciseId);
  if (!isCompound || kind == null) return getLastUsedRestSeconds(prefs) ?? fallback;
  let best: RestPreferenceEntry | null = null;
  for (const [otherId, entry] of Object.entries(prefs)) {
    const otherKind = isCompound(otherId);
    if (otherKind == null || Boolean(otherKind) !== Boolean(kind)) continue;
    if (!best || entry.updatedAt > best.updatedAt) best = entry;
  }
  return best ? best.restSeconds : defaultRestSeconds(kind);
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

    // Read the cache again: a rest length saved while the request was out is
    // not in `cached`, and merging from that would write over it.
    const merged = mergeRestPreferences(loadRestPreferences(userId, storage), remote);
    saveLocalCache(userId, merged, storage);
    return merged;
  } catch {
    return cached;
  }
}
