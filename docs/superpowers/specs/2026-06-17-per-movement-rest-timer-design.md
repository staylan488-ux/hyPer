# Per-movement rest timer persistence — design

**Date:** 2026-06-17
**Status:** Approved design, pending spec review
**Branch target:** new feature branch off `main`

## Problem

The mid-workout rest timer always auto-starts at a hardcoded 90 seconds. Every
movement gets the same default, and any duration the user picks is forgotten the
moment the timer is dismissed. Users want the timer to remember a preferred rest
length **per movement** and to reuse it on future sets and future workout days.

## Goal

When a set is logged, auto-start the rest timer at a duration resolved for that
movement:

1. If the movement has a saved preference, use it.
2. Otherwise use the **last-used** rest duration (the most recent length the user
   set for any movement).
3. Otherwise fall back to the existing 90s default (first use ever).

Preferences persist in the user's Supabase account so they survive across workout
days and sync across devices. Setting a duration on the timer (picking a preset)
*is* what establishes the preference — no separate save action.

## Decisions (locked)

- **Storage:** Supabase (synced across devices), not localStorage-only. The user
  explicitly requested this, which clears the "avoid DB schema changes" guardrail.
  A localStorage cache still fronts the DB for instant reads (mirrors the existing
  `plan_schedules` pattern).
- **Last-used semantics:** persisted globally — the most recent duration the user
  set for any movement, remembered across workouts (not reset per session).
- **Pill visuals:** unchanged. Only the duration wiring changes; no movement-name
  label is added.

## Current behavior (for reference)

- `Workout.tsx` `handleSetLogged(loggedSet)` bumps `restTimerSeed` and shows
  `RestTimerPill`. `loggedSet.exercise_id` identifies the movement.
- `RestTimerPill` is rendered **without** a `defaultSeconds` prop, so it always
  uses its 90s default. Timer session state lives in localStorage under
  `hyper:rest-timer`, keyed only by `workoutId`.
- `restTimer.ts` owns session create/sync/pause/resume/persist helpers.
- A "movement" is an `Exercise` (`exercise_id`).

## Data model

New table `exercise_rest_preferences`, modeled on `plan_schedules`:

```sql
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

Migration file: `supabase/migrations/<timestamp>_add_exercise_rest_preferences.sql`.

**Last-used needs no extra storage.** It is the row with the newest `updated_at`
for that user. Every explicit duration change upserts a row (bumping
`updated_at`), so the most-recent row is the last-used value. One table covers
both per-movement preferences and the global fallback.

## New module: `src/lib/restPreferences.ts`

Mirrors `planSchedule.ts`: a localStorage cache for instant synchronous reads plus
DB sync for durability. Cache key: `hyper:rest-preferences:<userId>`. Cache shape:
`Record<exerciseId, { restSeconds: number; updatedAt: string }>`.

Public API:

- `loadRestPreferencesAsync(userId): Promise<RestPreferences>` — fetch all of the
  user's rows from the DB, populate the cache, return them. Called once on Workout
  page mount.
- `loadRestPreferences(userId): RestPreferences` — synchronous read from the
  localStorage cache. Used at the moment a set is logged.
- `resolveRestSeconds(prefs, exerciseId, fallback = 90): number` — returns the
  movement's saved preference, else the last-used value (entry with max
  `updatedAt`), else `fallback`.
- `saveRestPreference(userId, exerciseId, seconds): void` — write the cache
  immediately and upsert to the DB (`onConflict: 'user_id,exercise_id'`,
  `updated_at: now`). Fire-and-forget; failures fall back to the cache silently
  (same approach as `saveToDB` in `planSchedule.ts`).

Types exported: `RestPreferenceEntry`, `RestPreferences`.

## Wiring

### `Workout.tsx`
- On page init (alongside the existing plan-schedule load), call
  `loadRestPreferencesAsync(userId)` to warm the cache. Hold the resolved prefs in
  component state so the callback can update them in place.
- New state: `restTimerExerciseId` (which movement the active timer belongs to)
  and `restTimerSeconds` (resolved starting duration).
- In `handleSetLogged(loggedSet)`: resolve
  `restTimerSeconds = resolveRestSeconds(prefs, loggedSet.exercise_id, 90)`, set
  `restTimerExerciseId = loggedSet.exercise_id`, then bump the seed / show the
  timer as today. Supersets: key off the triggering set's `exercise_id` (the set
  that fires the rest), consistent with the existing role-B trigger.
- Pass `defaultSeconds={restTimerSeconds}` to `RestTimerPill`.
- Pass `onDurationChange={(seconds) => { saveRestPreference(userId, restTimerExerciseId, seconds); /* update local prefs state */ }}`.

### `RestTimerPill.tsx`
- Already accepts `defaultSeconds` — it just needs to actually receive it (no
  signature change there).
- Add optional prop `onDurationChange?(seconds: number): void`. Call it inside
  `handleSetTime` (the preset buttons — the only place the user explicitly chooses
  a duration). `handleReset` re-creates at the current duration and does **not**
  fire it.
- No visual changes.

### `src/lib/supabase.ts`
- Add `exercise_rest_preferences` Row/Insert/Update entries to the `Database`
  type.

## Persistence rules

- Only an **explicit** preset choice persists a preference. The auto-resolved
  starting duration is never written back, so the saved value reflects "I set it
  to 4 minutes," not "the timer happened to start at 4 minutes."
- A movement with no saved preference re-reads last-used at each log time, so its
  starting default can drift if the user changes other movements in between. This
  is the literal meaning of "default to the last rest time taken" and matches the
  chosen semantics.

## Preview / mock

The preview mock (`mockSupabase.ts`) returns `[]` for unknown tables and accepts
upserts as no-op mock rows, so `/preview` keeps working: reads return empty →
everything falls back to the 90s default; writes are harmless. No mock changes
required.

## Testing

New `tests/restPreferences.test.ts`, mirroring `restTimer.test.ts` with an
in-memory storage stub:

- `resolveRestSeconds` precedence: saved pref → last-used → fallback.
- Last-used resolves to the entry with the newest `updatedAt`.
- Cache round-trip (save → load returns the same map).
- Fallback to 90 when the cache is empty.

DB calls are exercised via the existing preview mock pattern; unit tests target
the pure resolution/cache logic with an injected storage, not live Supabase.

## Definition of done

Per `CLAUDE.md`: `npm run test`, `npm run lint`, `npm run build` all pass.
Manual check: log two sets of one movement, change the timer on the first rest,
confirm the second set auto-starts at the new duration; start a different
movement and confirm it inherits last-used.

## Out of scope (YAGNI)

- Settings UI to browse/edit/clear per-movement rest times.
- Movement-name label on the pill.
- Per-set (vs per-movement) rest customization.
