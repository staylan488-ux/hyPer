# Optimization review: whole app

Recorded 2026-09-26 (Pacific) against `main` at `e35b635`.

This was a read-only review; no code was changed. It was run as a multi-agent workflow:
- **Coverage:** 12 area reviewers and 5 cross-cutting sweeps (bundle, rendering, network, dead code, reliability), then a completeness critic and 6 gap hunts.
- **Verification:** every distinct finding got an adversarial reality check, and the survivors got a separate check that fixing them costs no feature or quality.
- **Results:** 193 raw findings merged into 133 distinct ones. 98 were confirmed, 25 refuted, and 10 were real but not worth it.

This document does not authorize any change, deployment or migration. Each batch needs the owner's go-ahead.

## The plan

## 1. Overview

**Overall health:** The app is in reasonable shape, but four patterns come up repeatedly:

1. **Some saves fail silently.** In several places the app says "done" when the save actually failed. This happens when finishing a workout, creating a program, editing History, logging food and running a WHOOP sync. Most of the high-value fixes are here.
2. **The app waits on the network more than it needs to.** It checks sign-in before nearly every query, inserts rows one request at a time, and re-downloads data it already has. Each of these costs 0.1–0.4 s per trip on mobile data.
3. **Native run tracking has a few real accuracy bugs.** Resuming a run double-counts distance, lock-screen buttons run off the main thread, and the lock-screen clock can jump.
4. **The safety net is thin.** Nothing runs the tests before a TestFlight upload, some tests only pass on your Mac, and several risky areas have no tests.

**The biggest opportunities:**

1. **Stop false "saved/done" messages in protected flows (F2, F4, F13, F14, F25, F26, G1).** Finishing a workout, creating programs, editing History, logging food and WHOOP sync would all either succeed or say clearly that they didn't. WHOOP sync can currently delete activities for good.
2. **Remove wasted network trips (F1, F3, F4, F5, F6, F15).** Every screen would load 0.1–0.4 s faster on cellular. Starting a workout would drop from about 20–25 requests to about 5. Creating a program would drop from about 43 serial requests to 4. A workout session would make about 80–100 fewer background requests.
3. **Fix native run accuracy (F8, F9, F10, F56, F57).** Resumed runs would stop inflating distance, and lock-screen buttons would stop dropping presses. Long runs would also stop hitching each time you unlock the phone.
4. **Add a safety net first (F18, F19, F72, F73).** Tests would run before every ship. They would also cover the exact code the later fixes touch, so those fixes can't quietly break something.
5. **Faster, more resilient launch (F17, F44, F7).** Fonts would ship inside the app, so a launch on bad Wi-Fi no longer shows a blank screen. The app would load about 20% less code at launch. A dead connection would give up after about 30 s instead of spinning forever.

**Expected payoff:**

- Noticeably snappier Today, Train, Nutrition and History on mobile data.
- Far fewer silent data problems in workouts, food and WHOOP.
- Correct run distances.
- Every change in this plan is guarded by tests before it reaches your phone.
- No features are removed.

**Recommended order:** Batch A (safety net, then cleanup and small fixes), then Batch B (the careful fixes, most important first), then Batch C (larger refactors). Inside Batch B, if you only do a few packages, do B‑1 (WHOOP data loss), B‑2 (run accuracy), B‑3 (finishing and starting workouts), B‑4 (programs) and B‑5 (faster queries).

**Risk scale:**
- **Low:** no protected flow is touched, or it is test/cleanup only.
- **Medium:** touches a protected flow and has a specific guard.
- **Higher:** broad change or needs a production or auth decision.

**Effort scale:** S is under half a day, M is about 1–2 days, L is multi-day.

---

## 2. Batches

### Batch A: safe quick wins

#### A1. Safety net first (tests and ship gate only; the app does not change). Do this before anything else.

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F19 | Tests stop depending on your private `.env` and can never reach production | Low | S |
| F71 | Fixes a test that fails when the Mac's time zone is east of about UTC+5 | Low | S |
| F108 | The photo-worker boot test uses a free port, so it can't falsely pass when runs overlap | Low | S |
| F18 | `ship.sh` runs tests and eslint (and uses `npm ci`) before uploading to TestFlight | Low | S |
| F20 | Tests for the iOS Keychain sign-in storage | Low | S |
| F70 | Type-checks the test files and fixes about 36 stale sample-data errors | Low | S |
| F72 | Tests for native run recovery (cursors, dedup, ordering). Needed before B‑2 | Low | M |
| F73 | Tests for "never delete finished sets" and "superset partners follow". Needed before B‑3, B‑7 and C‑3 | Low | M |

Guards:

- **F19:** Only add `test.env` in `vitest.config.ts` (fake Supabase URL on a `.invalid` host, empty worker/mode values). Prove it works by running `npx vitest run` in a throwaway worktree that has no `.env`.
- **F71:** Build the timestamps with local-time `new Date(2026, 2, 15, 23, 30)` and leave the assertions alone. Re-run under `TZ=Asia/Tokyo`, `Pacific/Kiritimati`, `Pacific/Pago_Pago` and `UTC`. Do **not** pin TZ in the config.
- **F108:** Get a free port from `listen(0)`, and only fetch `/health` once the child prints its own "listening on" line. Keep every assertion. Also check that the test still fails when the worker is broken on purpose.
- **F18:** Only lines 31–33 of `scripts/ship.sh` change: `npm ci`, then `npm run test`, then `npx eslint .`, then `npm run build`. Use `npx eslint .`, not `npm run lint`, so a docs slip can't block a ship. Verify with a copy of the script where fastlane is replaced by `echo SKIP`, then again with a deliberately failing test in a throwaway clone. Each ship takes about 30–60 s longer. Don't trigger a real ship.
- **F20:** Mock `@/lib/nativeBridge` and stub `window.localStorage`. Cover every branch, including a Keychain error before first unlock. Optional mutation check: delete `removeLegacy` and confirm a test fails.
- **F70:** Add a separate `tsconfig.test.json` plus a `typecheck:tests` script, chained into `lint` only (not build or vitest). Fix fixtures to their real shapes, with no `as any` or `@ts-ignore`. Never edit an `expect(...)`. The test count must stay the same.
- **F72:** Only add `tests/nativeRunSource.test.ts`. Add no buffering fix.
- **F73:** Assert end states (which ids were deleted or inserted), not call counts. Don't lock in the live/History numbering drift; mark it `it.todo` for F28. Check each test by temporarily flipping one guard.

#### A2. Cleanup with no behavior change

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F55 (step 1) | Deletes the ~720-line stale, unused `Database` type from `supabase.ts` | Low | M* |
| F77 | Deletes three uncalled store actions (one is broken) and the dead `loading` field | Low | S |
| F88 + F52 | **Do together** (same CSS and shared barrel). Removes dead shared components and about 6 KB of dead CSS, including rules that silently override standard Tailwind classes | Low | S + S |
| F94 | Keeps the DEV preview fixtures ("Sam Rivera") out of the production bundle with one Vite setting | Low | S |
| F98 | Removes the unused `recharts` and `@capacitor/browser` (still linked into iOS) | Low | S |
| F97 | Real PWA icons and favicon; removes the dead USDA cache rule and `vite.svg` | Low | S |
| F66 (step A) | Deletes the unused `process-food-photo` function code and config from the repo | Low | S |
| F110 | Deletes the unreachable Cronometer importer. **Your call:** delete (default) or bring it back | Low | S |
| F64 (tier 1) | Brings `schema.sql` back in line with production as a dated reference document | Low | M |

\*F55's effort is listed as M, but step 1 on its own is a deletion.

Guards:

- **F55:** Grep that nothing imports `Database` or `Json`. Leave lines 1–28 of `supabase.ts` untouched. `tsc -b` in the build catches any miss.
- **F77:** Grep first. Also remove `loading: false` from `previewSeed.ts:44`, and the three imports that become unused. Keep `updateSplit`, which is tested.
- **F88 + F52:**
  - Where a rule groups dead names with live ones, remove only the dead names from the selector list. Keep `--font-mono`, `--ease-out-quart`, the shimmer, and reduced-motion handling. Keep `resetMotionLight`.
  - Re-run the grep before deleting.
  - Diff the built CSS, then check Today, Train, Fuel, You, History, Analysis and the barcode overlay visually in light and dark.
- **F94:** Only change `vite.config.ts` (`moduleSideEffects`, excluding `flag.ts`). `grep preview-user dist/assets/*.js` must return 0, and `/preview` must still work in dev.
- **F98:** The lockfile diff must be removals only. After `cap sync`, `Package.swift` should lose only the Browser lines. Keep `@capacitor/app`. Native build, then check Google/Apple sign-in and a cold relaunch.
- **F97:** Generate the icons with the existing Sharp script. The native `AppIcon` and `icon-only.png` must stay byte-identical. Chrome's manifest panel must show no installability errors.
- **F66 (step A):** Repo only. Update the skill reference line and run `npm run check:instructions`. Deleting the deployed function is a production step (see C‑6).
- **F110:** Keep the `cronometer` and `cronometer_csv` source literals, the ledger label, the table typing and the migrations, so past entries still show "Cronometer".
- **F64 (tier 1):** Only `schema.sql` changes, and nothing reads it. Build it from a read-only `supabase db dump` if you can log in, otherwise from the migrations.

#### A3. Small, contained fixes

**Train/Today refetch trims** (`Workout.tsx` and `appStore.fetchSplits`; do together):

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F5 | Logging a set no longer re-downloads last month's workouts twice (about 4 requests per set, 80–100 per session) | Low–Med | S |
| F32 (scoped) | Moves the "last time" lookup into a tested `src/lib/previousSetTargets.ts`. Its dependency-key change is **the same change as F5(a)**; do it once. Optional: the lock-screen tonnage uses `sessionTonnage` | Low–Med | L (scoped version is much smaller) |
| F30 | A 1-second clock no longer redraws the whole workout screen (moves into a tiny `SessionClock`) | Low | S |
| F6 | `fetchSplits` skips the store update when nothing changed, so Today and Train stop fetching history twice per visit | Low | S |

Guards:

- **F5 / F32:** Only change the effect dependencies: a sorted exercise-id key for targets, and `currentWorkoutId` plus a plain `currentWorkoutCompleted` variable for the calendar. Queries stay as they are. exhaustive-deps lint must pass. In the network tab, logging sets must cause no GETs to `/workouts` or `/sets`. Adding or substituting an exercise must still refetch. Finishing a workout must still update the week strip and "Last trained".
- **F32:** Do **not** do the full component split.
- **F30:** Build the completion-summary duration from `Date.now()` at capture time. Don't add `React.memo` to set rows.
- **F6:** Skip `set()` when the new data is `JSON.stringify`-equal to the old. Add tests that identical payloads keep the same references and that real edits produce new ones.

**Weekly volume** (`calculateWeeklyVolume`, Dashboard, Analysis; do together):

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F24 | The volume week becomes Monday–Sunday, like the Coaching header and hours chart. Fixes the false "everything below MEV" every Sunday. **Needs your yes:** does the training week start Monday? | Low | S |
| F23 | Volume and your landmarks always load together, so the first-open "Under-stimulated / No landmarks set" glitch goes away | Low | S |
| F68 | One `classifyVolume` rule for both the status chip and the advice line (cleanup, not a speed gain) | Low | S |

Guards:

- **F24:** Only `appStore.ts:2866-2867` changes. Add date-pinned Sunday and Monday tests for the exact `gte`/`lte` dates.
- **F23:** Move the math unchanged into a pure helper, including thresholds, 0.5 weighting and Map order. Run landmarks and workouts in `Promise.all`. A failed landmarks query keeps the stored landmarks.
- **F68:** Add exact-boundary tests before moving the code, and keep the message strings identical.

**Settings and body data:**

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F36 | Saved meals opens instantly, with no second download and no "Loading targets…" flash | Low | S |
| F81 | The lb/wk figure on You uses the same 21-day rate as the coach, and the label says so. **Your call:** 21 days (matches coach) or 30 | Low | S |
| F58 | Apple Health sync imports your full weight history in one pass, so "latest weight" is right away correct | Low | S |
| F83 | Plan-schedule saves retry after a failed upload; no pointless "Set plan start" prompt on a new device | Low | S |

Guards:

- **F36:** Keep the target editor disabled until fresh values load.
- **F81:** Use a *second* `buildWeightTrend` for the rate only. The charts stay unchanged.
- **F58:** Loop until the batch is under 500 samples, with a no-progress stop and a 20-pass cap. Save the cursor after each successful batch. Test on a device.
- **F83:** Keep the original `updatedAt` so last-writer-wins still holds. Stop retrying on 23503 and 23514 errors.

**Photo and AI worker:**

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F54 | When the Mac worker is off, you get "can't reach worker" in about 15–20 s instead of 15 minutes of spinning | Low | S |
| F16 | A retry joins the queued job instead of running a second multi-minute analysis | Low | S |
| F103 | Two product searches run in parallel in `analyze-food-trial` | Low | S |

Guards:

- **F54:** Only fail fast while no attempt has "reached" the worker (a response, or an attempt that stayed open 3 s or more). Timeouts keep today's patient retry. All six existing tests must pass.
- **F16:** A `WorkerBusyError` must never be stored in `failureCache`.
- **F103:** Only takes effect with the next edge-function deploy **you** ask for.

**Launch and resilience:**

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F17 | Fonts ship inside the app, so no blank screen on bad Wi-Fi, it works offline, and Google no longer sees your IP on each launch | Low–Med | S |
| F112 | A crash on one screen shows a "Something went wrong" page with working tabs instead of a dead page | Low | S |
| F50 (step 1) | Turning on Reduce Motion mid-session stops the tilt light right away | Low | S |

Guards:

- **F17:** Use Google's *exact* woff2 files and keep the latin-ext subset (Turkish letters). Compare screenshots in light and dark. Test launch with 100% packet loss.
- **F112:** One pathless route with `errorElement` inside `PrivateLayout`. Test by temporarily throwing inside a page.
- **F50:** Also add `prefers-reduced-motion` to the CSS backstop.

**Small correctness fixes:**

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F11 | Dumbbell-only guided programs keep their overhead press ("Overhead Dumbbell Press") | Low | S |
| F75 | "Move to previous day" keeps the exact time across daylight-saving changes | Low | S |
| F27 | Deleting a workout becomes all-or-nothing | Low | S |
| F82 | The exercise picker opens instantly after its first load and works offline mid-workout | Low | S |

Guards:

- **F11:** Edit `snapshot.ts` by hand; do **not** run `evidence:import`. Add a test that every generated name exists in the seed.
- **F75:** One line (`setDate`) plus a DST test.
- **F27:** First run the read-only SQL check that production cascades both foreign keys. Keep the throw-on-error behavior. Clear `currentWorkout` if it was the deleted one.
- **F82:** Never cache a failure, show Retry, keep a fresh fetch at SplitBuilder save time, and invalidate on sign-out.

**Memory and visual polish:**

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F51 | The 3D figure stops keeping old renderers in memory | Low | S |
| F87 (part 1) | Frees about 6 MB of PMREM scratch memory in the 3D scenes | Low | S |
| F92 | The burst canvas releases about 5 MB when idle | Low | S |

Guards:

- **F51:** A per-instance sphere with the same 48×32 detail.
- **F87:** Part 1 is two lines. Part 2 (768 textures) is optional, only with a device screenshot comparison.
- **F92:** Check that bursts stay sharp after a rotation.

**Small native fixes** (need a native build per ship-ios):

| ID | What it does | Risk | Effort |
|---|---|---|---|
| G7 | The rest-dock ring stops animating on every display frame | Low | S |
| G17 | The iOS scanner ignores GS1 DataBar strips instead of failing a checksum | Low | S |

Guards:

- **G7:** Key the animation on `endsAt` and `total`, never on `pausedRemaining`. Drop the change if the ring looks stepped on short rests.
- **G17:** Skip payloads that are not 8, 12, 13 or 14 digits. Test on a real iPhone, because the Simulator can't run the scanner.

---

### Batch B: medium fixes that need care (in this order)

**B‑1. WHOOP sync integrity** (`appStore` `syncWhoop`, `whoopSync.ts`)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| G1 | A failed read aborts the sync ("Sync unavailable") instead of deleting, duplicating or reviving activities. **Top priority: some of this damage is permanent** | Med | S |
| G14 | The tests that prove G1 works; they land in the same change | Low | S |
| G4 | Overlapping syncs (auto, Settings, History) share one run, so no duplicates | Low | S |
| G13 | Apply writes with bounded parallelism of 4 and accurate "N new" counts. First sync gets about 3–5× faster | Med | M |

Guards:

- **G1:**
  - Only the sync's ports throw on error. Leave the shared store actions alone, because `saveTrackedRun` depends on them.
  - Skip deletes when a segment read returns zero segments.
  - In `saveTrackedRun`, log and skip the merge rather than throw.
  - Test with five rejecting-port cases, write them red first, and keep every happy-path test.
- **G4:** A keyed single-flight helper by user id, registered with no await after `getUser`.
- **G13:** Keep the phase order (create → update → relink → delete) and never throw on a link failure.

Verify in `/preview`: syncs from History and Settings, then toast counts against the calendar.

**B‑2. Native run tracking** (`nativeRunSource.ts`, `useRunTracker`, `runTracker`, `HyperRunPlugin.swift`, `RunLiveActivity.swift`). Needs F72 first.

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F8 | A resumed run no longer double-counts distance or replays laps and lock-screen taps (high severity) | Med | S |
| F9 | Lock-screen Split/Rest/Finish run on the main thread, so no dropped presses or crash race | Med | S |
| F57 | A failed disk write can't cause an endless drain loop | Low | S |
| F10 | Unlocking mid-run only processes new GPS points, so no growing hitch on long runs | Med | M |
| F56 | The lock-screen clock stays correct after Rest/Resume; the Finish confirmation isn't reset by syncs | Med | S |

Guards:

- **F8:** Store the cursors *inside* the saved state. Advance them for every delivered sample, including paused, warming and stale ones. If native reset the recording, drop the cursors to 0. For old snapshots, fall back to `lastSampleMs`.
- **F9:** Wrap only the `post` in `await MainActor.run`, and add a defensive main-thread hop in `handleRunControl`.
- **F57:** `hasMore` becomes "page is full". The JS loop stops when neither cursor moved.
- **F10:** The cursor only advances over an unbroken run of sequence numbers. The Swift resume point is cleared on reset, discard and resume. Keep the work on the main queue.
- **F56:** Carry elapsed time forward before toggling Rest, in both intent copies. Keep `finishArmedUntil`. Do not skip the throttle.

Verify on a device:
- lock and unlock several times on a 20+ minute run;
- switch tabs mid-run and resume;
- force-quit mid-run and resume;
- use Live Activity Split ×2, Rest, then Finish ×2;
- in intervals mode, confirm no burst of lap beeps;
- use a Debug build with Main Thread Checker on.

**B‑3. Finishing and starting workouts** (`appStore`, `Workout.tsx`, `Splits.tsx`). Needs F73 first.

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F2 | Finish only celebrates after the save lands; on failure the session stays open with "try again". Normal finishes get faster | Med | S |
| F3 | Starting a workout sends one batched set insert (about 20–25 requests down to about 5). A failed start says "couldn't start" instead of silently creating a partial workout | Med | M |

Guards:

- **F2:**
  - Build the completion summary *before* the await and show it after.
  - Add a `finishing` guard that disables the buttons.
  - Don't await `calculateWeeklyVolume`.
  - Keep `resolveWorkoutCompletedAt` and the prompt order.
  - Add three new tests.
  - Test Finish in airplane mode.
- **F3:**
  - Keep the row order and `set_number`s identical.
  - If the batch fails, delete the empty workout and throw.
  - `null` still means only "a split workout is already in progress".
  - Update the `addFlexibleSuperset` expectation to one call with 3 rows.
  - Leave the renumber loop alone.
  - Test the airplane-mode Start message.

**B‑4. Programs** (`appStore` split actions, `SplitBuilder.tsx`, `SplitEditor.tsx`, `splitEditStore.ts`, `compiler.ts`)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F4 | Creating a program is one atomic save (about 43 requests down to 4), only one program is ever Active, and failed create/activate/delete show a message (high severity) | Med | M |
| F45 | Editor rows no longer remount on commit, so the keyboard stays up and tapping in and out doesn't mark the program as changed | Med | S |
| F46 | Typing in the editor only redraws what changed | Low | S |
| F47 | Builder set/rep boxes can be cleared and retyped; one shared set-range component | Med | M |
| F67 | New template programs keep heavy lifts (Row, Lunge, Arnold Press) before isolation work | Low | M |

Guards:

- **F4:**
  - Use the existing `save_split_snapshot` RPC with `day_order`/`exercise_order` taken from the array index and `p_days_per_week = splitData.days_per_week`.
  - Insert the split inactive and activate it only after success.
  - Activate the target first, then deactivate the others.
  - Keep the builder open on failure.
  - **Intended change:** deleting the active program now leaves no program active.
- **F45:** Add the store no-op guard first. Key rows by `exercise.id` with a single-field editing overlay.
- **F46:** Use per-field selectors, `React.memo`, and a **required** `LayoutGroup`.
- **F47:** A pure `setRangeDraft.ts` with unit tests. Check that a focused, edited value is saved when Create/Save is tapped.
- **F67:** Only unprofiled exercises keep their slots. All existing ordering tests stay pinned.

Verify in `/preview` and on a device: create template and custom programs while one already exists, then edit, set active, delete and cancel.

**B‑5. Faster queries everywhere** (new `getSessionUserId()` in `supabase.ts`, then about 50 call sites)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F1 | Removes the extra trip to the sign-in server before nearly every query, so each screen and save is about 0.1–0.4 s faster and flaky-signal saves are more reliable | Med | M |

Guard:
- Use `getSession()` only. **Never** use the auth store's user id: an expired session would then return empty results and could clear an active workout.
- Swap only calls that use nothing but `user.id`.
- Keep `getUser()` in `saveNutritionEntry`, `saveMealComposition` and for metadata reads.
- Make two commits: `appStore` first, then pages.
- Add a test that `fetchCurrentWorkout` keeps the workout when `getSession` returns null.
- Test on iOS (Keychain) and on the web. Include an account switch.

**B‑6. History editing** (`History.tsx`, `appStore` history actions)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F26 | Editing a finished workout never marks it unfinished again (do first) | Low–Med | S |
| F25 | Failed edits say "Could not save" and keep your typed values; no more false "Saved" | Med | M |
| F34 | Fast month switching always shows the header's month; a note typed just before switching is saved | Low–Med | S |
| F15 | History month loads about 0.2–0.6 s faster (drops the redundant sign-in check and runs lookups in parallel) | Low | S |
| F80 | A failed split/lap load retries when you return to the day | Low | S |

Guards:

- **F26:** Read `completed`/`completed_at` fresh in the same query. Move only *toward* complete, and write only on an actual change.
- **F25:** The store throws on error. `runMutation` never rejects and always refreshes. The editor closes only on success. Do **not** skip completion sync for target-set changes.
- **F34:** Latest-request gate, `selectedMonthRef` for the sync and detach refetches, and flush pending notes before a month switch.
- **F15:** Keep all fallbacks. Skip the PostgREST embed.
- **F80:** Return `null` for a failure and `[]` for truly empty. Replace entries rather than append.

**B‑7. Movement notes** (`Workout.tsx` notes code, `History.tsx` notes; do together)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F21 | Flexible-workout notes save once, not on every keystroke; no snapping back or reverted reorders | Med | M |
| F33 | Notes typed just before leaving a page are saved; one shared tested autosaver | Low–Med | M |

Guards:

- **F21:** Decide the plan-note write separately from the workout-notes no-op check. Keep an explicit "cleared" state. "Save as template" uses the on-screen notes. Unmount flushes instead of dropping.
- **F33:** Put a plain `noteAutosave.ts` module under fake-timer tests. Flush with the workout id captured when the save was scheduled. Keep each page's debounce and its `user_id` filter.

**B‑8. Food logging** (`FoodLogger.tsx`, plus `MealLogger.tsx` and `Nutrition.tsx` for G10)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F14 | A retry after a lost response never logs the food twice | Med | S |
| F13 | Failed logs say so and keep your entry | Low | S |
| G9 | An old barcode lookup can't replace the product you're reviewing or bind to the wrong barcode | Low | S |
| F39 | Barcode providers are queried in parallel with the same priority (worst case about 15 s down to about 5 s) | Low | S |
| F43 | USDA search shows "no matches" or "failed + Retry", and never stale results | Low | S |
| G11 | Late photo/describe results don't overwrite what you did meanwhile | Low–Med | S |
| G10 | The AI tab keeps its work across tab switches; closing mid-analysis asks first | Med | S |
| F78 | The saved-food list stops blanking on tab switches and meal-builder adds | Low | S |

Guards:

- **F14:** Pending id only when `!initialEntry`, cleared after *every* success (the photo loop), and an explicit `retryEntryId` always wins.
- **F13:** Don't touch `upsertFoodIfNeeded`. Messages reuse the existing `saveError` row.
- **G9:** Lookup counter plus bump on mode change. No scanner prop.
- **F39:** Attach `.catch` when each leg starts. Resolve in fixed priority, never `race`.
- **F43:** An opt-in `rethrow` flag, so the photo grounding path is unchanged.
- **G11:** Photo review only on the Photo tab. For describe, snapshot the fields and offer "Fill fields" if you edited them.
- **G10:** Busy flags reset on unmount and on a confirmed close. `trialKey` keeps the Describe→AI hint working. `loggerBusy` stays a hard block.
- **F78:** Always refetch in the background; user-keyed cache.

Verify with airplane-mode save and retry giving exactly one row, for each of search, barcode, manual and photo.

**B‑9. Request time limits** (`supabase.ts`). Only after F3 and F14 have landed.

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F7 | A stalled connection gives up after about 30 s and shows the normal error, instead of spinning for minutes | Med | S |

Guard:
- Manual `AbortController`; no `AbortSignal.any` or `timeout`, because the app supports iOS 15.
- The caller's signal wins, so the 8 s set-save abort still fires first.
- Edge functions and `save_split_snapshot` are exempt or get 120 s.
- Real client only.
- Test with Network Link Conditioner "100% loss": Train, Start and food Save must recover, and a refresh after a timeout must keep you signed in.

**B‑10. Nutrition page** (`Nutrition.tsx`, `nutritionGroups.ts`, new `nutritionLogQueries.ts`)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F12 | Stops a hidden retry loop when browsing months in "Jump to date"; no skeleton flash after logging; never stuck offline | Med | S |
| F40 | The first view of a day sends 2 requests, not 5; reorders send only the rows that changed | Low | S |
| F42 | One shared log+food query, one trip instead of two, shared `sumMacros`; fixes 0-kcal entries for large imports | Med | M |

Guards:

- **F12:** `loadedMonthKey` gating, one failed-date set, and a request token with `finally`. Reset `selectedMonth` on sheet close.
- **F40:** A pure `changedGroupOrders` helper; the local state still uses the full list.
- **F42:**
  - First run the read-only check that PostgREST sees the `food_id → foods` relationship. If it doesn't, keep two queries and chunk them at 200.
  - Keep each screen's error behavior and the `description` column.
  - Before/after totals must match exactly on Today, Fuel, Progress and the adaptive target.

**B‑11. Rest timer and lock screen** (`RestTimerPill.tsx`, `restTimer.ts`, `liveActivity.ts`, `nativeGlassSurfaces`, `useAppViewport`)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F29 | Leaving Train during rest no longer cancels the "Rest over" alert and countdown | Med | M |
| F100 | Lock-screen updates are sent in order, so no stale set line and no leftover card after finishing | Low–Med | M |
| F31 | Stops repeated native glass syncs (every second during rest, and on keyboard moves) | Low | S |

Guards:

- **F29:**
  - The unmount cleanup also cancels when `currentWorkout?.id !== workoutId`. Without this, finishing a workout would leave a "Rest over" alert armed.
  - Skip/Continue cancel immediately.
  - New stored fields are optional.
  - No late chime.
- **F100:** One JS promise chain with latest-state coalescing, and a skip once the session has ended. Swift is unchanged.
- **F31:** Only write `data-keyboard-open` when it changes. Shallow dedupe that forgets the last value when a send isn't applied. `remainingMs: 0` while running. **Known change:** a toast dismissed by Control Center stays dismissed.

Device check, all seven rest-timer scenarios:
- (a) log a set, go to Nutrition, lock the phone: countdown runs and "Rest over" names the next set;
- (b) come back to Train before the end: no duplicate alert, "Next · …" still shows;
- (c) stay away past the end: Rest complete, no late chime;
- (d) skip, then lock: no alert;
- (e) finish during rest, then lock: no alert and no card;
- (f) two sets back to back: only the second alert fires;
- (g) change the preset after returning: it saves for that exercise.

**B‑12. Adaptive targets** (`appStore.refreshAdaptiveTargets`, `fetchMacroTarget`, `adaptiveExpenditure.ts`)

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F76 (part A) | `fetchMacroTarget` clears a missing target, so the previous account's target doesn't linger | Low | S |
| G2 | The database refuses to overwrite a hand-typed target with an adaptive one | Low–Med | S |
| G5 | Today's half-logged food no longer counts as a full day (the target is currently biased about 60–70 kcal low) | Low | S |
| G6 | A failed target write retries on the next Today visit; Settings says so honestly | Low | S |
| G3 | The background refresh only writes its own expenditure columns and stops if you edited meanwhile | Med | M |

Guards:

- **F76 (A):** Clear only on success with no row; never clear on an error.
- **G2:**
  - Conditional `update … neq('source','manual')`, then insert-if-absent.
  - Do **not** make `fetchMacroTarget` throw, or the Dashboard would get stuck loading.
  - Leave `updateMacroTarget` unchanged.
- **G5:** Shift the intake window back one day. Don't just drop today.
- **G6:** Write the target before the profile stamp. Never reject.
- **G3:** A column-scoped update, a stale-snapshot bail-out, single-flight, and a forced run that still computes fresh.

**B‑13. Sign-in and account switching** (`authStore.ts`, `photoAnalysis.ts`, `App.tsx`). Session restore is protected, so be careful here.

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F93 + G20 | **Do together.** Both change `hydratePhotoWorkerSettings` to take the user id. No duplicate profile/`getUser` fetch on every resume. A different account doesn't inherit the previous worker URL or goal text | Med | S + S |
| F76 (part B, optional) | Resets in-memory app data on a real account change | Med | S |
| F53 | An offline cold start with an expired token shows "Offline, waiting for a connection" instead of a fake sign-in screen. **This is an auth-flow change and needs your OK** | Higher | S |

Guards:

- **F93:** Dedupe keyed on the profile already in the store, plus an in-flight id cleared in `finally`. Keep every `set({ session, user })`.
- **G20:** An owner-key check, synchronous and before any await. Do not clear on sign-out.
- **F76 (B):** Compare user ids, never event names. `TOKEN_REFRESHED` and focus-`SIGNED_IN` must not wipe an active workout.
- **F53:**
  - Only a retryable error sets `reconnecting`.
  - Ignore a null `INITIAL_SESSION` while reconnecting.
  - "Sign in instead" never calls `signOut`.

**B‑14. Today refreshes when you come back**

| ID | What it does | Risk | Effort |
|---|---|---|---|
| F48 | Reopening in the morning shows today's totals, date, plan and timer without leaving Today | Low–Med | S |

Guard: reuse the same `load()` without a loading flash, one refresh at a time, a 5-minute throttle or a day change, and call `retrySchedule()` on a new day.

---

### Batch C: larger projects (worth it, but bigger)

| Pkg | ID | What it does | Risk | Effort |
|---|---|---|---|---|
| C‑1 | F22 | Today and Train show your program, live workout and today's totals instantly on tab switch; fixes the "set looks unlogged" and "finished workout comes back" race. Do after F1 and F6 | Med | M |
| C‑2 | F44 + F99 | Loads Settings, History, Analysis, Program and Run on demand (about 20% less code at launch). PWA updates re-download about 123 KB instead of about 400 KB. **Do together** | Med | M + S |
| C‑3 | F28 | One tested `planSetCountChange` rule and fewer plan round trips; fixes duplicate "Set 1" rows. After F73 and F3 | Med | L |
| C‑4 | F41 | Shared, tested food and saved-meal persistence for FoodLogger and Settings. After F13 and F14 | Med | M |
| C‑5 | F50 (step 2) | The tilt light (motion sensor, bridge events, per-frame loop) only runs while something lit is on screen | Med | M |
| C‑6 | F65 | USDA foods are cached per account, so no one else's bad row can change your macros. **Needs a migration you approve** | Higher | S |

Guards:

- **C‑1 (F22):** Three commits, in this order:
  1. a mutation-sequence race guard in `fetchCurrentWorkout`;
  2. in-flight de-duplication (errors are never cached, and mutations bypass it);
  3. a display that shows cached data while refreshing, keyed to `hydratedForUserId`.

  The user-id check is mandatory: sign-out doesn't reset the store, so without it the next account would briefly see the previous user's data. No 30 s TTL.
- **C‑2 (F44 + F99):**
  - Use React Router's per-route `lazy`, not Suspense. Keep Dashboard, Workout and Nutrition eager.
  - Add a one-shot `vite:preloadError` reload guard.
  - `manualChunks` uses an **allow-list**, so three.js, zxing and plugin fallbacks stay lazy.
  - Check cold deep links, the unsaved-changes blocker in Settings, recovering a run on `/train/run`, and an offline PWA reload.
- **C‑3 (F28):**
  - Remove the dead `reorderFlexibleExercises`.
  - Keep the `select` string byte-identical.
  - Pass a preloaded plan to skip an extra read.
  - Keep the 3-sets-live and 1-set-History defaults.
  - Never normalize live plan items.
- **C‑4 (F41):** Pure extraction with tests first. Changes that alter behavior (one shared limit of 150, the retire-error message) go in a separate commit. Keep the `serving_size` retry.
- **C‑5 (F50):** A `useLitSurface()` callback ref on the nine lit elements. Merge refs in `RestTimerPill` without changing its behavior. Add a 1.5–2 s linger before stopping the sensors. Don't change the easing or the 15 Hz rate.
- **C‑6 (F65):**
  - A client filter plus `user_id` on insert.
  - The migration adds a `BEFORE INSERT` trigger that fills in `user_id`, so older app builds keep working, before tightening `WITH CHECK`.
  - The `SELECT` policy stays, so past logs are unchanged.
  - Deploy through the supabase-deploy skill.

**Production steps that need your explicit approval (none happen without it):**

- **F66 step B:** delete the deployed `process-food-photo` function and its Vertex/GCP secrets, and revoke the key. First confirm no TestFlight build from before 2026‑07‑16 is still in use; those expire by about mid-October 2026.
- **F64 tier 2:** commit a baseline migration **together with** `supabase migration repair` on production.
- **F55 step 2:** adopt generated database types on its own branch.
- **F103:** deploy `analyze-food-trial` when you next want an edge deploy.

---

## 3. Deliberately not recommended

| ID | Why not |
|---|---|
| F35 | History redraws on each keystroke, but the work is tiny. Memoizing the protected edit cards risks losing edits through stale closures |
| F38 | Trimming the USDA payload saves milliseconds but needs a production edge deploy on a protected flow. Only do it bundled with other food-lookup work |
| F59 | Merging duplicate Live Activity types across targets is hygiene only and risky on device. Do it with the next Live Activity edit |
| F61 | Faster quota-slot probing saves 0.3–1.5 s only on your 10th–24th paid analysis of a day. Not worth a deploy |
| F69 | Removing the research text saves about 6 KB gzipped; do it at the next evidence re-import |
| F74 | Consolidating test mocks would weaken the exact-call checks that protect workouts |
| F84 | Lazy-loading SplitBuilder saves about 30 KB. Only do it bundled with C‑2 |
| F91 | Reusing the Today figurine's WebGL context brings context-limit and loss risks for an unmeasured gain. Revisit only if a device shows a hitch |
| F95 | Caching the Keychain session in memory gains milliseconds but risks sign-out or refresh-token bugs |
| F96 | A PWA update that reloads mid-workout is real, but no PWA hosting was found and the fix needs new UI |

**Parts cut from recommended items on purpose:**

- F7: no promise-level `withTimeout`.
- F10: I/O stays on the main thread, no Live Activity throttle.
- F22: no 30 s cache window.
- F25: completion sync is not skipped for target-set changes.
- F28: live and History defaults are not unified.
- F32: no full component split.
- F36: no separate count query.
- F41: the `serving_size` retry is kept.
- F43: Enter is not blocked while searching.
- F50: easing and 15 Hz rate unchanged.
- F72: no live-event buffering.
- F4: the old program is never deactivated before the new create succeeds.

**Intended visible changes to know about:**

- F4: deleting the active program leaves none active.
- F24: Sunday now counts toward the Monday–Sunday week.
- F31: a toast dismissed by Control Center stays dismissed.
- F45: Enter no longer drops focus in the editor.
- F67: new template programs get a different default exercise order.
- F81: the lb/wk figure uses a 21-day window.

---

## 4. Verification checklist

**After every commit:**
- `npm run test`, `npm run lint`, `npm run build`, all green.
- Add `npm run check:instructions` when docs or skill files change (F66, F97).
- Fix anything the change broke, and re-run only the affected checks.

**When Swift, native run tracking, the rest timer, Live Activity or the barcode scanner change:**
- A native build per the ship-ios skill, then a device run. A web build does not validate native behavior.

**When a change touches any save path:**
- An offline test with airplane mode, or Network Link Conditioner "100% loss", as described in each item.

**Protected-flow click-through** (the flows to run for each package are listed after this):

1. **Food logging with time.** Log via search, barcode, manual and photo (per-item and combined), each at a chosen time and group. Log a saved meal. Retry after going offline mid-save and confirm exactly one row.
2. **Workout start, log, complete, and set persistence.** Start a split day (order and set counts match the plan) and a flexible workout from a template. Log sets. Kill and reopen the app: it resumes with the logged sets. Add an exercise and a superset, and change target sets up and down (finished sets are never removed). Finish, both normally and offline.
3. **Editing past workouts and nutrition.** In History, edit, add and remove sets, reorder, change target sets, edit notes and delete a workout (online and offline). In Fuel, edit a past entry and use move-to-previous-day.
4. **Volume recommendations and status.** Today's insight appears on first open. Analysis statuses and captions are correct. Completing a workout updates them.
5. **Active program.** Create (template and custom) while one exists, view, edit (keyboard stays up), set active, delete. Train and Today reflect each change.
6. **Session restore and sign-in.** Cold start with a saved session (iOS Keychain and web). Background and resume. Sign out, then sign in to a second account: no data from the first shows or saves.
7. **Rest timer.** Start, skip and complete; "Rest over" while on another tab; lock-screen countdown; finish during rest leaves no alert or card.
8. **Native run tracking.** 20+ minute run with several lock/unlocks, a tab switch and resume, a force-quit and resume, Live Activity Split/Rest/Finish, and intervals mode with no lap-beep burst.

**Which flows each package must re-check:**

| Package | Flows (numbers above) | Native build and device? |
|---|---|---|
| A1 | none (tests only). Also prove F19 in a worktree with no `.env`, and dry-run F18 with fastlane stubbed | No |
| A2 | Quick visual pass on all tabs, light and dark (F52/F88). 6 after F98. PWA install check for F97 | F98 yes |
| A3 | 2 and 5 (F5, F6, F30, F32); 4 (F23, F24, F68); 1 (F82 and exercise picker); 3 (F27, F75); 6 and a cold launch at 100% loss (F17); G7 with flow 7 and G17 with a barcode scan | G7 and G17 yes; F17 in the simulator |
| B‑1 | WHOOP sync from History and Settings in `/preview`; History activities intact | No |
| B‑2 | 8 | **Yes** |
| B‑3 | 2 and 7 (finish during rest), offline Start and Finish | One iOS run |
| B‑4 | 5, then 2 (start from the new program) | Keyboard check in the simulator |
| B‑5 | 1, 2, 3 and 6 on web **and** iOS, plus airplane-mode start and logging | Yes (Keychain path) |
| B‑6 | 3, with fast month taps and WHOOP attach/detach | iOS for blur behavior |
| B‑7 | 2 (flexible notes, reorder, save as template) and 3 (History notes) | No |
| B‑8 | 1 in full, plus edit a past entry; saved meals in Settings | Photo flow on device if possible |
| B‑9 | 1, 2 and 6 under "100% loss"; WHOOP, food lookup and program save on a normal connection | Yes |
| B‑10 | 1 and 3 (Fuel), month browsing in "Jump to date", offline Fuel; totals match before and after on Today, Fuel, Progress | No |
| B‑11 | 7 in full (scenarios a–g), plus 2 | **Yes** |
| B‑12 | Adaptive: hand-typed target survives; Resume adaptive still works; 4 | No |
| B‑13 | 6 in full, plus an offline cold start with an expired token (F53) | **Yes** |
| B‑14 | Today after a day change or 6+ minutes backgrounded; resume card count; 1 and 2 | Yes |
| C‑1 | 2, 6 (account switch), 7; quick tab switches mid-workout; past midnight | Yes |
| C‑2 | Cold deep links to every lazy route, 6, 8 (run recovery on `/train/run`), offline PWA reload | Yes |
| C‑3 | 2 and 3 (target sets, supersets, add/remove) | No |
| C‑4 | 1 and 3, saved meals in both screens | Photo on device if possible |
| C‑5 | 7, set logging, the sheen on every lit surface, energy gauge idle on native | **Yes** |
| C‑6 | 1 (USDA search and logging), past days' totals unchanged, after the approved migration | No |

**Limitations to note in each change:**
- DST behavior (F75) and time-zone behavior (F71) are only exercised by unit tests.
- The disk-full trigger (F57) won't be reproduced on a device.
- Production-only behavior is not exercised until you approve those steps: the database cascade (F27), the foreign-key embed (F42), and the edge and RLS changes (F65, F66, F103).
---

## Appendix A: confirmed findings

Each finding below survived an adversarial reality check and a separate feature-safety check. Line numbers are as of `e35b635`. The full per-finding evidence and safety guards are kept with the review run for implementation.

| ID | Severity | Finding | Where | In plain English |
|---|---|---|---|---|
| F4 | high | Program creation takes 1+days+exercises serial unchecked requests, is non-atomic, and leaves the old program active; activation and delete… | `src/stores/appStore.ts:315-365`, `src/stores/appStore.ts:367-388` | Creating a program becomes one quick save instead of dozens of back-to-back requests, so "Creating program…" takes about a second rather than several. A bad connection can no longer leave a half-built program behind while the app says it worked. Creating a… |
| F8 | high | Resuming an interrupted native run double-counts distance and re-fires auto-laps and cues | `src/lib/nativeRunSource.ts:30`, `src/lib/nativeRunSource.ts:45-62` | Right now, if you leave the run screen during a run (even just switching to another tab) or iOS closes the app, then come back and tap Resume, the app counts part of your route a second time. The saved distance and pace come out wrong, usually by about the… |
| G1 | high | WHOOP sync treats a failed read as 'no data', then deletes, duplicates or un-dismisses activities (sometimes permanently) while reporting… | `src/stores/appStore.ts:1797-1805`, `src/stores/appStore.ts:1812-1856` | Today, if one of several background requests hiccups during a WHOOP sync (for example when the phone backgrounds the app mid-sync), the app can wrongly conclude that your activities are gone. It then deletes imported WHOOP activities, creates duplicate runs… |
| F1 | medium | About 59 supabase.auth.getUser() calls add a network round trip to Supabase Auth before nearly every query | `src/stores/appStore.ts:278`, `src/stores/appStore.ts:393` | Nearly every screen load and most saves currently make an extra trip to the sign-in server before fetching or saving the actual data. That trip costs roughly 0.1–0.4 s on mobile data, and 2–3 trips in a row on History and when logging a saved meal. On a weak… |
| F2 | medium | Finishing a workout ignores save errors: the app shows the completion summary while the workout stays unfinished on the server | `src/stores/appStore.ts:1441-1454`, `src/pages/Workout.tsx:994-1063` | Today, if the connection drops or the login has quietly expired when you tap Finish, the app still celebrates and closes the session, but the server never records the workout as finished. The workout can then come back as "in progress" or drop out of your… |
| F3 | medium | Starting a workout and other plan edits insert set rows one request at a time and ignore insert errors | `src/stores/appStore.ts:643-654`, `src/stores/appStore.ts:747-760` | Starting a planned workout on mobile data would go from a spinner of several seconds (about 20-25 back-and-forth requests) to roughly 5 requests, so the session appears noticeably faster. If the connection drops while starting, you get a clear "couldn't… |
| F5 | medium | Every logged set re-runs two unrelated Train-page fetch effects (about 4 extra Supabase queries per set) | `src/pages/Workout.tsx:365-404`, `src/pages/Workout.tsx:426-530` | Right now, every time you log or edit a set mid-workout, the app quietly re-downloads your last month of workouts twice: once for the "beat last time" numbers and once for the weekly calendar, which isn't even on screen during a workout. That adds up to about… |
| F6 | medium | fetchSplits always replaces activeSplit, so schedule, plan and calendar effects keyed on object identity re-run their queries on every… | `src/stores/appStore.ts:277-312`, `src/hooks/useScheduleWorkouts.ts:9-24` | Coming back to Today or Train currently makes the app fetch your workout history, and on Train your plan schedule and this week's calendar too, twice in a row, and the first result is thrown away. With the fix, each visit loads them once. On a slow or mobile… |
| F7 | medium | No Supabase request has a time limit, so a stalled connection leaves spinners and disabled buttons stuck | `src/lib/supabase.ts:19`, `src/pages/Workout.tsx:283` | If the phone's connection quietly dies (a tunnel, hotel Wi-Fi, switching between cell and Wi-Fi), the app gives up after about 30 seconds and shows its normal "try again" message with your input kept. Today the native app can take about a minute per request,… |
| F9 | medium | Live Activity run controls (Rest/Split/Finish) are handled off the main thread, touching UIKit and CoreLocation and racing the location… | `ios/App/App/RunLiveActivity.swift:46-89`, `ios/App/App/HyperRunPlugin.swift:106-111` | Lock-screen run buttons (Split, Rest, Finish) currently run their work on a background thread. Apple requires that work to happen on the main thread. Most of the time it works, but it can occasionally lose a button press, record a split with a duplicate… |
| F10 | medium | Native sample drain re-sends and re-decodes the whole run on every screen unlock, on the main thread | `ios/App/App/HyperRunPlugin.swift:216-255`, `src/lib/nativeRunSource.ts:45-62` | During a long outdoor run, the app currently re-reads and re-processes the entire run recording each time you unlock your phone to check your pace. The cost grows the longer you run: at one to two hours it can add a noticeable hitch right when you glance at… |
| F11 | medium | Dumbbell-only guided programs silently drop the overhead press on save ('Dumbbell Shoulder Press' is not in the exercise library) | `scripts/import-evidence.mjs:393`, `scripts/import-evidence.mjs:403` | People who choose "dumbbell only" in the guided program builder currently see a shoulder press on the review screen, but the saved program leaves it out without saying so. It is the only overhead pressing movement on those days. With the fix they get the… |
| F12 | medium | Nutrition page shows a full skeleton on every refresh, applies late responses from other months, and stays stuck on the skeleton offline | `src/pages/Nutrition.tsx:98-181`, `src/pages/Nutrition.tsx:242-263` | After you log or edit a food, the Fuel page would stop blanking to grey placeholders for about three server round trips. The calorie number would roll from the old total to the new one instead of replaying from zero. More importantly, browsing another month… |
| F13 | medium | FoodLogger save paths fail silently: the spinner stops and nothing is logged, with no message | `src/components/nutrition/FoodLogger.tsx:1139-1161`, `src/components/nutrition/FoodLogger.tsx:1359-1471` | When logging a food fails, for example with no signal or when the sign-in has expired, the sheet will now say so and keep your entry on screen so you can try again. Today the button just stops spinning and nothing happens. It looks broken, and it is easy to… |
| F14 | medium | Retrying a new food entry after a lost response can log the food twice and orphan food rows | `src/lib/saveNutritionEntry.ts:26-35`, `src/components/nutrition/FoodLogger.tsx:1129` | If the phone loses connection just as a food is saved, the app can say "Could not save, try again" even though the save actually went through. Tapping retry then logs the food a second time, and that day's calories and protein are double-counted, which also… |
| F15 | medium | History month load is a 4-6 hop sequential network chain with redundant auth round trips | `src/pages/History.tsx:728-794`, `src/pages/History.tsx:731` | History opens, and each month change finishes loading, about one to two network waits sooner (roughly 0.2-0.6 s on cellular) before the day panel stops shimmering. What appears on screen stays exactly the same. The optional guard also fixes a rare glitch… |
| F16 | medium | Photo worker runs the same analysis twice when a retry arrives while the original is still queued or uploading | `scripts/photo-food-worker.mjs:546-553`, `scripts/photo-food-worker.mjs:563-571` | When the Mac worker is already busy with one long AI job and you send a food photo (or description, or coach request), the app automatically retries every 2 minutes while it waits. Today each of those retries can start a second, complete copy of the same… |
| F17 | medium | Fonts load from a render-blocking Google Fonts stylesheet, delaying all app JavaScript at launch and failing offline | `index.html:33-35`, `src/index.css:56-58` | The app's fonts would ship inside the app instead of coming from Google each time it opens. On bad gym Wi-Fi, or a network that says it's connected but has no internet, the app would no longer sit on a blank screen waiting for Google. It would open straight… |
| F18 | medium | Nothing runs the test suite before shipping: no CI, and ship.sh uploads to TestFlight untested | `scripts/ship.sh:32-39`, `package.json:15` | Right now, typing /ship in Discord builds whatever is on main and sends it to TestFlight without running the app's 1,080 automated checks. Those checks cover saving workout sets, food-log day boundaries, schedule restore and more. With this change, the ship… |
| F19 | medium | Seven test files load the developer's private .env and a real production Supabase client; four fail without it | `vitest.config.ts:4-9`, `src/lib/supabase.ts:7-28` | Right now five of the app's automated test files only pass on the one machine that has your private settings file (.env). In a fresh copy of the project those checks fail even though nothing is broken. A fresh copy includes the separate working copies… |
| F20 | medium | The iOS Keychain session storage adapter (sign-in persistence) has no tests | `src/lib/nativeSecureStorage.ts:14-62`, `src/lib/supabase.ts:26` | The iOS app keeps you signed in by storing your login in the iPhone's secure Keychain, and it quietly moves logins saved by older app versions into it. Today nothing checks that this still works except trying it on a phone. The new test catches, in seconds,… |
| F21 | medium | Flexible-session movement notes write the whole plan on every keystroke; concurrent plan writes can overwrite each other, revert reorders… | `src/pages/Workout.tsx:1574`, `src/pages/Workout.tsx:1700-1706` | During a flexible (custom) workout, typing a note on an exercise currently sends a full "save the whole workout plan" request for every letter you type, and redraws the whole workout screen each time. With the fix, one note sends a single save when you pause… |
| F22 | medium | Today and Train re-download everything and block on a full spinner or shimmer on every visit, and slow responses can overwrite newer local… | `src/pages/Dashboard.tsx:46-64`, `src/pages/Dashboard.tsx:150-173` | Switching between Today and Train would show your program, your live workout and today's food totals straight away, with no spinner or grey placeholder each time. The data still refreshes quietly in the background. The app would also make fewer duplicate… |
| F24 | medium | Weekly volume uses a Sunday week while Coaching labels, training hours and the Train calendar use Monday | `src/stores/appStore.ts:2866-2867`, `src/pages/Analysis.tsx:60` | Every Sunday, the Home and Coaching screens currently treat the week as starting over. Every muscle shows as under-trained and the advice flips, while the header still says 'Week of' the previous Monday and the training-hours chart counts the full week. After… |
| F25 | medium | History edit actions swallow errors, so the UI shows 'Saved' when nothing was saved, and each edit pays for a full re-sync | `src/stores/appStore.ts:1423-1439`, `src/stores/appStore.ts:2060-2160` | When you edit a past workout in History and the save fails (bad signal, server hiccup), the app currently shows 'Saved' and closes the editor. Then your change quietly disappears. After the fix it says 'Could not save', keeps what you typed so you can retry,… |
| F26 | medium | Editing a past workout can mark a finished session incomplete and bring it back as 'in progress' | `src/stores/appStore.ts:2243-2276`, `src/pages/History.tsx:948-978` | Right now, if you finish a workout with a set skipped and later fix anything in History (a weight, adding a set, reordering), the app quietly marks the workout unfinished. It can then come back as "Session in progress" on the Dashboard, block switching… |
| F28 | medium | The same plan edits are implemented twice (live flexible vs past/split workouts), with defaults and guards that have drifted apart | `src/stores/appStore.ts:588-595`, `src/stores/appStore.ts:950-1333` | Changing an exercise's set count, adding a superset or adding an exercise mid-workout makes fewer trips to the server, so those taps settle faster. On a phone that means one request instead of three or more when adding sets, and one fewer request for every… |
| F29 | medium | Leaving the Train tab during rest cancels the rest-over notification and Dynamic Island countdown while the timer keeps running | `src/components/workout/RestTimerPill.tsx:45-56`, `src/components/workout/RestTimerPill.tsx:127-134` | Today, if you log a set and switch to Nutrition or your Program while resting, the phone stops the "Rest over" alert and the lock-screen countdown, even though the timer keeps running and reappears when you go back to Train. After the fix, the alert and… |
| F30 | medium | A 1-second session clock re-renders the entire live Workout page to update a label that changes once a minute | `src/pages/Workout.tsx:121-146`, `src/pages/Workout.tsx:167` | While a workout is open, the phone stops rebuilding the whole workout screen every second just to refresh a "23m" label that only changes once a minute. The screen is kept awake through long gym sessions, so this saves steady battery and CPU and removes a… |
| F32 | medium | Workout.tsx combines pre-session, flexible and split sessions in one 2,258-line component, with duplicated movement-card code | `src/pages/Workout.tsx:66-92`, `src/pages/Workout.tsx:120-1063` | During a workout, the app currently goes back to the server twice after every set you log to re-download your "last time" numbers, even though they cannot have changed. With the fix it fetches them once per workout, and again only when you add or swap an… |
| F34 | medium | Fast month switching in History can show the wrong month's data (no stale-response guard) | `src/pages/History.tsx:728-802`, `src/pages/History.tsx:861` | If you tap between months quickly, History always shows the month named in the header, instead of sometimes showing "No sessions recorded" for a month that has workouts until you leave and come back. A WHOOP sync or "remove stats" that finishes after you… |
| F39 | medium | Barcode lookup queries saved foods, FatSecret, USDA and Open Food Facts one after another | `src/components/nutrition/FoodLogger.tsx:275-332`, `src/lib/savedBarcodeFoods.ts:19-44` | When you scan a barcode the app hasn't seen before, it currently asks three food databases one after another and waits for each to answer before trying the next. Asking all three at once and still preferring the best source cuts the wait for a missed or… |
| F43 | medium | USDA text search can show results from an older query, and a failed search looks the same as no results | `src/components/nutrition/FoodLogger.tsx:266-273`, `src/components/nutrition/FoodLogger.tsx:2008-2025` | When food search fails because you are offline or the server has a problem, the app will say so and offer a Retry button. Right now it shows a blank area, or makes earlier results disappear, as if the food does not exist. Searching again quickly will always… |
| F44 | medium | No route-level code splitting: Settings, History, Analysis, Program and RunTracker load eagerly in one 1.37 MB entry chunk | `src/App.tsx:16-23`, `src/App.tsx:76-97` | The app loads about a fifth less code at launch. Settings, History, Analysis, Program and the run tracker are loaded the first time you open them instead of every time the app starts. On the iPhone app this means a slightly quicker cold start, probably 10-30… |
| F45 | medium | Program editor rows remount on every committed value, losing focus and replaying animations; no-op blurs mark the draft dirty | `src/components/split/SplitEditor.tsx:78-134`, `src/components/split/SplitEditor.tsx:440-449` | When you edit a program on your phone and move from one number box to the next in the same exercise, the keyboard no longer closes and the row no longer flickers or slides. Superset partner rows stop flashing too. Tapping into a box and out again without… |
| F47 | medium | Builder set and rep cells cannot be cleared and retyped; set-range editing is implemented twice with different rules | `src/components/split/SplitBuilder.tsx:117-120`, `src/components/split/SplitBuilder.tsx:1171-1293` | When you build a custom program today, you can't fix a set count the normal way. Delete the "3" and it jumps to "1". Type "4" and you get "14", which is capped to 10. Changing Max can silently rewrite Min and Sets too. After this change the builder's number… |
| F48 | medium | Today never refreshes when the app returns to the foreground or the day changes | `src/pages/Dashboard.tsx:72`, `src/pages/Dashboard.tsx:80-170` | When you reopen the app in the morning and iOS has kept it in memory, Today can still show yesterday: yesterday's calories and protein ('kcal left' is wrong), a 'trained today' from yesterday, yesterday's planned day, and a frozen workout timer. The only fix… |
| F50 | medium | App-wide motion light keeps CoreMotion (15 Hz), bridge events and a near-continuous per-frame DOM query and repaint loop running all… | `src/App.tsx:103`, `src/hooks/useAmbientLight.ts:11-20` | On the iPhone app, the tilt light currently keeps the motion sensor, about 15 messages a second between the native side and the web view, and a per-frame loop running whenever the app is open and the phone is in your hand. Most of the time nothing on screen… |
| F53 | medium | authStore.initialize ignores getSession errors: an offline cold start with an expired access token shows about 25 s of splash, then the… | `src/stores/authStore.ts:54-76`, `src/App.tsx:100-111` | If someone opens the app with no signal (a gym basement, say) more than an hour after last using it, the app currently waits about 25 seconds and then shows the sign-in screen. That looks like being logged out, even though the login is still saved and the app… |
| F54 | medium | patientPost retries an unreachable photo worker for 15 minutes with no way to cancel | `src/lib/patientFetch.ts:19-23`, `src/lib/patientFetch.ts:36-60` | If your Mac worker is off, asleep or off Tailscale, which happens routinely, Describe, Photo and Goals Coach currently spin for up to 15 minutes, firing a request about every 2 seconds. They then show only "Load failed". After this change you get a clear… |
| F56 | medium | The run Live Activity's two writers overwrite each other: a lock-screen Rest drops elapsed time, and the app's periodic sync clears Finish… | `ios/App/App/RunLiveActivity.swift:72-86`, `ios/App/App/RunLiveActivity.swift:107-127` | When a runner taps Rest or Resume on the lock screen or Dynamic Island, the clock shown there currently snaps back to whatever time the app last reported, often the moment the phone was locked. That can wipe out many minutes until the app is opened again.… |
| F58 | medium | Apple Health weight sync imports only the oldest 500 samples per pass, so first sync leaves 'latest weight' stale | `src/lib/healthWeights.ts:94-119`, `ios/App/App/HyperHealthPlugin.swift:57-72` | When someone turns on Apple Health weight sync, the app currently imports only the oldest 500 weigh-ins. Anyone with a smart scale can see a weight from years ago as their "latest" weight. The macro coach's weight trend also stays empty or out of date until… |
| F67 | medium | Template compiler sinks every unprofiled exercise to the end of the day, putting compounds like Barbell Row and Lunge after isolation work | `src/lib/evidence/compiler.ts:57-72`, `src/lib/evidence/compiler.ts:119-146` | When someone builds a new program from one of the recommended templates, heavy main lifts like Barbell Row, Lunge and Arnold Press will no longer be pushed to the end of the workout after small isolation exercises. Starting with heavy compound lifts is the… |
| G2 | medium | The rule against overwriting a manual macro target checks in-memory state, so a failed or late target fetch lets an adaptive write replace… | `src/stores/appStore.ts:2810-2825`, `src/stores/appStore.ts:2696-2711` | Calorie and macro goals you type yourself can no longer be silently replaced by the app's automatic weekly estimate, even after a patchy network moment or if you save in Settings at the same instant the automatic update runs. Today, once that happens, the… |
| G5 | medium | The expenditure estimator counts today's partly logged intake as a full day, biasing learned expenditure and targets downward | `src/lib/adaptiveExpenditure.ts:129-158`, `src/stores/appStore.ts:2776-2800` | The app learns your daily calorie burn by comparing what you logged with how your weight changed. Right now, when it recalculates in the middle of the day, it counts today's half-finished food log as a full day of eating. That makes it look like you eat a bit… |
| G10 | medium | Closing the Log food sheet or switching tabs mid-analysis silently discards a minutes-long photo, describe or Gemini result | `src/pages/Nutrition.tsx:793-807`, `src/components/nutrition/MealLogger.tsx:110-135` | AI food analysis can take a while. Today, if you tap to another tab in the Log food sheet while the AI (Gemini) estimate is running, or after it finishes, your photos, the estimate and any edits vanish without warning. Reshooting the photo costs another paid… |
| F23 | low | Weekly volume status can be computed before volume landmarks load, dropping the insight and mislabeling every muscle | `src/stores/appStore.ts:2832-2844`, `src/stores/appStore.ts:2862-2934` | Sometimes, the first time the app opens, the Dashboard's volume tip can disappear and every muscle can show 'Under-stimulated / No landmarks set'. That lasts until you leave the screen and come back. This change makes that impossible, because the volume… |
| F27 | low | deleteWorkout deletes sets in a separate request first, so a failed workout delete loses all logged sets | `src/stores/appStore.ts:1501-1512`, `supabase/schema.sql:85` | Deleting a workout becomes all-or-nothing. Today a dropped connection halfway through can wipe a workout's sets but leave an empty workout in History. After the change, either everything goes or nothing does. It also saves a network round trip on every… |
| F31 | low | Native glass surfaces send a bridge sync on every host render (every second for the rest dock), plus up to 3 more per viewport event | `src/hooks/useNativeGlassSurfaces.ts:30-33`, `src/hooks/useNativeGlassSurfaces.ts:81-84` | While a rest timer runs, and whenever the keyboard opens or closes or the app comes back to the foreground, the app keeps telling the native iOS layer to redraw the rest bar, tab bar and toast even though nothing changed. The Nutrition page also does this on… |
| F33 | low | Movement-note autosave is duplicated between History and Workout; pending notes are dropped on unmount, and History writes on every blur… | `src/pages/History.tsx:699-716`, `src/pages/History.tsx:991-1053` | If you type an exercise note and switch tabs within about a second, the note can silently vanish today, both during a live workout and when editing an old one. After the fix, those notes are always saved. The History screen also stops showing 'Saved' when… |
| F36 | low | Settings over-fetches on every visit: 150 saved-meal rows with composition JSON just for a count, fetched twice when opening Saved meals | `src/pages/Settings.tsx:275-301`, `src/pages/Settings.tsx:487-555` | Opening Saved meals from the You tab shows the list instantly instead of flashing a loading shimmer and downloading the same list again. Each visit makes fewer background requests to the server. The Nutrition targets row shows your calories straight away… |
| F40 | low | Just viewing a day writes to the database: 3 default group inserts plus a no-op UPDATE per group | `src/pages/Nutrition.tsx:226-295`, `src/lib/nutritionGroups.ts:71-83` | The first time you open a new day in Nutrition, the Breakfast, Lunch and Dinner rows appear a little faster, because the app skips three pointless save requests. Reordering or adding a meal also sends fewer requests. What you see and how you use the page stay… |
| F41 | low | Food and saved-meal persistence is copied inside FoodLogger and duplicated in Settings, has drifted, and has no tests | `src/components/nutrition/FoodLogger.tsx:460-564`, `src/components/nutrition/FoodLogger.tsx:620-663` | Saving foods and saved meals is currently written out two or three times, in the food logger and in Settings, and the copies have already drifted. The logger can list fewer saved meals than Settings. If an edit only half-succeeds on a bad connection, the… |
| F42 | low | The nutrition logs -> foods -> sum macros join is hand-written four or five times, takes an extra round trip, sends an unchunked .in()… | `src/pages/Nutrition.tsx:98-161`, `src/pages/Nutrition.tsx:297-312` | Today, Fuel, Progress and the automatic calorie-target estimator each wait for two network trips in a row before they can show nutrition numbers. This change makes it one trip each, so those screens load a bit faster, most noticeably on mobile data. It also… |
| F46 | low | Every program-editor keystroke re-renders the Programs page and every row, each forcing a motion layout measurement | `src/pages/Splits.tsx:18-34`, `src/pages/Splits.tsx:61` | When you edit a program and type its name, description or a day name, the app currently redraws the whole Programs page behind the sheet plus every day and every exercise row, on every letter. After this change, only the part you are typing in redraws. On a… |
| F51 | low | Module-level unitSphere keeps every disposed maquette renderer (with its lost WebGL context and canvas) alive | `src/components/three/maquetteScene.ts:65`, `src/components/three/maquetteScene.ts:76` | Every time you open Today or Analysis and the 3D body figure loads, the app currently keeps a small amount of memory from that figure even after you leave. This fix frees it. The phone's graphics memory is already freed today, so the gain is modest: the app… |
| F52 | low | About 6 KB of dead global CSS ships, including an unlayered compatibility layer that silently overrides Tailwind utilities with !important | `src/index.css:178-189`, `src/index.css:191-268` | Nothing in the app will look or behave differently. The styling file stops carrying about 60 lines of leftover rules that nothing uses. Some of those rules quietly override standard styling shortcuts: a future change that writes "thin left border" or "10%… |
| F55 | low | 700-line hand-written Database type is never applied and is out of date | `src/lib/supabase.ts:1`, `src/lib/supabase.ts:19-28` | This removes about 720 lines of outdated "database description" code that the app never uses. The code is misleading: it looks like the app's database queries are type-checked against it when they are not, and it doesn't match the real database any more.… |
| F57 | low | drainSamples can report hasMore forever after a failed write, sending the JS drain loop into an endless main-thread file-read cycle | `ios/App/App/HyperRunPlugin.swift:245-250`, `ios/App/App/HyperRunPlugin.swift:564-595` | If the phone runs out of storage, or a file write fails during a run, the app can currently fall into an endless background loop. It keeps re-reading the whole run file, which drains battery, makes the screen sluggish, and can delay new GPS points while the… |
| F64 | low | schema.sql no longer matches the migrations and there is no baseline migration, so the database cannot be rebuilt | `supabase/schema.sql:1-612`, `supabase/schema.sql:310-329` | The file that is supposed to show the whole database layout at a glance has fallen behind. It is missing about eight newer pieces, such as program preferences, flexible-day plans, rest-timer preferences and the WHOOP workout stats. Updating it means that you,… |
| F65 | low | The shared USDA foods cache accepts rows from any signed-in user, and its lookup has no index | `supabase/schema.sql:329`, `supabase/schema.sql:453-454` | Today, anyone who signs up for their own hyPer account could plant a fake entry for a USDA food, for example "chicken breast" with the wrong calories. Your app would then quietly reuse that entry whenever you log that food, and you would have no way to fix or… |
| F66 | low | The legacy process-food-photo edge function is unused but still deployable and callable by any signed-in user | `supabase/functions/process-food-photo/index.ts:29-31`, `supabase/functions/process-food-photo/index.ts:242` | This removes a leftover photo-analysis service that the app stopped using in July 2026 but that may still be live. If it is live and configured, any stranger who signs up could run AI image analysis billed to your Google Cloud account, with no daily limit and… |
| F68 | low | Volume status thresholds are duplicated, and getVolumeRecommendation lives in splitTemplates.ts, dragging the whole evidence snapshot into… | `src/lib/splitTemplates.ts:1-46`, `src/stores/appStore.ts:2921-2928` | The app decides "below minimum / optimal / near your ceiling / too much" for each muscle in two separate places: one drives the colored status label and the other drives the advice sentence under it on the Analysis screen. They agree today. If someone later… |
| F70 | low | Test files are never type-checked; 34 type errors hide stale fixtures | `tsconfig.app.json:33`, `tests/planSchedule.test.ts:327-329` | Your 94 test files are never checked against the app's real data shapes, so some sample data in them has quietly gone out of date. For example, some tests describe a run with a label the app never uses. This change adds a check that catches that kind of… |
| F71 | low | A time-zone-dependent test fails east of about UTC+5, and no TZ is pinned for date-boundary tests | `tests/workoutSessions.test.ts:118-137`, `vitest.config.ts:4-9` | The automated test suite gives the same pass result wherever it runs, for example if you travel to Asia or Australia, or if a future build machine is set to a different time zone. You won't get a scary false failure about workout hours when nothing in the app… |
| F72 | low | Native run recovery (drain cursors, dedup, ordering) is untested, and out-of-order delivery may be dropped as 'stale' | `src/lib/nativeRunSource.ts:43-135`, `src/lib/runTracker.ts:440` | Run tracking after a lock screen, tab switch or relaunch can only really be checked on the phone today. If a future change broke it, runs could quietly double-count or miss distance, and nothing would catch it. These tests catch that on the computer in… |
| F73 | low | Destructive live and past-workout editing actions in appStore have no tests | `src/stores/appStore.ts:1145-1296`, `src/stores/appStore.ts:1456` | These tests add a safety net for editing a workout's set count and removing an exercise, both in a live workout and when editing past workouts in History. If a later optimization accidentally deletes a set you already finished, or stops a superset partner… |
| F75 | low | Moving a food entry between days shifts logged_at by fixed 24 h blocks and lands on the wrong day across DST; six local-date-key helpers… | `src/lib/entryDay.ts:13`, `src/lib/entryDay.ts:21` | This is a small, rare bug fix. When you move a late-night snack to the previous day, it keeps exactly the time you logged it, even on the weekends the clocks change. Today, on those weekends, the time can shift by an hour, and one case (just after midnight… |
| F76 | low | The app store is never cleared on sign-out, so a second account can see the first account's targets | `src/stores/authStore.ts:66-75`, `src/stores/authStore.ts:191-194` | If you sign out and sign in with a different account on the same phone without the app reloading (email sign-in, or native Apple/Google sign-in), the second account no longer shows the first account's calorie and protein targets. The first account's hand-set… |
| F77 | low | Unused store actions, one of them broken (updateVolumeLandmark upsert lacks onConflict) | `src/stores/appStore.ts:168`, `src/stores/appStore.ts:240` | Removes about 90 lines of code that nothing uses from the app's largest and most-edited file (about 2,900 lines). One of those unused pieces, the landmark update, would silently fail if someone connected it to a screen. After the cleanup, anyone working on… |
| F78 | low | The saved-food list is re-fetched with a blocking spinner on every logger tab switch and every added meal-builder ingredient | `src/components/nutrition/FoodLogger.tsx:654-663`, `src/components/nutrition/FoodLogger.tsx:1929-1934` | Switching between the Saved and Manual tabs in the food logger no longer blanks the saved-food list for a moment. In the meal builder, your saved foods show up straight away after each ingredient you add, with no "Loading saved foods…" spinner every time. The… |
| F80 | low | History marks activity splits as 'requested' before the fetch succeeds, so a failed fetch hides splits for the session | `src/pages/History.tsx:894-916`, `src/stores/appStore.ts:1673-1692` | If the app can't load a run's or WHOOP workout's lap and pace details once (for example, you open History while offline or on a bad connection), you currently lose those details until you leave the History screen or press Sync. With this fix, going back to… |
| F81 | low | The '30-day trend' rate on You is fitted over up to 60 days and differs from the coach and adaptive engine's 21-day rate | `src/pages/Settings.tsx:59`, `src/pages/Settings.tsx:217-222` | The weekly weight-change figure on the You screen would match the rate the nutrition coach and the automatic calorie targets actually use, and its label would say truthfully what period it covers. Today it can show, for example, "-0.40 lb/wk" while the coach… |
| F82 | low | The exercise picker re-downloads the whole exercise library with select('*') every time it opens, including mid-workout | `src/components/split/ExercisePicker.tsx:47-68`, `src/components/split/SplitBuilder.tsx:182-186` | Picking an exercise mid-workout (add, swap or superset) opens instantly after the first time, instead of waiting on a network round trip behind a spinner on weak gym signal. The list keeps working if the connection drops during a session. If loading fails,… |
| F83 | low | Plan schedule cloud save swallows errors and never retries; the 'Set plan start' check ignores the cloud copy | `src/lib/planSchedule.ts:148-168`, `src/lib/planSchedule.ts:184-203` | If you change your training schedule while the connection drops, the change is currently saved only on that phone, and nothing tells you. Your iPad, the web app or a reinstall then shows a different "next workout". With this fix the app quietly re-sends the… |
| F87 | low | 3D scenes keep about 6 MB of PMREM scratch memory, undisposed RoomEnvironment meshes and oversized 1024² coin textures, and rebuild… | `src/components/three/maquetteScene.ts:246-249`, `src/components/three/maquetteScene.ts:320-333` | The 3D body diagram and the "session banked" coin would hold about 6 MB less graphics memory while shown, and up to about 11 MB less if the coin's textures shrink too. Nothing looks different. On an iPhone this lowers the chance of the web view being squeezed… |
| F88 | low | Dead shared components and exports remain in the shared barrel | `src/components/shared/index.ts:3`, `src/components/shared/index.ts:7` | The app works and looks exactly the same afterwards. The shared toolkit gets smaller and more honest: old designs that are no longer used, such as the paper-grain texture, the old macro bar and a floating action bar, disappear. Future changes will then not… |
| F92 | low | FxLayer keeps a full-screen DPR-2 canvas backing store allocated after the first burst | `src/components/fx/FxLayer.tsx:29-35`, `src/components/fx/FxLayer.tsx:70-75` | After the first celebration animation (for example after logging a set), the app currently keeps about 5 MB of memory reserved for an invisible full-screen drawing surface for the rest of the session. The change gives that memory back when each animation ends… |
| F93 | low | Session restore makes duplicate network calls: the profile is fetched twice and getUser() is called on every boot and token refresh | `src/stores/authStore.ts:54-75`, `src/lib/photoAnalysis.ts:73-88` | Every time the app opens or comes back from the background, it quietly re-downloads your profile and re-checks your account with the server, even though nothing has changed. The fix removes those one or two repeat requests, so on slow or mobile connections… |
| F94 | low | DEV-only preview fixtures ship in the production bundle and run at startup | `src/lib/supabase.ts:4-5`, `src/lib/supabase.ts:19-20` | The app your users download stops carrying about 10 KB of fake sample data (the demo user "Sam Rivera" and example workouts and meals) that only exists for your local preview pages, and it stops building that sample data every time the app opens. The gain is… |
| F97 | low | PWA manifest and index.html reference icons that were never committed; dead USDA runtime cache and unused vite.svg are precached | `vite.config.ts:34-78`, `index.html:5-6` | If someone opens hyPer in a web browser or adds it to their home screen from Safari or Chrome, they currently get no proper app icon: a screenshot tile on iPhone, and Chrome refuses to offer "Install". Every page load also triggers failed requests for the… |
| F98 | low | Unused dependencies: recharts (never imported) and @capacitor/browser (still compiled into the iOS app) | `package.json:23-28`, `package.json:40-41` | The app stops shipping an in-app-browser plugin it never uses. Installs and updates skip an unused charting library of about 8 MB, which also contains a Redux stack. There is less third-party code to trust and keep updated. The app's appearance and behavior… |
| F99 | low | Vendor code shares one hash with app code (and a per-build stamp), so every PWA deploy re-downloads about 400 KB gzip | `vite.config.ts:18`, `vite.config.ts:26-80` | People using hyPer as a web/home-screen app would download about a third as much after each app update (roughly 123 KB instead of 400 KB compressed), so updates arrive faster and use less mobile data. The iPhone app is unaffected because its files are bundled… |
| F100 | low | Live Activity updates run as unordered concurrent Tasks, so an older snapshot can land last or a duplicate activity can be requested | `ios/App/App/RestActivityPlugin.swift:63-77`, `ios/App/App/RunLiveActivity.swift:92-148` | Sometimes, after you finish a workout, a leftover workout card can stay on your iPhone lock screen for hours. And right after you log a set, the lock screen can briefly show the previous set's line. This change makes the app send its lock-screen updates one… |
| F103 | low | The food-trial finalizer runs the Tavily product searches one after another | `supabase/functions/analyze-food-trial/model.ts:317-324`, `supabase/functions/analyze-food-trial/tavily.ts:67-74` | When a meal names two packaged or restaurant products, the app looks both up online at the same time instead of one after the other. A typical analysis finishes about a second sooner. In the rare case where the search service is slow, it can save up to 20… |
| F108 | low | photoWorkerBoot test uses a hard-coded port and can falsely pass or fail when runs overlap | `tests/photoWorkerBoot.test.ts:16`, `tests/photoWorkerBoot.test.ts:33-45` | This test is the only automatic guard against a known real incident: the photo-food worker deployed "healthy" but answered every request with an empty body. Right now, if two copies of the test suite run at the same time (you often use parallel worktrees and… |
| F110 | low | The Cronometer CSV importer is orphaned: component, 426-line library and tests are maintained but unreachable | `src/components/nutrition/CronometerImporter.tsx:1-131`, `src/lib/cronometerImport.ts:1-426` | Removes about 650 lines of code and tests for a Cronometer CSV import that nobody can reach in the app. Future changes to meal groups or food logging won't have to keep dead code compiling and its tests passing, so those changes get a little quicker and… |
| F112 | low | No app-level error screen: a render crash on iOS leaves a bare error page with no way to recover | `src/App.tsx:124`, `src/App.tsx:135` | Right now, if any screen hits an unexpected bug, the iPhone app shows a raw technical error page. The app has no address bar or reload button, so the only way out is to force-quit. With this change, a crash shows a calm "something went wrong" screen, the… |
| G3 | low | Adaptive refresh writes back the whole nutrition profile from a stale snapshot with no single-flight guard, reverting goal changes made… | `src/stores/appStore.ts:2767-2808`, `src/lib/nutritionProfile.ts:78-107` | Sometimes, if you open the app and quickly change your goal or pace in the nutrition setup, the background weekly recalculation can quietly undo that change. It can also set a calorie target based on your old goal. The fix makes the background job update only… |
| G4 | low | Foreground auto-sync, Settings 'Sync now' and History 'Sync' can run WHOOP sync concurrently and create duplicate activities | `src/hooks/useWhoopForegroundSync.ts:6`, `src/hooks/useWhoopForegroundSync.ts:14-40` | Tapping Sync while the app is already syncing WHOOP in the background can briefly create duplicate WHOOP activities in History, with doubled strain and calories and inflated 'N new' counts. The duplicates are removed on a later sync, unless you edit or… |
| G6 | low | Adaptive refresh's blanket catch {} hides every failure: stale target after a failed write, full re-runs on every Today visit, and a… | `src/stores/appStore.ts:2801-2830`, `src/pages/Settings.tsx:793-813` | If the internet drops at the wrong moment during the weekly automatic calorie and protein update, the app can currently record the update as done even though your targets never changed, and it won't try again for a week. After this fix it retries on your next… |
| G7 | low | Native rest dock's progress ring animates on every display frame for the entire rest period | `ios/App/App/HyperGlassSurfacesPlugin.swift:94`, `ios/App/App/HyperGlassSurfacesPlugin.swift:115` | During a rest, the native timer dock stops redrawing its small progress ring 60-120 times a second and redraws it about 4 times a second. That saves a little battery and heat over a long workout. The timer, buttons and countdown work exactly as before, and… |
| G9 | low | An older barcode lookup can finish after a newer one, replacing the product under review or binding a personal product to the wrong barcode | `src/components/nutrition/FoodLogger.tsx:275-332`, `src/components/nutrition/FoodLogger.tsx:1673` | If a barcode scan hangs on a bad connection, an old scan can no longer suddenly replace the product you're reviewing. It also can't pull you out of the Manual or Saved tab, or save the nutrition you type under the wrong barcode. A wrong barcode binding would… |
| G11 | low | Late photo and describe results overwrite what the user did while waiting (photo review takes over another tab; describe replaces manual… | `src/components/nutrition/FoodLogger.tsx:334-373`, `src/components/nutrition/FoodLogger.tsx:1509` | If you start an AI photo analysis or an AI "describe this food" lookup and do something else while it runs, the late answer no longer takes over. It will not jump you out of the tab you moved to, overwrite macros you typed or a saved meal you picked, or… |
| G13 | low | WHOOP apply loop makes 2-4 serial requests per change and ignores write failures, making first and catch-up syncs slow and leaving… | `src/lib/whoopSync.ts:114-131`, `src/stores/appStore.ts:1540-1575` | Connecting WHOOP for the first time, and syncing after a long break, goes roughly 3-5 times faster: a few seconds instead of possibly 10-20 seconds of waiting. That also makes it less likely that iOS pauses the app partway through a sync. The "N new" message… |
| G14 | low | No test covers a failed WHOOP read or overlapping sync runs, and a unit test enshrines 'empty segments means delete sessions' | `tests/whoopSync.test.ts:47-110`, `tests/whoopSync.test.ts:159-360` | The WHOOP import can currently delete a user's auto-grouped activity sessions when a database read briefly fails, for example on a flaky connection. These tests are what would catch that bug. Once the fix is in, they stop it from quietly coming back in a… |
| G17 | low | The native scanner closes on the first code it sees, including GS1 DataBar payloads the app then rejects as 'failed its checksum' | `ios/App/App/HyperBarcodePlugin.swift:19-21`, `ios/App/App/HyperBarcodePlugin.swift:103-122` | On iPhone, pointing the camera at a meat, deli or produce label that also carries a long GS1 DataBar strip can make the scanner grab the wrong code, close, and show "failed its checksum". You then have to reopen it or type the digits by hand. With this fix… |
| G20 | low | Photo-worker URL, provider and coach goal text are stored per device, survive sign-out, and block the next account's own settings from… | `src/lib/photoAnalysis.ts:39-91`, `src/components/nutrition/GoalsCoach.tsx:41` | If a second account ever signs in on the same phone, for example a test account or a handed-over device, it no longer sees the first person's private health-goal text in the coach box. It also gets its own saved photo-worker choice instead of silently using… |

## Appendix B: disproved findings

These were proposed, then refuted on reading the code.

- **F37: Settings is a single 2,146-line component; each keystroke re-renders the hidden kept-alive NutritionWizard and GoalsCoach.** I read the cited ranges. The structure is as described: one very large component, kept-alive wizard and coach, a beforeunload effect with no dependencies, and searchApp called on every render. The claimed benefit does…
- **F49: GPS trace snapshot writes up to about 5M characters to localStorage every 30 s, mostly redundant on native.** I read useRunTracker.ts (commit, the three lazy initializers, attachSource, start/resume/finish/discard), runTracker.ts (serializeTrackerTrace, boundedTrace, restoreTrackerTrace, advanceTracker, finishTracker),…
- **F60: Photo worker blocks its event loop with synchronous CLI auth checks on every POST.** I read scripts/photo-food-worker.mjs lines 149-182 (authenticatedProviders), 380-398 (withProviderFallback) and 505-570 (the request handler). The call with refresh=true really is on the POST path. Three things make it…
- **F62: Edge functions each repeat a network getUser round trip; the barcode scan cascade pays it up to four times in a row.** I read food-lookup/index.ts, config.toml, the FoodLogger barcode and photo paths, and usdaClient.ts. The code does call getUser on every food-lookup invocation, and the scan cascade does invoke the function up to four…
- **F63: RLS policies re-evaluate auth.uid() per row, and child tables run a per-row EXISTS.** I read schema.sql:369-492, the flexible-programming migration policies, and every place in src that queries workouts or sets. The code does look the way the claim says, and it would set off Supabase's linter. It is…
- **F79: The ~95 KB food-logger module graph ships in the main bundle though it is only used when the Log food sheet opens.** I checked the cited locations. MealLogger is imported statically in Nutrition.tsx:6 and Settings.tsx:11 and rendered inside a Modal at Nutrition.tsx:802. FoodLogger is 103 KB of source, and usdaClient, openFoodFacts and…
- **F85: No tests cover the program editor reducers or the create and save paths.** I read the test directory and grepped for splitEditStore, createSplit, setActiveSplit and saveEdit. The claimed gap does not exist as described. The protected active-program save path already has an end-to-end safety…
- **F86: Web motion detector allocates a new array and Set on every devicemotion event (~60 Hz).** I read deviceMotion.ts in full and the geolocation source in useRunTracker.ts. The per-event work really happens: filter, Set, RMS over about 150 samples at about 60 Hz. But that adds up to roughly 9k trivial operations…
- **F89: Time picker wheel reshapes every row on every scroll frame and promotes all 74 rows to layers.** I read DateTimePicker.tsx (WheelColumn, lines 161-253), wheelSelection.ts (drumFace) and kinetic.css:64-72. The mechanics match the claim. The practical cost is negligible. For at most 60 small buttons per frame, the…
- **F90: Callers that only need reduced motion trigger the WebGL probe at startup, and every policy read builds new MediaQueryLists.** I checked src/lib/motionPolicy.ts:26-82 and 120-122, motionLight.ts:98, fx.ts:63 and CountUp.tsx:32. They behave as claimed. supportsWebGL() creates a context once, caches the result in `webglProbe` and releases the…
- **F101: The run recorder opens a FileHandle, writes and fsyncs on the main thread for every location callback.** The mechanics are as claimed, but the benefit of changing them is not material. (1) Cost: one small open/write/fsync/close per second is a tiny fraction of main-thread time, and it costs far less than what the same…
- **F102: Run GPS uses kCLLocationAccuracyBestForNavigation on battery for the full run.** The claim describes the configuration accurately. It is not a material optimization finding. (1) The reviewer admits the battery impact is unmeasured. On current iOS, continuous GPS with no distance filter uses most of…
- **F104: The Cronometer import creates meal groups with one sequential insert per group.** I read the cited code and traced its callers. The mechanics hold: ensureGroups makes a sequential round trip for each missing group, while foods and logs are bulk-inserted in chunks. But the only caller of…
- **F105: Composite indexes are missing for the hottest workout queries.** The indexes are missing as described, but the impact is not material. The existing user_id index already narrows every one of these queries to a single user's workouts. At about one workout per day, that is a few…
- **F106: WHOOP edge functions have no timeouts on external calls and treat a database read error as 'not connected'.** I checked the cited lines and every client caller. The DB-error half of the claim has no effect the user can see: the edge-function client collapses all non-2xx responses into one generic error, and syncWhoop turns that…
- **F107: planSchedule.test uses fixed 50 ms sleeps and repeats an 11-line nested mock eight times.** I read the cited tests and the implementation. All the mocks resolve synchronously and no timers are involved, so the 50 ms sleep is always long enough and each negative assertion is meaningful: a broken timestamp guard…
- **F109: Pages subscribe to the whole Zustand store without selectors, so any store write re-renders the current page.** I read the cited locations. Whole-store subscription does happen, but it only adds renders at infrequent moments: one extra render per app foreground on pages that don't read whoopConnection, and a few during the fetch…
- **F111: Duration and distance formatters are duplicated with visible drift.** I read every cited location and the callers. formatActivityDuration (activitySessions.ts:28-38) and formatWorkoutDuration (workoutSessions.ts:119-129) do share a body. formatActivityDuration is called only from…
- **F113: Merging a GPS run with a WHOOP run deletes the WHOOP session even when moving its splits or copying its stats failed.** I traced what happens to the leftover data on the next sync.  1) Segment move fails, WHOOP session deleted. The database sets those segments' session_id to NULL. On the next sync, runWhoopSync…
- **G8: Tapping 'Scan again' while the native scanner is still closing leaves a stuck spinner for 5 minutes with no button.** To hit this bug, a touch has to reach the WKWebView's "Scan again" button during the roughly 0.3–0.4 s UIKit animation that dismisses the full-screen scanner. In that time:  1. The native reject has to cross the…
- **G12: Photo prep re-encodes each photo on the main thread for every retry and clarification, up to 4 JPEG encodes, the last below its own 0.6….** I read the cited code. The re-encode does happen, but only once per explicit user action ("Analyze", "Retry" after an error, or the single allowed clarification, which clarificationUsed limits to one). It is not in a…
- **G15: Native syncRest re-publishes every dock field on each once-a-second sync, and JS sends a remainingMs that changes every second even while….** I read the cited Swift (the RestDockModel, RestDockView, syncRest and refreshRest code), RestTimerPill, useNativeRestDock and connectNativeSurface. The claim's facts are right: there is one un-deduplicated syncRest per…
- **G16: Native rest dock shows '0:00 · Rest' with a pause button for up to a second until the next web tick marks rest complete.** Checked HyperGlassSurfacesPlugin.swift:62-180. `completed` is `model.status == "completed"`, and `remaining(at:)` clamps to 0 while status is "running". So the dock can show 0:00 with 'Rest', the warning tint, pause and…
- **G18: JS cannot close the native scanner: after its 5-minute timeout or on unmount the camera stays up and a later scan is silently discarded.** I read HyperBarcodePlugin.swift and BarcodeScanner.tsx in full at the cited lines. The mechanics are real. There is no cancelScan method. After withTimeout rejects, the native call can still resolve, but nothing awaits…
- **G19: The finished photo analysis is withheld until every item's USDA grounding lookup returns.** The pattern is there as described: the photo review waits for every USDA grounding lookup before it shows up. The impact doesn't hold up, though. (1) The lookups run in parallel with Promise.all, so the extra wait is…

## Appendix C: real but not worth acting on

- **F35: Every keystroke on History re-renders the full calendar and every workout card and redoes their derivations.** I read History.tsx 820-850, 995-1045, 1310-1520 and 1720-1830. The mechanics are confirmed. handleMovementNoteChange (around line 1013) calls setMovementNotesByWorkout, and the target-sets input calls…
- **F38: USDA lookups send the full raw USDA JSON to the phone and then parse it twice.** I read food-lookup/index.ts:196-232, usdaClient.ts, usdaSearch.ts (mapUsdaFood, searchUsdaFoodByBarcode, fetchUsdaFoodDetail, selectPortionFromDetail) and the FoodLogger callers (270, 297, 321, 852, 2042). The mechanics…
- **F59: Live Activity types, action enum and intent are duplicated across the app and widget targets, and the app copy is the one that runs.** I read the files and diffed them. Apart from imports, availability annotations and formatting, RunActivityAttributes, RunControlAction and RunControlIntent match between App/RunLiveActivity.swift and…
- **F61: analyze-food-trial makes N+4 sequential Storage round trips per request (bucket check plus linear quota slot probing).** I read gateway.ts, storageLedger.ts, index.ts and the gateway tests.  The mechanism is real. Every new paid request runs, one after another: the bucket-privacy GET, the replay GET, the claim POST, then slot POSTs from 0…
- **F69: About 21-24 KB of research-rule text that nothing reads at runtime ships in the entry bundle.** I confirmed with grep that the only runtime importers of the snapshot are splitTemplates.ts, which calls compileEvidenceTemplates and keeps only .templates, and programDesigner.ts, which reads only exercise_profiles.…
- **F74: Test fixture and mock helpers are copy-pasted across files and have drifted; the existing in-memory Supabase fake isn't reused.** I checked the code. The mock client (src/preview/mockSupabase.ts:216-235) handles eq/in/is/gte/lte/order/limit/range, but not(), contains() and filter() do nothing and maybeSingle is the same as single. It is also the…
- **F84: SplitBuilder and the evidence/program-designer stack load at startup but are only needed when the 'New program' sheet opens.** Confirmed from the code: - Splits.tsx:9 imports SplitBuilder statically, and it is used only inside the 'New program' Modal (706-723). - Modal.tsx wraps its content in `{isOpen && ...}` inside AnimatePresence, so…
- **F91: The compact Today figurine rebuilds a full WebGL context, PMREM and physical shaders on every Today visit.** The code confirms the mechanics. Each time VolumeMaquette variant='compact' mounts with wants3d true, it creates a new antialiased WebGLRenderer (host.ts:31), runs PMREMGenerator.fromScene(RoomEnvironment) synchronously…
- **F95: Every Supabase request reads the Keychain across the native bridge (no in-memory session cache).** The mechanism is real. In the installed auth-js 2.115 build, __loadSession (GoTrueClient.js about line 2512) calls getItemAsync(this.storage, ...) on every authenticated request, and the lockless path has no in-memory…
- **F96: PWA autoUpdate reloads the page as soon as the app returns to the foreground, even mid-workout, losing unsaved inputs.** The mechanism is real. vite-plugin-pwa's autoUpdate client (node_modules/vite-plugin-pwa/dist/client/build/register.js) calls window.location.reload() on workbox 'activated' when isUpdate or isExternal is set, and…
