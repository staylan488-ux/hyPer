# Current state

Recorded 2026-10-30 (Pacific). Finished work was cleared from this file that
day; Git history keeps the full record (this file at commit 2cd1fd2).

## Where things stand

- The released app is the React Native app in `native/`: hyPer 2.0,
  `app.hyper.mobile`. The owner approved the cutover and it was done on
  2026-10-28 (PR #152). The Capacitor shell (`ios/`) and the retired web UI
  were removed from the repository on 2026-10-30; `src/` now holds only the
  shared code the app imports. The Vercel project `hy-per` that hosted the web
  app no longer builds (`vercel.json` turns its Git deployments off); its last
  web build stays online until the project is deleted in Vercel.
- TestFlight: 2.0.0 build 65, built from main at 5072efb (through PR #170)
  on 2026-11-04 UTC, is the latest upload; the Team group gets every build.
- Ship pipeline: since PR #156, `scripts/ship.sh` hands over to the build
  clone's own copy and cleans up after every run. The running bot keeps its old
  code until it is restarted with `scripts/ship-bot/install-launchd.sh` (not
  during a ship); no restart is recorded.
- The owner's iPhone has a released build from before PR #157. Install current
  main with `HYPER_APP=release native/scripts/build-phone.sh <device-id>` when
  the owner asks (the phone must be on the Mac's Wi-Fi).
- Food AI defaults to Gemini through `analyze-food-trial`. The private photo
  worker (`deploy/photo-worker`) still runs on the VM with the 2026-09-29
  models and serves only a device set to the worker.

## Open items

- PR #158 was checked with the web suite, lint, build and native `tsc`; the
  widget's Swift and the changed screens were not built or run in a simulator.
- PR #157 was checked in the simulator. Not exercised: haptics on a phone, a
  superset pair (none in the sample workout) and VoiceOver.
- 2026-10-31: holding a movement in a live workout could close the app (the
  owner hit it on his phone): the lifted row's shadow reached Reanimated as
  "1.6e-7" on rare frames. The fix (`native/src/lib/liftShadow.ts`) was
  checked against Reanimated's own parser and in the iOS bundle; on
  2026-11-04 about 90 hold-and-drags in the simulator showed no error. No
  crash report was read from the phone.
- 2026-11-04: a dropped movement often kept its lifted shadow (half of 20
  drops on main, every one that ended at the foot of the list), because
  `liftShadow` returned `undefined` at rest and Reanimated sends nothing for
  that. It now writes an empty shadow; 0 of 20 drops kept one in the
  simulator. Not seen on a phone.
- 2026-11-04: a speed pass (branch `claude/project-thread-et0ddr`) with no
  change in looks or behaviour. Most of it lets the React Compiler optimize
  screens it was skipping (48 skipped functions on main, 29 after; the rest are
  rarely used sheets), so a logged set, a keystroke or a swipe redraws only
  what it touches: Train's live workout, swipe rows, drag-to-reorder, the Log
  food sheet, Fuel, History's calendar, the exercise picker, You and Program.
  Fewer round trips: food saves read the user id from the stored session,
  Fuel's reload and starting a program day read in parallel, History names
  program days from the loaded programs, and the store skips writes of
  unchanged data. Checked with the web suite, lint, build, native `tsc`, an
  iOS bundle export and eight review agents; not run in a simulator or on a
  phone. Worth a hand check: swipe, the press spring, drag-to-reorder and
  logging food.
- 2026-11-01: Skip a movement in a live workout (the owner's ask). Run in the
  simulator on 2026-11-04 (sample data, light and dark): Skip on the card, a
  row's swipe and the movement sheet, Undo, bringing it back, the counts,
  Finish naming the skipped movement and History without its sets. Not yet
  exercised: haptics, VoiceOver and a superset pair.
- 2026-11-03: an audit of the app's hand-kept state (saving flags, the
  workout's start and finish, rest, runs, sign-in, sync) fixed 15 bugs with no
  change when things work: Finish waits for a set still saving, one Start at a
  time, Retry only on the set that failed, the movement sheet closes only
  itself, a quick start that fails to save keeps the workout open, one Fuel
  lookup can't clear another's busy state, an edited entry's meal draft keeps
  its own slot, a meal never locks on a save that can't work, a failed History
  load says so, Discard waits for a run's save, rest or a split before GPS
  lock leaves the run's time and splits alone, a failed first load keeps the
  workout's lock-screen card, Health sync follows You's switch, and widgets
  keep their last snapshot through a failed load. Checked with the web suite,
  lint, build, native `tsc` and an iOS bundle export; not run in a simulator
  or on a phone. Left for the owner (they change sign-in or need a phone):
  sign-out offline can undo itself, a launch offline with an expired token
  waits about 25 s, and a widget or lock-screen card tapped mid-run closes the
  run screen. The unlikely ones are listed in the owner's doc "Hidden state
  machines in hyPer".
- 2026-11-03: PR #169 review follow-up, based on `b49cf40`, was prepared in
  `codex/pr169-state-fixes`; no merge or release was performed.
  Saved-recipe drafts and save targets are separate from logged entries;
  explicit edits of simple saved foods use the existing saved-meal editor and
  preserve the underlying entry draft. Abandoned scans release their busy claim
  immediately, and Photo keeps results across tab changes but drops work from a
  closed/reset capture. All Start paths share one attempt. Finish retains set
  save outcomes while the question is open, reads the latest session, guards
  account/workout changes and holds editing while completion saves. Lock-screen
  cleanup uses workout-read readiness; widgets also require successful food,
  target and profile reads. Health Stop prevents the next read/upload, although
  an upload already sent may finish. History name-read failures preserve the
  last complete month. Discard is visibly disabled while a run saves.
  Native source is now included in lint; the RN framework setup script also
  handles Bash 3.2's empty-array case on fresh builds. Verified: 1,937 tests,
  lint (including test types and instruction checks), build, native `tsc`, and
  a Debug simulator build. Simulator checks used sample data: set logging and
  Finish summary, food logging with a chosen time and reopening it, recipe draft
  isolation, saving a simple saved food and returning to the untouched entry,
  light/dark appearance and recorded cold-launch intro. Hardware
  camera/barcodes, HealthKit, device widget/Live Activity failure scenarios and
  real-account behavior remain unverified. No auth flow or schema changes.
- 2026-11-04: a whole-app bug hunt (branch `claude/project-thread-afhkpw`,
  one PR) fixed about 80 bugs, each with a test, with no auth flow or schema
  change. Two rounds of parallel reviewers found them, a skeptic checked each
  finding, and three independent reviews of the fixes found 24 more problems
  (several were slips in this PR's own fixes), all but one fixed in the same
  PR. Among them: a widget or card tap that launches the
  app opens its screen; superset rounds carry on when the partner has no set
  for that round; set count, note and movement order changes stay in step
  while saves run; a failed workout mode save is kept and sent again; History
  edits no longer undo each other, a set logged later is dated by its
  workout, and Today and Train follow History changes; weekly volume grades
  against default landmarks when none are saved (traps are not graded);
  WHOOP stats attach, detach and workout deletes never leave the activity
  hidden; activity edits keep times to the second; a saved product keeps its
  barcode and serving through edits; Log food holds while a save runs;
  comma decimals are read everywhere; You waits for saved targets; weigh-ins
  read 90 days, as the chart shows; a bodyweight movement logs an empty
  weight as 0; the live workout's day can't be removed from the program; the
  sample backend returns deleted rows like PostgREST; and, after merging the
  speed pass, screens and sheets left open past midnight move on with the day
  (Fuel's Copy to today and week strip, Train's program week, Progress's week,
  weigh-in "Today" labels, Schedule's Day 1, the date pickers). Checked with the
  web suite, lint, build, test types, native `tsc` and an iOS bundle export;
  not run in a simulator or on a phone (the intro from a widget, the
  widgets' Swift, drag and swipe feel, the disabled Log food tabs). Left for
  the owner: editing a weighed entry (200 g) opens per-serving Manual with no
  grams; products edited or deleted before this fix may still answer scans
  with their old numbers (needs a one-time data repair); Recent keeps old
  numbers after a saved meal is edited; "No program yet" shows when other
  programs exist but none is active; device surfaces are cleaned only when
  the tabs unmount (sign-in flow); Health sync and run state are per device,
  not per account; beat last time compares a swapped superset's first set
  with last time's set 2; a swap while a set saves can add a set; a pull to
  refresh still running at midnight can set the account's day back to the
  day before until the next refresh.
- `analyze-food-trial` on Hypertrophy-App (version 4) runs the live copy with
  only `serving.ts` replaced; main's `model.ts` (parallel Tavily searches) is
  undeployed. A full deploy of the function ships it, with the owner's approval.
- For the owner to confirm on the phone: sign-in carried over from the
  Capacitor app.
- For Alex, whose features these are, on a phone: WHOOP connect under the new
  identity, and saving a real GPS run (runs were saved only against a local
  test database). Also never seen on a phone: the run's sound cues and its
  lock-screen card, and the lock-screen widget sizes (built, not placed).
- Recorded for later (minor): merging 3+ activities in one step, the Target
  sets field in History, RPE below 6, Train's week strip, Progress's
  training-time detail, You's About build number, and an account deletion
  row (an App Store review need, with backend work).
- Left as is on purpose (interaction audit, 2026-10-28): logged sets in a live
  workout are corrected, not deleted (History deletes them); the Appearance
  row's whole-row menu (needs a SwiftUI row); a long press on Fuel's meal
  headers; removing an activity's start time; quick start chips' long press;
  header ⋯ menus stay silent (iOS gives them no tap callback).
