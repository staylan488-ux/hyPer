# Historical instruction and handoff snapshot

Archived 2026-09-04. This is evidence of prior work, not current policy or authorization. Status, pending tasks and commands below may be superseded; consult the current checkout and the active conversation. The Studio change is already merged in 1fe8e4b (#105); older requests to open or merge it are historical.

---

# AGENTS.md

Use this file as the single source of truth when handing off work between sessions or starting a new session.

## Session Startup (always first)

1. `git branch --show-current`
2. `git status --short`
3. `git log --oneline -5`
4. Read `CLAUDE.md`
5. Read `TOOL_SWITCHING_CHECKLIST.md` for context handoffs

## Operating Contract (stable)

- Workflow: Understand -> Delegate -> Split/Parallelize -> Plan -> Execute -> Verify.
- Definition of done (required):
  - `npm run test`
  - `npm run lint`
  - `npm run build`
- Keep changes scoped and preserve existing behavior.
- Do not touch auth flow or DB schema unless explicitly requested.
- Never expose secrets or commit `.env`.
- For meaningful UI work:
  - Propose 2-3 visual directions before major redesign implementation.
  - Define typography, color tokens, spacing, and motion decisions before coding.

## Role-Based Guidance

- Discovery/search: map unknown files, symbols, and references before planning.
- Documentation/research: check official docs for version-specific APIs and edge cases.
- UI/UX design: shape user-facing flows and visual polish with intentional design direction.
- Implementation: execute clear, scoped changes quickly and safely.
- Architecture/debugging: use deeper analysis for high-risk trade-offs or persistent root-cause issues.
- If your harness does not support delegation, perform these roles sequentially in one session.

## Must-Work Product Flows

1. Nutrition/Food logging with time.
2. Workout start/log/complete and set save behavior.
3. Editing past workouts and nutrition entries.
4. Volume recommendation/status behavior.
5. Program management (view/edit/delete active program).
6. Session restore/sign-in persistence.

## Handoff Template (copy/paste)

```text
SESSION HANDOFF SUMMARY
- Branch:
- Last commit hash + message:
- PR URL (if any):
- What changed:
- Files touched:
- Verification:
  - npm run test:
  - npm run lint:
  - npm run build:
- Remaining tasks:
- Risks / gotchas:
- Next recommended command:
```

## Current Handoff State — refined app icon

- Updated: 2026-09-04
- Branch: `feat/refined-app-icon`
- Base: `1fe8e4b` — approved Studio design (#105), synced from main before work.
- User approved the elegant paper/red P with corrected vertical centering; the
  heavier rounded concept A was rejected and is not used.
- Added `assets/icon.svg` with outlined Fraunces Italic (opsz 96, wght 460,
  SOFT 18, WONK 1), `assets/README.md`, `assets/Fraunces-OFL.txt`, and
  `scripts/generate-app-icon.mjs` for repeatable export.
- Updated `assets/icon-only.png` and the iOS `AppIcon-512@2x.png` only; both are
  identical opaque RGB 1024×1024 files. Measured glyph margins: 222 px above and
  below. No native configuration, splash, auth, schema, or in-app UI changes.
- Verification: tests PASS (62 files, 668 tests), lint PASS, build PASS (existing
  chunk-size/Browserslist warnings). Final export inspected visually and checked
  for matching pixels, opacity, size, and centering. Xcode asset catalog
  compilation PASS (`xcrun actool`, iPhone/iPad simulator).
- Remaining: PR/merge and a new native/TestFlight build; on-device appearance
  validation is still needed because iOS applies its own icon effects.
- Preserve unrelated `.gitignore` modification and untracked
  `supabase/.temp/linked-project.json`.
- Next: `git diff --stat`, then review the icon change for release.

## Previous Handoff State — approved Studio implementation

- Updated: 2026-09-04
- Branch: `codex/studio-app-wide`
- Worktree: `/private/tmp/hyper-studio-20260904`
- Base: `f711882` — adaptive workout calendar (#104)
- Status: implemented and verified, ready for draft PR review. No merge, deployment or TestFlight upload.
- Plan and detailed evidence: `docs/plans/2026-09-04-studio-app-wide.md`.

### What changed

- App-wide approved Studio: Fraunces/Geist roles, coherent Paper/Ink tokens, quiet filled controls, contextual row actions, neutral editorial content and an inset four-tab navigation.
- Anchored workout set/rest surface preserves save recovery, draft edits and superset progression. Today uses the same ordered next-set selection.
- Stationary safe-area shell, visible-viewport keyboard variables, tab scroll memory, portal sheets with nested focus/background isolation; removed route transforms around fixed descendants and decorative moving light/grain.
- Consolidated Fuel/food sheets, Programs/editor, History/past edits, Settings, volume/adherence views and shared controls. Fixed time-wheel selection races.
- DEV preview supports real mutable program/workout paths and explicit two-failure save recovery. No auth flow, store business logic, DB schema, dependencies or native source changes.

### Verification

- `npm run test`: PASS — 62 files, 668 tests.
- `npm run lint`: PASS.
- `npm run build`: PASS; existing chunk-size and Browserslist-data warnings.
- Browser: Paper/Ink, 390px and 320px layouts; food/time and past edits; program snapshot save; workout draft/save/edit/rest/completion/new session; failure→Retry; nested sheets; exact tab scroll restoration.
- Safe-area clipping verified with temporary 59px top/34px bottom simulation; those styles were removed before final build.

### Remaining / gotchas

- Physical iPhone status bar, software keyboard, touch feel/haptics, frame pacing and scanner/camera/native integrations still need device validation. No build has been sent to the phone.
- Preview uses in-memory data; a full reload resets records. Open `/preview?previewSetSave=fail` to exercise two failed automatic attempts followed by successful Retry.
- Preview at `http://127.0.0.1:5175/preview`. Screenshots and local paths are in the plan file.
- Saved checkout `/Users/sinan/orca/hyPer` remains untouched, including its `.gitignore` change and `supabase/.temp/linked-project.json`.
- Next: review `codex/studio-app-wide`, then device validation before release. No merge/deploy implied.

## Previous Handoff State — adaptive calendar — adaptive workout calendar

- Updated: 2026-09-04
- Implementation branch: `codex/adaptive-workout-calendar`
- Base: `e196e10` — workout set-save fix (preserved).
- PR: https://github.com/staylan488-ux/hyPer/pull/104
- Status: implemented and verified; user authorized GitHub PR creation and merge. Device validation remains pending.

### What Changed

- Successfully persisted completed split workouts anchor their workout date to the performed split day. Selecting or starting an unfinished workout does not shift the plan. Anchors derive from existing workout rows, so reloads and other devices reconstruct the same schedule without changing history or adding a DB schema migration.
- The saved workout order and saved weekday rest gaps form the repeating cycle, including cycles spanning multiple weeks. Both Today and Train use the same projection and completion inputs. Completing Upper B instead of queued Lower A yields Lower B, Rest, Rest, Upper A, Lower A, Rest next. Completing delayed Lower A the following day also shifts the cycle; no skip workflow is needed.
- Fixed schedules continue by calendar date; flexible schedules retain their completion-driven queue and follow the actual completed split day. Flexible mode has no saved rest rhythm.
- Completion reads are paginated and filtered to the active split (except the legacy flex-offset compatibility read). Failed reads show Retry instead of an unshifted schedule. A later schedule edit takes precedence over already-started sessions, and stale remote schedule responses cannot overwrite a newer local edit.
- Legacy flex offsets remain readable. New explicit flexible split indexes use `flexAnchorIndex` in memory/cache and the previously unused flex `weekdays` array (`[index]`, `anchor_day: null`) in the existing DB table, permitting indexes beyond 6. Fixed-mode weekday storage is unchanged.
- Calendar cells identify workout names/rest for accessibility; today's completion remains visible while browsing other weeks.

### Files Touched

- `src/lib/planSchedule.ts`
- `src/hooks/usePlanSchedule.ts`, `src/hooks/useScheduleWorkouts.ts` (new)
- `src/pages/Dashboard.tsx`, `src/pages/Workout.tsx`
- `tests/planSchedule.test.ts`
- `tests/adaptivePlanSchedule.test.ts`, `tests/schedulePersistence.test.ts` (new)
- `AGENTS.md`

### Verification

- `npm run test`: PASS (58 files, 643 tests). This clean worktree has no `.env`; tests ran with non-secret placeholders: `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=test-public-key npm run test`.
- `npm run lint`: PASS.
- `npm run build`: PASS, including TypeScript; existing chunk-size/Browserslist warnings.
- 80 scheduling tests cover the acceptance sequence, delayed Lower A, rest gaps, arbitrary split lengths, history isolation, same-date ordering, DST/year boundaries, cache-clear DB recovery, legacy flex offsets, query failure, pagination, and late background-sync races.
- Browser: completed Upper B fixture produces Lower B tomorrow, two rests, then Upper A/Lower A; Today and Train both show adapted Lower A from yesterday's Upper A. Temporary fixtures were restored. Preview's existing missing relational sets prevent a full new-session start flow, so that portion used a persisted completion fixture and integration tests.

### Remaining Tasks / Risks

- GitHub PR creation and merge are authorized in this session; device validation and a TestFlight release remain separate work. No auth, set-saving, bot, or DB-schema changes.
- History remains authoritative: deleting a completion or editing it so the existing history flow marks it incomplete removes that scheduling anchor. Editing only weight/reps on a completed session leaves the anchor intact.
- Older app builds do not interpret the new explicit flex-index encoding; validate new schedule edits with this implementation.
- `CLAUDE.md` is absent in this worktree; `AGENTS.md` and `TOOL_SWITCHING_CHECKLIST.md` were read.
- Next recommended command: `gh pr view 104`.

## Previous Handoff State — workout set-save recovery

- Updated: 2026-09-04
- Implementation branch: `fix/workout-set-save-stall`
- PR: https://github.com/staylan488-ux/hyPer/pull/103
- Base commit: `d5e3fce` — Handoff: Rev 101 scanner + provider stickiness (#102)
- Sync: fetched GitHub and fast-forwarded local `main` by 48 commits before branching.
- Status: structural Supabase lock fix plus workout set save recovery verified; TestFlight deployment and device validation pending.

### What Changed

- Upgraded `@supabase/supabase-js` from 2.95.3 to 2.115.0. Upstream removed the shared auth mutex in 2.107.0 (supabase/supabase-js#2392); this prevents an unrelated pending user lookup from blocking workout writes before their HTTP request starts.
- Root-cause reproduction: automatic foreground session refresh emits `TOKEN_REFRESHED`; the existing app callback restores photo-worker preferences if local settings are absent, calling `getUser()`. With a deliberately stalled `/auth/v1/user` response, 2.95.3 holds the auth queue and never sends the set PATCH. With the updated SDK, the same pending lookup no longer blocks the set. This runs without opening photo features, switching apps, or locking the screen.
- Set saves now have an 8-second deadline covering the entire Supabase operation, including work before fetch starts. Expired attempts are aborted; transient failures get one automatic retry using the same set ID, values, and completion timestamp.
- After failure, the row keeps entered values, releases its controls, and offers Retry. A synchronous guard prevents duplicate submissions. Rest/completion callbacks run only after a successful save.
- Delayed responses update only the original workout and set; missing workouts/sets and empty responses no longer appear successful.
- App sign-in flow, session configuration, Keychain adapter, and database schema are unchanged; the dependency update changes the SDK's internal coordination.

### Files Touched

- `package.json`, `package-lock.json` (Supabase dependency upgrade)
- `src/lib/saveWorkoutSet.ts` (new)
- `src/stores/appStore.ts`
- `src/components/workout/WorkoutSetRow.tsx`
- `src/preview/mockSupabase.ts`
- `tests/authStore.workoutIsolation.test.ts` (new, actual auth callback + SDK + async session storage)
- `tests/workoutSetSave.test.ts` (new), `tests/appStore.mustWork.test.ts`
- `AGENTS.md` (this handoff)

### Verification

- `npm run test`: PASS (56 files, 614 tests, including 20 save recovery cases and one real-SDK session/workout isolation regression)
- `npm run lint`: PASS
- `npm run build`: PASS (existing chunk-size/Browserslist warnings)
- Regression check: the never-settling-save test fails against the original store and passes with the fix.
- Structural regression: the actual app callback test fails on Supabase 2.95.3 and passes on 2.115.0, with one set PATCH completing while the unrelated user lookup is still pending. It does not depend on the save timeout/retry to pass.
- Browser: 390×844 Paper/Ink; injected hung requests unlock after two attempts, values remain intact, Retry saves one existing set and starts rest. Failed edits also retain their values and retry successfully.

### Remaining Tasks / Risks

- The installed TestFlight app does not contain this fix yet; a new build and device validation remain pending.
- User confirmed TestFlight, remaining focused in the app during stalls. Shared-auth-queue blocking is reproduced and fixed; the exact trigger on the user's phone remains unconfirmed. A stalled token refresh itself (as distinct from an unrelated user lookup) still needs to resolve before expired credentials can be renewed. Aborting a request cannot guarantee the server did not already write it; automatic retries reuse the same row/payload.
- Supabase 2.115.0 requires Node >=22 for tooling (this Mac uses a compatible runtime). Physical-device validation is still pending.
- Preserve the pre-existing `.gitignore` modification and untracked `supabase/.temp/linked-project.json`; neither belongs to this fix.
- Next recommended command: `gh pr view 103`

## Previous Handoff State — design elevation

- Updated: 2026-07-17
- Branch: `main`
- Status: design elevation LIVE — merged into `main` via pull request (2026-07-17)
- Working tree: clean
- Plan file: `docs/plans/2026-07-17-design-elevation.md` (DONE)

### What Changed

Design elevation with the FOLIO language kept intact — the wow comes from motion and material, not new colors:

- Route-level page transitions (pages "turn" instead of hard-swapping); bottom nav stays mounted; one global `MotionConfig reducedMotion="user"`; pages no longer self-animate their entrance.
- Living paper: animated film-grain canvas + drifting warm light (`PaperAtmosphere`), replacing the static SVG noise; theme-aware, pauses when tab hidden, static under reduced motion.
- `RollingNumber` letterpress-odometer digits on hero figures (kcal on Today + Fuel, sets-done count, rest-timer countdown).
- Bottom sheets dismiss by pulling/flicking down from the grab rule or title row; active nav icon settles into place.

### Files Touched

- `src/App.tsx` (route shell, MotionConfig, atmosphere mount)
- `src/lib/animations.ts` (pageTransition timing)
- `src/index.css` (paperlight/papergrain layers + tokens; static body::after noise removed)
- `src/components/shared/PaperAtmosphere.tsx` (new), `src/components/shared/RollingNumber.tsx` (new)
- `src/components/shared/{index.ts,Screen.tsx,Modal.tsx,BottomNav.tsx}`
- `src/pages/{Dashboard.tsx,Nutrition.tsx,Workout.tsx}`
- `src/components/workout/RestTimerPill.tsx`

### Verification

- `npm run test`: PASS (219)
- `npm run lint`: PASS
- `npm run build`: PASS
- Visual: 390×844 screenshots of all 7 screens (Paper), Dashboard/Settings/Fuel + FoodLogger sheet (Ink); browser console clean

### Remaining Tasks

- User local test, then merge `feat/design-elevation` → `main` (or open PR).
- One manual glance: the rest-timer rolling countdown during a real logged set (actions are stubbed in preview mode).

### Risks / Gotchas

- `Screen` no longer self-animates; the route transition owns page entrances — new pages must not add their own full-page fade.
- Grain/light layers sit above all UI (z-index 60–61) and must stay `pointer-events: none`.
- Build still reports the existing large chunk warning; this is non-blocking and pre-existing.

### Next Recommended Command

- `npm run dev` then open `http://localhost:5173/preview` (mock data, no login)

## Short Handoff History

| Date | Branch | Commit | Summary |
|---|---|---|---|
| 2026-07-17 | `feat/design-elevation` | `e50da63` | Motion-led design elevation: page turns, living paper, rolling hero numbers, sheet drag-dismiss |
| 2026-02-25 | `feat/ui-warm-carbon-train-nav` | `d53ca4f` | Train-first nav + Warm Carbon foundation updates |
