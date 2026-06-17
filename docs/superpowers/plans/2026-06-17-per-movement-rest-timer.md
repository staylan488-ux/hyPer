# Per-movement Rest Timer Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mid-workout rest timer auto-start at a duration remembered per movement, synced via Supabase, falling back to the last-used duration for movements with no saved preference.

**Architecture:** A new `exercise_rest_preferences` table stores one rest duration per (user, exercise). A new `restPreferences.ts` lib fronts it with a localStorage cache for instant synchronous reads (mirroring `planSchedule.ts`). `Workout.tsx` resolves a starting duration when a set is logged and persists the user's explicit preset choice; `RestTimerPill.tsx` gains one callback prop and otherwise looks identical.

**Tech Stack:** React 19, TypeScript, Zustand, Supabase (Postgres + RLS), Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-06-17-per-movement-rest-timer-design.md`

---

## File Structure

- **Create** `supabase/migrations/20260617120000_add_exercise_rest_preferences.sql` — new table + RLS.
- **Modify** `src/lib/supabase.ts` — add `exercise_rest_preferences` to the `Database` type.
- **Create** `src/lib/restPreferences.ts` — cache + resolution + DB sync. One responsibility: rest-preference storage/resolution.
- **Create** `tests/restPreferences.test.ts` — unit tests for the lib.
- **Modify** `src/components/workout/RestTimerPill.tsx` — add `onDurationChange` prop, fire on preset choice.
- **Modify** `src/pages/Workout.tsx` — load prefs on mount, resolve duration on set-logged, persist on change.

A "movement" == an `Exercise` (`exercise_id`). `handleSetLogged(loggedSet)` already has `loggedSet.exercise_id`.

---

## Task 1: Database migration + type

**Files:**
- Create: `supabase/migrations/20260617120000_add_exercise_rest_preferences.sql`
- Modify: `src/lib/supabase.ts` (the `Database['public']['Tables']` block, after `volume_landmarks`)

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260617120000_add_exercise_rest_preferences.sql`:

```sql
-- Per-movement rest timer preferences: remember a preferred rest duration
-- per (user, exercise) so the timer auto-starts at the right length and
-- survives device switches. Last-used is derived from MAX(updated_at).

CREATE TABLE IF NOT EXISTS exercise_rest_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  rest_seconds INTEGER NOT NULL CHECK (rest_seconds BETWEEN 5 AND 3600),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, exercise_id)
);

ALTER TABLE exercise_rest_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rest preferences"
  ON exercise_rest_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own rest preferences"
  ON exercise_rest_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own rest preferences"
  ON exercise_rest_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own rest preferences"
  ON exercise_rest_preferences FOR DELETE USING (auth.uid() = user_id);
```

- [ ] **Step 2: Add the table to the `Database` type**

In `src/lib/supabase.ts`, inside `Database['public']['Tables']`, add this entry immediately after the closing `}` of the `volume_landmarks` block (before the final `}` that closes `Tables`):

```typescript
      exercise_rest_preferences: {
        Row: {
          id: string
          user_id: string
          exercise_id: string
          rest_seconds: number
          updated_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          exercise_id: string
          rest_seconds: number
          updated_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          exercise_id?: string
          rest_seconds?: number
          updated_at?: string
          created_at?: string
        }
      }
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: PASS (TypeScript compiles; the new type entry is well-formed).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260617120000_add_exercise_rest_preferences.sql src/lib/supabase.ts
git commit -m "feat(db): add exercise_rest_preferences table + type"
```

> **Note:** This migration is NOT auto-applied to the live Supabase project here. Applying it (via `supabase db push` or the dashboard) is an outward-facing deploy step — do it with the user's go-ahead. Local tests and build do not need the live table (tests mock Supabase; the preview mock returns `[]` for unknown tables).

---

## Task 2: `restPreferences.ts` lib (TDD)

**Files:**
- Create: `src/lib/restPreferences.ts`
- Test: `tests/restPreferences.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/restPreferences.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock supabase before importing the lib (it imports supabase).
const supabaseMock = vi.hoisted(() => {
  const okSelect = () => ({
    eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
  });
  return {
    from: vi.fn(() => ({
      upsert: vi.fn(() => Promise.resolve({ error: null })),
      select: vi.fn(okSelect),
    })),
    auth: { getUser: vi.fn() },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import {
  DEFAULT_REST_SECONDS,
  getLastUsedRestSeconds,
  loadRestPreferences,
  loadRestPreferencesAsync,
  resolveRestSeconds,
  saveRestPreference,
  type RestPreferences,
} from '../src/lib/restPreferences';

// Mock localStorage on globalThis.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('restPreferences', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveRestSeconds', () => {
    it('uses the saved preference for a known movement', () => {
      const prefs: RestPreferences = {
        'ex-pullups': { restSeconds: 240, updatedAt: '2026-06-17T10:00:00.000Z' },
      };
      expect(resolveRestSeconds(prefs, 'ex-pullups')).toBe(240);
    });

    it('falls back to the last-used duration for an unknown movement', () => {
      const prefs: RestPreferences = {
        'ex-pullups': { restSeconds: 240, updatedAt: '2026-06-17T10:00:00.000Z' },
        'ex-rows': { restSeconds: 120, updatedAt: '2026-06-17T11:00:00.000Z' },
      };
      // ex-rows is newest -> last used is 120
      expect(resolveRestSeconds(prefs, 'ex-curls')).toBe(120);
    });

    it('falls back to the default when there are no preferences', () => {
      expect(resolveRestSeconds({}, 'ex-anything')).toBe(DEFAULT_REST_SECONDS);
    });

    it('honours an explicit fallback argument', () => {
      expect(resolveRestSeconds({}, 'ex-anything', 60)).toBe(60);
    });
  });

  describe('getLastUsedRestSeconds', () => {
    it('returns the rest_seconds of the entry with the newest updatedAt', () => {
      const prefs: RestPreferences = {
        a: { restSeconds: 90, updatedAt: '2026-06-17T10:00:00.000Z' },
        b: { restSeconds: 300, updatedAt: '2026-06-17T12:00:00.000Z' },
        c: { restSeconds: 150, updatedAt: '2026-06-17T11:00:00.000Z' },
      };
      expect(getLastUsedRestSeconds(prefs)).toBe(300);
    });

    it('returns null for an empty map', () => {
      expect(getLastUsedRestSeconds({})).toBeNull();
    });
  });

  describe('saveRestPreference + loadRestPreferences (cache round-trip)', () => {
    it('writes a preference to the cache and reads it back', () => {
      saveRestPreference('user1', 'ex-pullups', 240);
      const prefs = loadRestPreferences('user1');
      expect(prefs['ex-pullups']?.restSeconds).toBe(240);
      expect(typeof prefs['ex-pullups']?.updatedAt).toBe('string');
    });

    it('clamps out-of-range durations', () => {
      saveRestPreference('user1', 'ex-a', 1);      // below min
      saveRestPreference('user1', 'ex-b', 99999);  // above max
      const prefs = loadRestPreferences('user1');
      expect(prefs['ex-a']?.restSeconds).toBe(5);
      expect(prefs['ex-b']?.restSeconds).toBe(3600);
    });

    it('isolates preferences per user', () => {
      saveRestPreference('user1', 'ex-a', 120);
      expect(loadRestPreferences('user2')).toEqual({});
    });

    it('returns an empty map for malformed cache JSON', () => {
      localStorageMock.setItem('hyper:rest-preferences:user1', 'not json');
      expect(loadRestPreferences('user1')).toEqual({});
    });
  });

  describe('loadRestPreferencesAsync', () => {
    it('maps DB rows into the cache', async () => {
      supabaseMock.from.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({
            data: [
              { exercise_id: 'ex-pullups', rest_seconds: 240, updated_at: '2026-06-17T10:00:00.000Z' },
            ],
            error: null,
          })),
        })),
      });

      const prefs = await loadRestPreferencesAsync('user1');
      expect(prefs['ex-pullups']?.restSeconds).toBe(240);
      // cache is populated too
      expect(loadRestPreferences('user1')['ex-pullups']?.restSeconds).toBe(240);
    });

    it('keeps the newer of local vs remote per movement', async () => {
      // Local has a NEWER value for ex-a; remote is older.
      saveRestPreference('user1', 'ex-a', 200); // stamped "now" (newest)
      supabaseMock.from.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({
            data: [
              { exercise_id: 'ex-a', rest_seconds: 999, updated_at: '2000-01-01T00:00:00.000Z' },
              { exercise_id: 'ex-b', rest_seconds: 120, updated_at: '2026-06-17T09:00:00.000Z' },
            ],
            error: null,
          })),
        })),
      });

      const prefs = await loadRestPreferencesAsync('user1');
      expect(prefs['ex-a']?.restSeconds).toBe(200); // local newer wins
      expect(prefs['ex-b']?.restSeconds).toBe(120); // remote-only added
    });

    it('falls back to cache when the DB errors', async () => {
      saveRestPreference('user1', 'ex-a', 150);
      supabaseMock.from.mockReturnValueOnce({
        upsert: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
        })),
      });

      const prefs = await loadRestPreferencesAsync('user1');
      expect(prefs['ex-a']?.restSeconds).toBe(150);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- restPreferences`
Expected: FAIL — cannot resolve `../src/lib/restPreferences` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/restPreferences.ts`:

```typescript
import { supabase } from '@/lib/supabase';

export interface RestPreferenceEntry {
  restSeconds: number;
  updatedAt: string; // ISO timestamp
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- restPreferences`
Expected: PASS (all cases).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: PASS (no errors in the new files).

- [ ] **Step 6: Commit**

```bash
git add src/lib/restPreferences.ts tests/restPreferences.test.ts
git commit -m "feat: add restPreferences lib (per-movement rest durations)"
```

---

## Task 3: Add `onDurationChange` to `RestTimerPill`

**Files:**
- Modify: `src/components/workout/RestTimerPill.tsx`

- [ ] **Step 1: Add the prop to the interface**

In `RestTimerPillProps` (around line 21-27), add the optional callback after `onDismiss`:

```typescript
interface RestTimerPillProps {
  workoutId: string;
  /** Bump to start a fresh timer (new set logged) */
  sessionSeed?: number;
  defaultSeconds?: number;
  onDismiss: () => void;
  /** Fired when the user explicitly picks a new duration (preset). */
  onDurationChange?: (seconds: number) => void;
}
```

- [ ] **Step 2: Destructure the prop**

Update the component signature (around line 57):

```typescript
export function RestTimerPill({ workoutId, sessionSeed = 0, defaultSeconds = 90, onDismiss, onDurationChange }: RestTimerPillProps) {
```

- [ ] **Step 3: Fire the callback when a preset is chosen**

In `handleSetTime` (around line 142-148), call the callback after starting the new session:

```typescript
  const handleSetTime = (newSeconds: number) => {
    tapHaptic();
    const nextSession = createRestTimerSession(workoutId, newSeconds);
    saveRestTimerSession(nextSession);
    setSession(nextSession);
    completionHandledRef.current = false;
    onDurationChange?.(newSeconds);
  };
```

Do **not** add the callback to `handleReset` — reset re-creates at the current duration and does not change the chosen value.

- [ ] **Step 4: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: PASS. (No call sites break: the prop is optional, and existing usage in `Workout.tsx` doesn't pass it yet.)

- [ ] **Step 5: Commit**

```bash
git add src/components/workout/RestTimerPill.tsx
git commit -m "feat: RestTimerPill emits onDurationChange on preset choice"
```

---

## Task 4: Wire `Workout.tsx`

**Files:**
- Modify: `src/pages/Workout.tsx` (import; new state near line 135; init effect; `handleSetLogged` near line 896; `RestTimerPill` render near line 1812)

- [ ] **Step 1: Import the lib**

Add near the other `@/lib` imports (the rest-timer import is at line 33):

```typescript
import { loadRestPreferences, loadRestPreferencesAsync, resolveRestSeconds, saveRestPreference } from '@/lib/restPreferences';
```

- [ ] **Step 2: Add state for the active timer's movement + duration**

Next to `const [restTimerSeed, setRestTimerSeed] = useState(0);` (line 135), add:

```typescript
  const [restTimerExerciseId, setRestTimerExerciseId] = useState<string | null>(null);
  const [restTimerSeconds, setRestTimerSeconds] = useState(90);
```

- [ ] **Step 3: Warm the preference cache on mount**

After the existing rest-timer sync effect (the one ending at line 234, `}, [currentWorkoutId]);`), add a new effect:

```typescript
  useEffect(() => {
    if (!userId) return;
    void loadRestPreferencesAsync(userId);
  }, [userId]);
```

- [ ] **Step 4: Resolve the per-movement duration when a set is logged**

Replace `handleSetLogged` (lines 896-911) with:

```typescript
  const handleSetLogged = (loggedSet: WorkoutSet) => {
    if (loggedSet.completed) return;

    const startRestForExercise = (exerciseId: string) => {
      const prefs = userId ? loadRestPreferences(userId) : {};
      setRestTimerExerciseId(exerciseId);
      setRestTimerSeconds(resolveRestSeconds(prefs, exerciseId, 90));
      setRestTimerSeed((current) => current + 1);
      setShowRestTimer(true);
    };

    const supersetFlow = supersetFlowMap.get(loggedSet.exercise_id);

    if (!supersetFlow) {
      startRestForExercise(loggedSet.exercise_id);
      return;
    }

    if (supersetFlow.role === 'B') {
      startRestForExercise(loggedSet.exercise_id);
    }
  };
```

- [ ] **Step 5: Pass the resolved duration + save callback to the pill**

Replace the `RestTimerPill` render (lines 1812-1819):

```typescript
      {showRestTimer && (
        <RestTimerPill
          key={`${currentWorkout.id}:${restTimerSeed}`}
          workoutId={currentWorkout.id}
          sessionSeed={restTimerSeed}
          defaultSeconds={restTimerSeconds}
          onDurationChange={(seconds) => {
            if (userId && restTimerExerciseId) {
              saveRestPreference(userId, restTimerExerciseId, seconds);
            }
          }}
          onDismiss={() => setShowRestTimer(false)}
        />
      )}
```

- [ ] **Step 6: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: PASS. Watch for: unused-var lint if any new state is unused (all three are used), and that `WorkoutSet` is already imported (it is — used in the existing signature).

- [ ] **Step 7: Commit**

```bash
git add src/pages/Workout.tsx
git commit -m "feat: resolve & persist per-movement rest duration in workout"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS — including the new `restPreferences` suite and the unchanged `restTimer` suite.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS, no warnings introduced.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke (dev server)**

Run: `npm run dev`, then in the app (or `/preview`):
1. Start a workout, log a set of movement A → rest timer appears.
2. Open the timer, pick a different preset (e.g. 3m) → timer restarts at 3m.
3. Log another set of movement A → timer auto-starts at 3m (the saved preference). ✅
4. Log a set of a different movement B you've never customized → timer auto-starts at 3m (last-used). ✅
5. (If on the live DB with the migration applied) reload the page / sign in elsewhere → movement A still starts at 3m. On `/preview`, the value persists for the session via the cache but DB writes are no-ops — that's expected.

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A
git commit -m "chore: per-movement rest timer verification fixups"
```

(Skip if nothing changed.)

---

## Self-review notes

- **Spec coverage:** per-movement persistence (Tasks 2+4), Supabase storage (Task 1), last-used fallback via `MAX(updated_at)` (`getLastUsedRestSeconds`, Task 2), 90s ultimate fallback (`DEFAULT_REST_SECONDS`), implicit save on preset only (Task 3 fires `onDurationChange` from `handleSetTime` only; `handleReset` excluded), pill visuals unchanged (Task 3 adds a prop, no markup change), preview unaffected (no mock change). All covered.
- **Type consistency:** `RestPreferences`, `RestPreferenceEntry`, `resolveRestSeconds`, `getLastUsedRestSeconds`, `saveRestPreference`, `loadRestPreferences`, `loadRestPreferencesAsync`, `mergeRestPreferences`, `DEFAULT_REST_SECONDS` are named identically in the lib, the test, and the `Workout.tsx` wiring.
- **No placeholders:** every code step shows complete code.
- **Edge case (documented, intended):** an unconfigured movement re-reads last-used each time, so its starting default can drift if other movements change in between — matches the chosen "last rest time taken" semantics.
```
