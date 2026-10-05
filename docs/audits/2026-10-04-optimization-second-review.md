# Second review of the optimization pass

Reviewed 2026-10-04 against `e0a7ce0` on `opt/batch-c2-pr`.

Scope: the six optimization commits after `de2cd14`: `e15762a` (A), `a82e264` (native runs), `0926d05` (WHOOP), `7485023` (B), `aec1fca` (C1), and `e0a7ce0` (C2). The combined diff touches 223 files. The original [optimization review](2026-09-26-optimization-review.md) and [handoff](../handoffs/current.md) were used to check the stated fixes and safeguards.

The findings and review evidence below describe the original read-only review. The owner subsequently requested implementation of all thirteen recommendations; the [implementation follow-up](#implementation-follow-up) records those changes and their validation. After validation, the owner authorized a PR and merge. No release or production deployment was requested or performed.

## Assessment

The pass contains worthwhile improvements: batched set creation, reuse of the program snapshot RPC, session-based user lookups, a separate session clock, shared food persistence, self-hosted fonts, route splitting, and bounded WHOOP write concurrency. I would keep that direction.

The main weakness is recovery across asynchronous boundaries. Several tests prove a helper's happy path or final list of IDs, while missing the ordering of reads, writes, account changes, and screen transitions. Some work marked finished therefore still has the failure it intended to prevent.

There are **12 substantive findings and one smaller editor issue** below. “Introduced” identifies a new behavior in this pass; “incomplete fix” identifies an older problem the touched code or stated safeguard still leaves open. The native findings are deterministic JavaScript reproductions, not claims of physical-device testing.

Priority: P1 = address before relying on this path in a release; P2 = concrete correctness/recovery bug; P3 = smaller usability issue.

## Findings at a glance

| ID | Priority | Finding | Attribution | Evidence |
|---|---|---|---|---|
| R1 | P1 | WHOOP catch-up failures strand older activities outside future retries | Incomplete B-1 recovery | Two-sync reproduction |
| R2 | P1 | Live GPS can overtake recovered points and undercount the route | Older race missed by B-2; new checkpoints can preserve the loss | Source + real tracker engine |
| R3 | P2 | Late nutrition responses restore another account's data after reset | Incomplete account isolation in C2/B | Three deferred-response reproductions |
| R4 | P2 | Schedule retry overwrites newer cloud data after a failed read | Introduced by A/F83 | Failed GET followed by successful write |
| R5 | P2 | Warm Train refresh overwrites newly typed movement notes | Introduced by C2 | Complete caller/effect trace |
| R6 | P2 | History still says Saved after failed target/superset edits | Incomplete F25/C2 | Store mutation + completion reproduction |
| R7 | P2 | Concurrent note saves overwrite each other's plan changes | Incomplete F21/F33 | Shared autosaver + actual store actions |
| R8 | P2 | Flexible workout starts without its required day plan | Incomplete F3 | Failed plan insert + subsequent Add Exercise |
| R9 | P2 | Request timeout ends at headers, before the body finishes | New wrapper incompletely implements F7 | Real Supabase SDK + stalled stream |
| R10 | P2 | Legacy run snapshots replay already-applied controls | Incomplete B-2 migration handling | Legacy Rest/Resume reproduction |
| R11 | P2 | Old-month failure handler replaces the selected month's nutrition | Incomplete F12 | Component callback/effect harness |
| R12 | P2 | Describe handoff discards a retained Gemini analysis | Incomplete G10 | Component callback/key harness |
| R13 | P3 | First numeric editor draft leaves Save disabled | Older editor gap retained by F47 | Browser observation + source |

### R1 — WHOOP retries can permanently skip an older failed activity

Locations: [appStore.ts](../../src/stores/appStore.ts), lines 2062–2069 and 2184; [whoopSync.ts](../../src/lib/whoopSync.ts), lines 94–119 and 145–163.

The sync first upserts all fetched segments, then creates/updates/links the corresponding activities. The next sync's watermark is the newest segment already stored, regardless of whether reconciliation succeeded.

A catch-up containing June 20 and July 7 can therefore store both segments, fail to create the June 20 activity, and then retry only the seven days preceding July 7. June 20 is outside that window. Healthy ordinary retries never create it. Throwing after the segment write does not repair this; neither does returning a smaller success count. The raw segment survives, but the missing activity requires a wider/manual reconciliation.

**Evidence:** a two-run reproduction with an older failed create and a newer successful segment left the older activity absent after a healthy second sync. The same window problem applies to failures after segment upsert, including reconciliation reads.

**Repair:** track successfully reconciled progress separately from fetched progress, retaining an outstanding reconciliation window until every necessary write succeeds. Preserve the existing bounded concurrency within each phase. Test failure followed by retry over a window longer than seven days.

### R2 — A new live GPS point can make the recovery backlog stale

Locations: [nativeRunSource.ts](../../src/lib/nativeRunSource.ts), lines 68–102, 140–152, and 162–166.

While a resync awaits persisted samples and controls, live listeners still feed newer events directly to the engine. A new point advances the engine's last timestamp; older recovered points subsequently count as stale. Sorting only the drained batch cannot fix its order relative to events already delivered live.

**Evidence:** a 201-point curved route with points 21–200 delayed during resync and point 201 delivered live produced **170.37 m instead of 589.08 m**. Every sequence was delivered once. An existing test sorts delivered IDs before comparing them, so it cannot detect this loss.

Immediate live delivery predates the pass. The new persisted highest-delivered sequence can additionally prevent replaying a missed interval after a later resume.

**Repair:** serialize recovery and buffer live samples and controls while a drain is pending. Merge events in chronological order before delivering them to the tracker, and checkpoint contiguous applied progress. Test the source and real engine together using a curved route and interleaved controls.

### R3 — Account reset does not invalidate all pending nutrition work

Locations: [appStore.ts](../../src/stores/appStore.ts), lines 2993–3010, 3038–3046, 3134–3136, and 3229–3236.

`resetAppData()` clears the store and invalidates selected workout/program reads, but delayed macro-target and nutrition-profile reads still commit unconditionally. Account A's response can arrive after account B has signed in and replace B's targets or demographic profile.

The adaptive target response has a related hole: comparing the current target with the initial target accepts A's late response when both the original target and the reset/new-account target are null. Its single-flight promise is also global rather than account-keyed.

**Evidence:** three deferred-response checks reproduced stale target replacement, stale profile replacement, and a stale adaptive target repopulating the reset store. These demonstrate local account-data contamination, not an RLS bypass or proven cross-account database write.

**Repair:** capture an account/session generation before asynchronous work and require it to match before every account-owned state commit. Validate cached profile ownership before using it and key adaptive work by account. Apply this consistently rather than adding isolated equality checks.

### R4 — A failed schedule read permits overwriting a newer cloud schedule

Locations: [planSchedule.ts](../../src/lib/planSchedule.ts), lines 156–170 and 270–280.

`loadFromDB()` returns null for both “no row” and “read failed.” The new pending-save retry treats either as permission to unconditionally upsert its cached schedule. A transient failed SELECT followed by a successful UPSERT can overwrite another device's newer start date/weekdays and replace its timestamp with an older one.

**Evidence:** a failed GET followed by a successful pending retry overwrote a newer remote schedule in the reproduction. Current tests cover a successfully read newer cloud copy, which misses this case.

**Repair:** distinguish read failure from successful absence. If freshness could not be established, keep the local copy and pending marker and defer the write. For full concurrency protection, condition an existing-row update on the observed `updated_at` and require a returned row; insert genuinely absent rows without overwriting a conflict. This can be implemented using existing columns. Merely skipping failed reads leaves the separate read/write race open.

### R5 — Warm Train refresh can erase a new movement-note draft

Locations: [Workout.tsx](../../src/pages/Workout.tsx), lines 175, 261–280, and 497–519.

Concrete sequence:

1. Save note A in a split workout. The direct save succeeds but does not update `currentWorkout.notes` in the shared store.
2. Navigate Train → Fuel → Train. C2 immediately exposes the cached workout while refreshing it.
3. Type note B before that refresh returns.
4. The refresh returns server note A. The notes effect replaces the draft and its ref with A and marks A persisted.
5. The queued save reads the replaced ref and skips it as unchanged. B is lost.

The previous initial loading screen prevented editing before that mount refresh finished. The workout read guard does not cover these direct split-note saves.

**Evidence:** source-verified across the write, warm initialization, refresh, hydration effect, and deferred payload builder. Not reproduced in an automated browser; the existing warm-mount test only checks the initial server-rendered frame.

**Repair:** preserve dirty drafts when refreshing the same workout. Update the shared note snapshot after successful saves, and use a draft revision to prevent old server data replacing a newer local edit.

### R6 — History target/superset failures still resolve as successful saves

Locations: [appStore.ts](../../src/stores/appStore.ts), lines 2888–2953 and the adjacent superset helpers; [History.tsx](../../src/pages/History.tsx), lines 1005–1056 and 1271–1295.

Target-set changes ignore a null plan-update result and only log failed set reads/inserts/deletes. History's `runMutation` sees a resolved promise, refreshes, shows Saved, and discards the draft.

**Evidence:** increasing an unfinished workout from two logged sets to three, with the new-set insert failing, left a plan targeting three but only two actual sets. The subsequent `syncWorkoutCompletion` marked it complete. Already-completed workouts also get the false Saved and mismatched plan. Re-entering the same target can skip repair because it now matches the updated plan value.

**Repair:** propagate every failure, retain the draft, and allow reconciliation even when the requested target equals the plan's displayed target. A failure refresh should read state without promoting completion. A shared write contract for live and History edits would prevent the error behavior from drifting; an atomic plan/set operation is the stronger solution if a later backend change is approved.

### R7 — Note flushing still starts conflicting whole-plan writes

Locations: [noteAutosave.ts](../../src/lib/noteAutosave.ts), lines 113–123; [Workout.tsx](../../src/pages/Workout.tsx), lines 285–296; [appStore.ts](../../src/stores/appStore.ts), line 1438 onward.

The shared autosaver tracks pending work per exercise, but each flexible note update replaces the entire plan. Flushing two notes starts both writes from the same initial plan. The second write can restore the first note's old value.

**Evidence:** clearing a curl's template note and changing a row note caused the second plan write to restore the cleared curl note. Blank notes are omitted from serialized workout notes, making this especially visible when the plan's old note reappears on return. A slow blur save overlapping a later note save can create the same race without an explicit multi-note flush.

**Repair:** coalesce all dirty notes for a workout into one plan update, or serialize per-workout patches and merge against the latest plan when each begins. This improves correctness while also reducing redundant writes.

### R8 — Flexible start can succeed with an unusable missing plan

Location: [appStore.ts](../../src/stores/appStore.ts), lines 1038–1050 and 1065–1084.

A failed `workout_day_plans` insert is logged, but startup continues and returns the workout with a null plan. `addFlexibleExercise` requires that plan and silently returns. Retrying Start resumes the same incomplete workout.

**Evidence:** a failed plan insert returned a successfully started workout; its next Add Exercise action made no database request. The new start-failure tests cover workout/set writes, not this required plan write.

**Repair:** reject and clean up a failed initial plan creation just as failed set creation is handled. Also repair or explicitly reject an existing flexible workout that lacks a plan, so retry does not resume the broken state.

### R9 — The request timeout stops before response-body consumption

Location: [timedFetch.ts](../../src/lib/timedFetch.ts), lines 57–61.

`fetch()` resolves when response headers are available. The wrapper immediately clears the timer and removes caller-abort forwarding in `finally`. Supabase then awaits the response body. If that body stalls, an ordinary query or auth refresh can remain pending past the promised deadline.

**Evidence:** a streamed response through the real Supabase SDK remained pending after 31 seconds of fake time. A second check showed a caller's abort after headers no longer reached the underlying signal.

Set saves and workout completion retain their separate attempt-level timeout; this finding does not imply those UI operations wait indefinitely. Their transport cancellation can still be lost, leaving requests alive during retries.

**Repair:** keep the deadline and abort forwarding alive through body consumption. REST/auth JSON responses can be buffered under that deadline, preserving response status, headers, and null-body cases. Preserve the intentional edge-function exemptions. Add a headers-first/stalled-body test, not only a fetch promise that never resolves.

### R10 — Legacy snapshots replay already-applied lock-screen controls

Locations: [runTracker.ts](../../src/lib/runTracker.ts), lines 665–674; [useRunTracker.ts](../../src/hooks/useRunTracker.ts), lines 328–346.

Snapshots without native cursors resume controls from sequence zero. The migration cutoff only filters GPS samples, so prior Rest/Resume or Split events are applied again.

**Evidence:** a legacy snapshot already containing a two-second Rest/Resume interval ended up with `totalPausedMs` increased from 2,000 to 4,000 after recovery.

**Repair:** define a legacy control replay boundary from the snapshot's timing/state, skip represented controls while advancing the cursor, and apply genuinely later controls. The last GPS timestamp alone is insufficient because controls can occur after it. Add upgrade/resume coverage containing controls.

### R11 — An old month's error handler defeats the nutrition request gate

Location: [Nutrition.tsx](../../src/pages/Nutrition.tsx), lines 276–289.

Default-group creation's failure paths call `fetchMonthLogs(selectedMonth)` using the old effect closure before checking `cancelled`. After a month switch, this starts a new request for the old month. The request gate correctly accepts it as newest, replacing the current month's data with the wrong month.

**Evidence:** a component harness started October's group insertion, switched to September 15 with 500 kcal, then failed the old insertion. September 15 changed to 0 kcal because October's logs replaced September's.

**Repair:** check cancellation before launching follow-up requests; mutation-triggered reloads should target the currently selected month. Test follow-up requests generated by failed mutations, not just two overlapping initial reads.

### R12 — Describe can discard a retained Gemini analysis without confirmation

Location: [FoodLogger.tsx](../../src/components/nutrition/FoodLogger.tsx), lines 417–422.

While Gemini is analyzing, the user can switch to Manual, enter a description, and tap Review with Gemini. This path checks `foodDescriptionBusy` but not the retained trial's busy state, then increments `trialKey`. React remounts the AI logger, discarding the analysis state and photos.

**Evidence:** a component harness verified that the handoff remained enabled during retained analysis and changed the child's key from 0 to 1. Ordinary tab switching is preserved; this alternate entry point bypasses that protection.

**Repair:** prevent the handoff while analysis runs, and confirm replacement of an existing result or draft before changing the key. Keep ordinary tab switching available.

### R13 — First numeric editor draft leaves Save disabled

Locations: [SetRangeFields.tsx](../../src/components/split/SetRangeFields.tsx), line 99; [SplitEditor.tsx](../../src/components/split/SplitEditor.tsx), lines 340 and 483.

The first edited number exists only in the field's local draft until blur. The editor still sees `isDirty === false` and disables Save, so its new `commitFocusedField()` cannot run from that button.

**Evidence:** in the local fixture preview, changing Bench Press minimum reps from 6 to 7 while focused left Save disabled. Tapping elsewhere/committing the field is a workaround. This is an existing editor usability gap, not proven numeric data loss.

**Repair:** expose draft dirtiness to the editor or permit Save to commit and validate the focused field before deciding whether there is a change. Verify on the iOS numeric keypad as well.

## Better implementation choices

1. **Coalesce note writes by workout.** One merged plan update is both cheaper and safer than separate per-exercise writes of the same whole plan.
2. **Use one account generation for asynchronous store commits.** Keep the existing request helpers, but apply a consistent account-lifetime check to all account-owned work. This is simpler to audit than scattered field-equality comparisons.
3. **Separate fetching from successful reconciliation.** WHOOP's concurrency improvement can stay; its checkpoint should represent completed work so failed writes remain retryable.
4. **Give workout mutations a consistent success/error contract.** The shared set-count calculation is useful, but duplicate callers still differ in error propagation. Unifying that contract yields more value than further helper extraction alone.
5. **Keep the launch improvements and measure further prefetching.** The current build's entry and vendor JavaScript total approximately 338.54 KB gzip. Web launch also imports all secondary pages after three seconds, and the service worker precaches the app. Thus route splitting reduces initial evaluation work, but is not a comparable reduction in total download size. Intent-driven or sequential idle warm-up is worth profiling on a slow device; no measured regression is asserted here.

## Original review verification and limitations

- Existing suite: **1,552 tests passed in aggregate**. The first sandboxed run passed 1,550; two worker boot tests could not bind localhost. Both passed when rerun with local-server access.
- `npm run lint` passed, including instruction validation and test type-checking.
- `npm run build` passed. Existing large-chunk and stale Browserslist-data warnings remain.
- Fourteen additional deterministic checks exercised the substantive bugs: five nutrition checks, four workout/schedule checks, three native checks, and two timeout checks. Some intentionally assert the observed bad outcome; others fail an expected-correct assertion. They are review reproductions, not passing fixes.
- Nutrition component checks use an isolated hook/callback harness, not a real browser renderer. Warm-note loss is source-verified. R13 was observed in Chrome using sample data on an isolated local preview origin.
- Physical-device GPS, ActivityKit, Keychain/network-loss behavior, HealthKit, camera scanning, and production database behavior were not exercised. Swift changes were inspected; no new native build was needed for this read-only audit.
- The private worker service, Supabase functions, migrations, and production data were not changed. The original handoff's deployment/device follow-ups remain outstanding.
- Temporary reproduction tests were removed from `tests/`; copies are retained under `/tmp/hyper-review-*`. Application files are unchanged. The pre-existing untracked `.claude/launch.json` and `supabase/.temp/linked-project.json` were left alone.

## Suggested order

First fix R1–R4 and the workout false-success/partial-start paths (R6/R8). Then address the note lifetime issues (R5/R7), complete transport and run-recovery handling (R9/R10), and close the nutrition interaction gaps (R11/R12). R13 is a small follow-up.

For each repair, retain a regression that asserts user-visible persisted results across the relevant failure and retry. Full-suite success alone does not establish those recovery properties.

## Implementation follow-up

Implemented locally on `opt/batch-c2-pr`, based on `e0a7ce0`, on 2026-10-04 (Pacific). All thirteen recommendations have an implementation and regression coverage. The original finding text above remains historical evidence of the reviewed version.

| Finding | Result | Regression coverage |
|---|---|---|
| R1 | Persist an account-specific unfinished WHOOP reconciliation window before ingestion; retain it after failures; repair older stored segments; page reconciliation reads and fail safely on incomplete remote pagination. | [WHOOP sync](../../tests/whoopSync.test.ts), [store contracts](../../tests/appStore.mustWork.test.ts) |
| R2 | Serialize recovery, buffer live events, and apply samples/controls in time order before advancing cursors; ignore detached sources. | [Native source](../../tests/nativeRunSource.test.ts) |
| R3 | Invalidate account generations before clearing state; guard delayed reads/writes and queued notes; separate adaptive/WHOOP flights across account lifetimes; reject cached data with the wrong owner. | [Adaptive targets](../../tests/appStore.adaptiveTargets.test.ts), [shared reads and writes](../../tests/appStore.sharedReads.test.ts) |
| R4 | Distinguish failed schedule reads from absence; retry existing rows against their observed timestamp, insert absent rows without overwriting conflicts, and serialize local writes. | [Schedule persistence](../../tests/schedulePersistence.test.ts) |
| R5 | Preserve dirty notes across warm refreshes and acknowledge only saved values; update the shared workout snapshot after saving. | [Page hydration](../../tests/workout.noteHydration.test.ts) |
| R6 | Propagate plan/set/superset failures; retain History target drafts; refresh failures without promoting completion; reconcile an unchanged target on retry. | [Workout failures](../../tests/workoutEditFailures.test.ts), [store contracts](../../tests/appStore.mustWork.test.ts) |
| R7 | Serialize note and plan changes per workout across page remounts, merge queued note patches, and capture payloads before refs change. Finish waits for queued writes. | [Note autosave](../../tests/noteAutosave.test.ts) |
| R8 | Roll back failed initial flexible-plan creation; repair/recreate missing-plan sessions on Start retry; require the plan before exposing a cold-restored flexible session. | [Workout failures](../../tests/workoutEditFailures.test.ts), [restore/read races](../../tests/appStore.workoutReadRace.test.ts) |
| R9 | Keep the request deadline and caller cancellation active until the REST/auth response body has finished. | [Timed fetch](../../tests/timedFetch.test.ts) |
| R10 | Deduplicate legacy native controls and skip only the prefix represented by saved state; retain native pause state while replaying events. | [Legacy controls](../../tests/nativeLegacyControls.test.ts), [native hook](../../tests/useRunTracker.native.test.ts) |
| R11 | Old-month callbacks cannot supersede the selected month's nutrition request; cancelled failure handlers stop before refetching. | [Nutrition month race](../../tests/nutrition.monthRace.test.ts) |
| R12 | Report retained Gemini draft/busy state to the parent; block handoff while busy and confirm replacement of existing work. | [AI handoff](../../tests/foodLogger.aiHandoff.test.ts) |
| R13 | Keep Save reachable for a focused numeric draft; commit focus before deciding whether to save/discard; share Cancel/Escape/backdrop handling. | [Focused editor draft](../../tests/splitEditor.focusedDraft.test.ts) |

Validation:

- **1,634 tests passed in aggregate across 133 files**, including 82 more tests than the reviewed baseline. The final full run passed 1,632; two shared-read fixtures still described flexible workouts without the now-required plan. After correcting those fixtures, all 15 tests in the affected file passed. Worker boot tests ran with localhost-listener access.
- `npm run lint` passed, including instruction checks and test typechecking. Targeted ESLint and test typechecking passed again after the final fixture correction.
- `npm run ios:sync` passed, including `npm run build` and Capacitor sync. Required production runtime environment variables were present; values were not printed. No tracked generated iOS files changed.
- `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -quiet build` passed against the final synced assets. Xcode required access to its normal cache directories.
- Chrome fixture checks at 390×844 covered the current Ivory and Black themes, focused numeric Save persistence after reopening, Cancel confirmation retaining the draft when declined, and Gemini → Manual → Describe replacement confirmation retaining the original AI hint when declined. No backend AI analysis was requested. Component race tests use explicit hook/effect harnesses; these are complemented by the browser checks rather than presented as real browser-renderer tests.
- PR preparation incorporated current `main` (`5da071d`), preserving the newer zero-value set and overlapping-sheet fixes. The integrated branch passed **all 1,646 tests across 134 files in one full run**, lint, web build/Capacitor sync, and the iOS simulator build. The original implementation totals above describe the earlier reviewed base.

Remaining limits:

- Physical-device GPS, suspension/recovery, lock-screen controls and Live Activity behavior still need device testing. Simulator compilation and deterministic native-bridge tests do not establish those behaviors.
- Old snapshots mixing in-app and native pauses lack exact provenance. Migration skips only an exactly accounted control prefix; ambiguous legacy controls may still replay. Newly recorded snapshots have explicit sequence cursors.
- WHOOP's existing ten-page remote limit now fails before ingestion if exhausted. Very large stored repairs also fail safely instead of reconciling truncated history. Checkpoints use account-scoped local storage; a new installation rebuilds repair coverage from stored segments.
- Workout plan/set mutations remain separate database operations. Failures are surfaced and retryable, but this change does not provide a database transaction across them. Direct new schedule saves retain their existing last-write behavior; background retries have conditional conflict protection.
- Production services/data and physical devices were not exercised. This implementation makes no schema/auth-flow changes and includes no deployment. The owner's subsequent PR/merge authorization is recorded in the current handoff. Existing deployment follow-ups remain separate work.
