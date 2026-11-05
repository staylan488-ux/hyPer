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
- TestFlight: 2.0.3 build 68, built from main at 24ba2fe (through PR #180)
  on 2026-11-04 Pacific, is the latest upload; the Team group gets every
  build. 2.0.2 build 67 (main at 83f47a4, through #179) came before it.
- 2026-11-04 merges, in order: #178 (the bug hunt #175, accessibility #174
  and design review #177 stacked; #174, #175 and #177 closed as merged with
  it), #179 (three fixes from a Codex review of #178), #176 (Snap a meal,
  instant launch, Fuel reminder, with four fixes from a Codex review of it
  added on top) and #180 (End early). The entries below for those branches
  describe work that is now on main.
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

- 2026-11-05: full weigh-in history (branch `claude/project-thread-kduqvg`,
  the owner's ask: weigh-ins older than about a week couldn't be found).
  You's Body weight card has a chevron; Body weight's chart takes 1M, 3M
  (default), 6M, 1Y or All on a calendar axis ending today, with dates under
  it and the change across the range in its line; Recent ends in All
  weigh-ins, every weigh-in by month with each month's average, swipe and
  hold to delete typed ones. Every weigh-in is read page by page
  (`getAllBodyWeights`) on You and Body weight, joined to the 90-day read
  (`mergeWeightHistory`); reads that overlap can't undo a newer one. The
  sample account has seven months of weigh-ins. Not seen on a phone or with
  the real account; VoiceOver untried.

- 2026-11-04: pre-TestFlight reliability follow-up
  (`fix/pre-testflight-reliability`). The owner approved merging these fixes
  before shipping main through Discord and using the new build normally for
  24 hours. No TestFlight upload was performed in this session.
  - Editing a weighed or measured entry opens the existing amount editor
    (grams or millilitres), not Manual's servings. Saving keeps the original
    food row, source, date and time. Amount changes participate in the leave
    guard and carry back to Manual if the person goes back to edit macros.
  - Fuel keeps pending and confirmed deletions out of late month/day reads,
    including today's totals. Failed deletions restore only into the same
    account and month; repeated deletes share one request.
  - Native launch presses use a per-app App Group file with a file lock,
    shared across the module, app and extension. Taking a press cannot
    remove a newer one written between read and removal. The existing
    newest-pending-press-wins behavior stays.
  - Warm widget and Live Activity links leave an open Run screen and any
    sheet above it in place, including setup and an unsaved finished run.
    Cold links and email-confirmation callbacks keep their existing paths.
  - Verified: all 2,690 tests; final focused suite (110 tests); shared build,
    native and test TypeScript; instruction checks; ESLint on this checkout.
    Plain `npm run lint` also scanned unrelated historical worktrees under
    `.claude/` and failed there. The equivalent checks passed with ESLint's
    `--ignore-pattern '.claude/**' --ignore-pattern 'ios/**'`; no lint
    configuration was changed.
  - Built the Debug iOS app and widget extension. XCTest on iPhone 17 Pro
    (sample data) saved a 200 g rice entry as 250 g and reopened it; a live
    simulated run survived Fuel, Train, Targets and Run links and finished;
    the real Home Screen Snap a meal quick action opened the camera fallback.
    Food editing and run links also passed in dark mode at AX5 with Increase
    Contrast. Swift checks exercised concurrent takes and cross-process
    locking. Real camera, physical controls and real GPS remain phone checks.
    No auth changes, database repair, phone installation or TestFlight upload.
  - GitHub access was confirmed through the owner's approved Mac Terminal
    window. Devin's background shell could not access the saved Keychain
    login and misleadingly reported an invalid token. No credentials were
    copied and no security settings were changed.

- 2026-11-04: review follow-ups, all on main.
  - #179, from a Codex review of #178: a saved food's barcode follows a
    retried edit whose first answer was lost, and the retry record survives a
    relaunch (on-device storage; same-device retries only); History's "beat
    last time" compares only with sessions that started earlier (a missing
    start time leaves out the whole day); quick-add holds the Log food sheet
    while it saves and keeps its retry ids across tabs.
  - On #176, from a Codex review: program delete, day removal and program
    saves wait for the workout read (`workoutLoadedForUserId`), so a launch
    from the phone's copy can't strand a live workout; a confirmed food write
    withdraws the Fuel reminder until totals read again
    (`totalsNeedRefresh`); Snap a meal logs at the press's time (`atMs`,
    used when under 60 s old). Simulator (sample data): launch, Snap a meal
    into the AI tab, logging a set, Finish, Program and Log food.
  - Left from that review: the native Snap a meal read/remove race is
    addressed in the reliability follow-up above; a reminder may
    be planned twice after travelling east
    (`fuelReminderPlan.ts`, unconfirmed, check on a phone first).
- 2026-11-04: End early (#180, the owner's ask). A movement with logged sets
  reads End early instead of Skip, and "Ended early · 2 of 3" once ended;
  Finish names the two kinds apart. Wording only: logged sets were already
  kept and counted, and `removeUnloggedSets` removes only unlogged ones.
  Simulator (sample data): one of three sets logged, then ended early. Not
  seen: the End early chip itself (the notification prompt covered the card)
  and its fit at large text sizes.

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
- 2026-11-04: the last three picks from the improvement menu (branch
  `claude/project-thread-n7auph`), checked with the web suite, lint, build,
  native `tsc`, scratch prebuilds of both app variants and review agents. On
  the Mac (2026-11-04, at 23cd2d9) the app and HyperWidgets built with no
  errors or warnings in hyPer's Swift, the three intents and quick actions
  were present, Snap a meal, Log food and Train opened cold and warm (real
  quick actions included), and the Fuel reminder scheduled, showed on the lock
  screen once and opened Log food cold and from the background (sample data,
  simulator). In sample mode a cold press shows Today for 1 to 2 s before Log
  food rises. Not yet checked (needs the phone): the reminder's Snap a meal
  button, the control in Control Center and on the Action button, Siri and
  Spotlight, the real camera, and instant launch on the real account. A
  device build needs a prebuild with pod install (new HyperLaunch pod).
  - Snap a meal from anywhere: the Snap a meal control (Control Center, lock
    screen, Action button), App Shortcuts (Snap a meal, Log food, Open Train)
    and quick actions (Snap a meal, Log food, Train). The menu's "Start
    workout" became Train, which only opens the tab (the owner chose it).
    Snap a meal during a Search result's portion read is refused (error
    haptic); closing Log food then still closes, as before. Device checks: the Xcode 26.6 build (App Intents
    metadata, phrase validation, any openAppWhenRun warning); the control
    pressed warm, cold and locked (if it doesn't open the app, use the
    OpenIntent fallback in the design); Shortcuts listing Snap a meal once;
    Spotlight and Siri; quick actions cold and warm; the intro skipped or
    hurried and press-to-camera time; the camera prompt, refused access and
    VoiceOver lines; presses over a live workout, a sheet, the run and an open
    Log food sheet in each state; a double press; the worker's Photo tab; the
    test and released apps side by side; a real Gemini photo through to Log
    meal (a real-account build, with the owner's approval).
  - Instant launch: the last program, quick starts, the week's volume, the
    target, the profile and today's food are kept on the phone
    (`hyper-launch:*` keys, included in device backups) and drawn the moment
    sign-in is restored. Sign-in restore is unchanged; the live workout is
    never kept. Device checks (Debug, `EXPO_PUBLIC_HYPER_PREVIEW=0`, local test
    account): cold-launch recordings with the intro, Reduce Motion, a very bad
    network and airplane mode; edits made on the copy before the first read;
    kill mid-workout and reopen; sign out then another account (no keys left);
    midnight, the 1st of a month and a week boundary; a schedule save on weak
    signal (the plan card stays blank until decided); preview creates no keys;
    Hermes timing under 16 ms. Accepted: a program edited from the copy before
    the program read lands can overwrite a change made on another install
    (needs a schema change to prevent); unchanged quick starts renew their
    copy only every 30 days.
  - Fuel reminder (the menu's "Bulk nudge"): You's switch and time, local only.
    A tap opens Log food, and pressing and holding it offers Snap a meal;
    the root reads taps from launch, so they follow the press rules. Device
    checks: a tap cold (intro left out or hurried), warm, and on the offline
    screen then left (nothing opens on the next visit); the permission
    prompt and the red note when notifications are off; `-hyperAction
    fuelReminder` on the lock screen; no banner with the app in front;
    logging enough before the time cancels it; a time zone and a DST change;
    sign-out and an expired session leave nothing pending; You's Time row
    motion and its 5 PM to 11 PM limit; the calorie wording needs the owner's
    goal saved as Bulk or Lean bulk.
  - Seen in passing: a Fuel entry deleted during a pull-to-refresh read
    could come back (the reliability follow-up above covers normal
    refreshes as well as the launch copy).
    The schedule editor's default day, also seen then, is fixed by #178 (the
    sheet waits for the plan's session up next).
  - Joined with #178 (bug hunt, accessibility, design review) by a merge:
    Snap a meal is refused while a Log food save runs (the tabs hold still);
    the camera's Open Settings, the Fuel reminder card and the Analyzing meal
    line follow #178's capsule, list-row and announcement patterns; Today
    shows the copy's totals for the copy's own day only (`todayCopyKey`); a
    plan from the copy leaves the session up next unknown (Schedule waits) and
    never reaches the widgets' stand-in plan; a finished day from the copy
    says "Trained today" at the record's height until History's read brings
    the record (a day decided this launch keeps #178's blank hold); the intro
    takes both the press hurry and the widget launch's markless fade. Device
    checks for #178 are listed in its own entries.
- 2026-11-04: a design review of every screen (branch
  `claude/project-thread-5xt4wh`), inside Blanc. Shared pieces first: one way
  to write a set ("80 lb × 10", bodyweight "10 reps"), a target ("4 × 8–10"),
  a length ("1 h 5 min"); one stepper, pill, logged-set row and radio row;
  disabled primaries in track grey; footnotes on the row text edge. Then each
  area: Today's finished day stays a record of the session; Progress shows
  words only where a muscle needs something; session done's tally draws itself
  in; Train's movement rows share one layout with a small tally each and the
  set figures shrink to fit; History shows the running workout as live and a
  past workout as a receipt; Log food's lists sit in cards with one food line
  and quiet add buttons; Fuel invents no target; You's figures roll. Judged
  from web captures of the real app (SF Pro, sample data, light and dark,
  side by side with main) by three rounds of fresh juries; checked with the
  web suite, lint, build and native `tsc`. Not run in a simulator or on a
  phone. Worth a hand check: the Appearance menu (now a SwiftUI Menu with its
  own label), session done's draw-in and its ticks, the set card's figure
  steps while typing, hold-to-repeat on the program editor's steppers, swipe
  and hold on Log food's rows, and the Train and Today record after a real
  workout with a schedule.
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
  waits about 25 s. The widget or lock-screen tap closing a run is addressed
  in the reliability follow-up above. The unlikely ones are listed
  in the owner's doc "Hidden state machines in hyPer".
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
  the owner: the weighed-entry editor is addressed in the reliability
  follow-up above; products edited or deleted before this fix may still
  answer scans with their old numbers (needs a one-time data repair); Recent keeps old
  numbers after a saved meal is edited; device surfaces are cleaned only when
  the tabs unmount (sign-in flow); Health sync and run state are per device,
  not per account; a pull to
  refresh still running at midnight can set the account's day back to the
  day before until the next refresh.
- 2026-11-04: accessibility pass on the native app (branch
  `claude/project-thread-r1h1a2`): VoiceOver labels, roles, states and
  announcements on every screen, layouts for the accessibility text sizes,
  44 pt touch targets, Increase Contrast palettes and live Reduce Motion, with
  nothing changed at the default settings. Checked with the web suite, lint,
  build, native `tsc` and an iOS bundle export; not run in a simulator, on a
  phone or with VoiceOver. To check on a device: every screen at AX5 and with
  VoiceOver, the run screen's live view, SwiftUI pickers' spoken names, and
  that announcements made as a sheet closes are not cut off. Magic Tap is
  wired but React Native 0.88 drops it (see the blanc-native skill).
- 2026-11-04: the bug hunt, accessibility pass and design review above were
  stacked in that order on one branch (`claude/project-thread-n0vtco`), one
  PR that supersedes the three. Where the design review rebuilt a control,
  the accessibility pass's VoiceOver, large-text and announcement work was put
  on the new one (Row, Form's MenuRow and ChoiceRow, LoggedSetRow, the shared
  Stepper inside adjustable rows, Tally's draw-in follows Reduce Motion live),
  and every bug-hunt fix was kept under the new look. Checked with the web
  suite, lint, build, native `tsc`, an iOS bundle export and a React Compiler
  audit (no function skipped that main or the design review compiles); not
  run in a simulator, on a phone or with VoiceOver.
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
  headers; quick start chips' long press;
  header ⋯ menus stay silent (iOS gives them no tap callback).
