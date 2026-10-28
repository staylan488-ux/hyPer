# Current work snapshot — native rebuild in Blanc (React Native + Expo)

Recorded 2026-10-26 (Pacific). The owner said the UI never felt right after many
redesigns, chose the Blanc direction from the
[Native Reset board](https://claude.ai/artifact/BpCMr6sj8G1i18zFP1atkk), and set
the goal as a full native app. They also ruled out copying existing designs:
the first draft's Margiela stitches and circled numbered label were replaced by
hyPer's own set tally (also the test app's icon). Plan:
[native rebuild](../plans/2026-10-26-native-blanc.md); guide:
[blanc-native skill](../../.agents/skills/blanc-native/SKILL.md).

Work is on `feat/native-blanc` (from origin/main af16add) in
`.claude/worktrees/native-blanc`. With the owner's approval, milestone 1 is
committed (37637a1), pushed, and open as draft PR #152
(https://github.com/staylan488-ux/hyPer/pull/152). No merge, release or
production step was requested.

## Milestone 9: parity check and cutover prep (2026-10-28)

Worked in `.claude/worktrees/gifted-dijkstra-fbf451` (fast-forwarded to
`origin/feat/native-blanc` 254a0d6, pushed back to `feat/native-blanc`).

Parity walk: five read-only passes against the web app (Today and Train, Fuel,
History/Progress/Program, You/sign-in/WHOOP/Health/Run, and every database
write the native app can make). Nothing put saved data at risk. Zero-weight and
zero-rep sets (Alex) are accepted, saved and shown everywhere. Every food AI
path defaults to Gemini and needs no Mac worker; a fresh install (and the
cutover, which cannot read the web view's storage) lands on Gemini.

Real-database checks: a throwaway local Supabase (OrbStack, `supabase start`
from a scratch workdir with `schema.sql` plus the additive migrations, grants
for `authenticated` and `service_role`) and a vitest harness that signs in and
calls the shared stores (kept out of the repo, in the worktree's ignored
`.tmp/`). Passed: a program saved through the shared editor with a superset,
start a day, log 0 lb × 10, 40 lb × 0 and 0 × 0 (RPE 8), correct a set,
add/remove sets, swap and switch back, a note, finish; rest length saved to
`exercise_rest_preferences` and read back on a fresh device; a long run and an
8-lap splits run saved (retry idempotent) and their laps loaded; food saved
through the native `saveFoodEntry`, including a meal deleted on another
device; a flexible session's set count kept in its quick start. Production was
read only: zero-row `select … limit=0` reads with the anon key confirmed every
column the native app writes exists (macro_targets.source/updated_at,
nutrition_profiles, foods.description, workouts' WHOOP columns,
exercises.category and the rest). No production data was read or written.

Fixed:
- Fuel: one-tap + now refreshes Fuel, Today and the widgets, cannot log the
  same row twice, and on Search logs exactly the basis it shows ("165 kcal
  per 100 g"); before, it logged a household portion it never showed.
- Gemini review: decimals can be typed (Amount eaten, Nutrition per,
  macros; also the worker Photo tab's grams) through `useDecimalText`.
- The AI tab stays mounted while hidden, so an analysis in flight and each
  food's retry-safe ids survive a tab switch; a Manual hand-off waits for a
  running analysis.
- A new entry on a past day starts Unassigned (no meal guessed from the clock);
  an edit without a saved time reads its day at noon, as on the web; the
  sheet picks up the day's meals when they land late; a meal deleted on
  another device saves the entry Unassigned instead of failing every retry.
- Fuel shows a dash, not 0, before the day loads; AI entries say "Estimate"
  or "From label"; the analysis usage line says when the UTC-day count starts
  over locally.
- Train: the screen stays awake during a live workout (Train and its sheets);
  the next workout no longer opens on the last movement chosen; Finish cannot
  be tapped twice; ± keys round to two decimals; a failed "Last time" lookup
  retries on the next set; resuming through Start reloads the day plan; a
  flexible session's set changes go into its plan (so a quick start keeps
  them), and finishing says when it replaces a quick start of the same name.
- Finish summary: no "Volume 0 lb" for a bodyweight session; the best set
  ranks load, then weight, then reps ("12 reps" when bodyweight).
- Number fields show "–" when empty: a "0" placeholder looked like a value
  but saved nothing (the past-set sheet left the set unlogged).
- History: an activity opens `train/activity-view` (type, start, duration,
  distance, pace, strain, heart rate, energy, source, notes and a run's
  splits); rows show strain; deleting an activity asks first.
- Sign-up's email link (`<scheme>://auth/callback`) now signs in through
  `native/src/app/+native-intent.tsx` instead of an unmatched route.
- Sign-out clears Fuel's day, the finish summary and the account-day state.
- Health sync carries over: the released app turns it on once for an account
  that has Apple Health weights (`native/src/lib/healthCarryOver.ts`).
- Shared: `formatSegmentDistance` moved into `src/lib/activityMetrics.ts`
  (web History uses it); `foodTrialUsageLine` takes a clock.

Cutover prepared (not done; needs the owner's approval):
- `native/app.config.js`: `HYPER_APP=release` builds the released app
  (`app.hyper.mobile`, scheme `app.hyper.mobile`, extension
  `app.hyper.mobile.HyperWidgets`, "hyPer", version 2.0.0) and
  `HYPER_BUILD_NUMBER` the build number; without it, the test app as before.
  `ITSAppUsesNonExemptEncryption` is now false in both.
- The scheme follows the bundle ID iOS reports (JavaScript through
  `modules/hyper-keychain/bundle.ts`, widgets through
  `WidgetSnapshotStore.appScheme`), so the sign-in return becomes
  `app.hyper.mobile://auth/callback` (the Capacitor app's, already allowed in
  Supabase) and WHOOP's `app.hyper.mobile://settings` reaches the app.
- Release builds default to the real account (sample data only with
  `EXPO_PUBLIC_HYPER_PREVIEW=1`).
- `scripts/ship.sh` (the ship bot's script, run from main) now ships the
  native app through `native/fastlane/Fastfile` and
  `native/scripts/check-release.sh`; the Capacitor `ios/` app is no longer
  shipped once this is on main. `build-phone.sh` builds either variant.
- Carry-over at cutover: the Keychain session (service `<bundle ID>.auth`),
  HealthKit, location, notification and Live Activity permissions, the run
  recorder's files and controls. Lost (web view storage): theme (back to
  Automatic), weight unit (back to lb), a live rest, drafts, a run in
  progress at update time, and the food analysis choice (back to Gemini).
- Apple account: automatic signing must add the App Group `group.app.hyper`
  to the `app.hyper.mobile` and `app.hyper.mobile.HyperWidgets` App IDs (the
  Capacitor app had none); no new App ID is needed.

Checked in a temporary iPhone 17 Pro simulator (sample data, scripted UI
tests): an activity opens its view (summary, notes, eight splits), a full
swipe on an activity asks before deleting, a Search row reads "165 kcal /
100 g" and turns to "Added · 165 kcal" with its tick inert, and "1.5" types
into a Gemini item's Amount eaten. The released variant (prebuilt with
`HYPER_APP=release`) built for the simulator, ran as `app.hyper.mobile`
("hyPer", 2.0.0, extension `app.hyper.mobile.HyperWidgets`, encryption flag
off), opened Fuel from `app.hyper.mobile://fuel`, and an
`app.hyper.mobile://auth/callback` link landed on Today instead of an
unmatched route. Not exercised: an App Store archive and upload (needs the
owner's approval and the Apple account change above), anything on the phone
under the released bundle ID, a real sign-up email, and WHOOP consent under
the new identity.

With the owner's standing approval for test installs, a real-account Release
build of 4db78d9 (the test app, `app.hyper.native`) is installed on the
owner's iPhone (iOS did not open it; the phone was locked). The temporary
simulator, the local Supabase, the build folders and the test harness were
removed afterwards; the iOS project is prebuilt for the test app with Release
frameworks in place (run `use-rn-core.sh Debug` before a simulator build).
The cutover steps were put to the owner for one approval in the thread on
2026-10-28; none has been taken.

Not changed on purpose (minor, recorded for later): merge of 3+ activities in
one step, the Target sets field in History, RPE below 6, Train's week strip,
"beat last time" marks, Progress's training-time detail, You's About build
number, and an account deletion row (an App Store review need, with backend
work).

Built (milestone 1, preview data only): Expo SDK 58 app in `native/` reusing
`src` through a Metro alias, with native swaps in `native/src/platform`; Blanc
theme and components; Today, live workout (log set, RPE action sheet, rest
after a successful save, Retry on failure, change movement, finish with a
full-screen tally summary), Fuel day, Log food sheet (saved foods and USDA
search) and a basic You. Native tab bar with the live-workout accessory, large
titles, form sheet, SF Symbols, haptics. The USDA food-row rule was ported from
FoodLogger with a TODO to move it into `src/lib`.

Checks: `native` type-check (including the shared code it imports); 1,847 web
tests including `tests/nativeSessionModel.test.ts`; eslint (now ignoring
`native/`); test type-check; web build. Simulator runs (iPhone 17 Pro Max, light
and dark) covered Today, Train, logging two sets, finish, Fuel, the food sheet,
adding a food and You, driven by Debug launch arguments. A signed Release build
(`app.hyper.native`, "hyPer Native", preview mode) was installed on the owner's
iPhone over Wi-Fi and launched. Touch interaction, haptics and the keyboard bar
were not exercised on a device.

Owner feedback on the phone build (same day) and fixes:
- Tab switches had no haptic (iOS's tab bar is silent). Tabs, header items, the
  live-workout bar, the RPE chip and the keyboard Done key now tap, matching the
  web app's haptic rule.
- Choosing another movement made the screen twitch: the code scrolled a
  large-title page to y = 0, which short pages cannot hold, so it snapped back.
  A scroll trace showed the old path jumping from −166 toward 0 and back to
  −116; the screen now scrolls only when the card is hidden, and the trace shows
  no movement.
- The iOS 26 tab bar stuck on Train (it stayed small on the way up, then opened
  on the way down) and never shrank on Today. UI tests with real swipes on
  iPhone 17 Pro and 17 Pro Max simulators showed a plain SwiftUI tab app does
  the same at the same page lengths: iOS needs roughly 170 points of scroll
  travel, and the workout accessory moving inline cuts travel by 57 points.
  Tab root pages now use `native/src/components/TabScroll.tsx`, which tops up
  any page that scrolls to 200 points of travel and leaves pages that fit alone.
  Repeated drags at the very bottom still open and close the bar, as in Apple's
  control. Shrinking stays on for every tab (the owner wants it there).
- From the parity inventory: food saves now use the day's meal groups ("Adds to"
  defaults to the meal that fits the time, or Unassigned), retry-safe entry ids,
  and the session user id; `crypto.randomUUID` is provided via expo-crypto.

The owner confirmed the tab bar on the phone ("Looks great now!") and approved
saving the work and starting milestone 2 with its safety work. That work is done
and, with the owner's approval, committed to the same branch and draft PR #152;
the plan's milestone 2 entry lists it:
- The native Supabase client uses the web client's `timedFetch` deadlines and
  refresh diagnostics, and runs the shared `authResume` steps on iOS app state
  (active resumes; inactive or background pauses, as the Capacitor shell did).
  Simulator check: with `EXPO_PUBLIC_SUPABASE_URL` pointing at a local server
  that never answers, `-hyperAction probeTimeout` logged status 0 with an
  AbortError after 30,041 ms; the server saw the app close the connection at
  29,971 ms.
- New native swaps in `native/src/platform`: haptics (iOS haptic engine),
  keep-awake (`expo-keep-awake`, now a direct dependency, already linked),
  rest notifications (no-op until milestone 3), `commitFocusedField` (no
  react-dom) and app visibility; `@capacitor/status-bar` is shimmed.
- `src/lib/appVisibility.ts` is new shared code: Today refresh, WHOOP foreground
  sync and the program draft autosave use it instead of `document`. Web
  behaviour is unchanged (their existing tests pass; new tests cover the
  helper).
- The native bridge now uses the app's own scheme, so the shared OAuth callback
  parser accepts `hyper-native://auth/callback` and rejects the Capacitor app's
  callback (tested).
- Sample-data mode still logs sets and starts rest in the simulator.

The owner then asked to build sign-in. Built and, with the owner's approval,
committed (7052cf6) to draft PR #152 (details in the plan's milestone 2 entry): sign-in and offline screens behind Expo
Router guards, Keychain session storage (`native/modules/hyper-keychain`, same
items as the Capacitor app), Google and Apple through iOS's sign-in sheet,
account loading after sign-in, sign-out in You, and the missing Web Crypto parts
from expo-crypto. Shared changes: `createSecureAuthStorage` (the Keychain is a
parameter; web behaviour and tests unchanged) and a Row fix so a Start button
inside a row is reachable by VoiceOver.

Verified in the simulator against a throwaway local Supabase backend (the
reference schema plus local-only table grants, which newer local stacks no
longer add): sign in, relaunch still signed in, start a session and log a set
(the set is in the database), sign out, relaunch still signed out. The Google
sheet opens and closing it shows nothing. Sample-data mode still works.
Production was not touched; the owner's phone still has the sample-data build.

Build note: Debug and Release share prebuilt React Native, Hermes and Expo
frameworks that are swapped per configuration, and `pod install` drops the
markers. Run `native/scripts/use-rn-core.sh Debug|Release` before a build whose
configuration changed (a mismatch failed to link, then crashed at launch).

After signing in on the phone, the owner found Today too empty: with no live
session it showed only Fuel. Today now has the web's training card by the same
rule, moved into shared code (`todayHero`, `nextPlannedSession`,
`weekSessionTarget` in `src/components/dashboard/todayModel.ts`, tested in
`tests/todayHero.test.ts`; the web Dashboard calls them unchanged). One card: the
planned day with Start (starts it and opens Train), a rest day or "Trained
today" with the next session, or a short prompt. "This week" always shows
sessions done of planned, plus a muscles row once something is trained. The
owner asked to avoid the web's bloat, so the blanc-native skill now has a
restraint rule. Checked in the simulator against the local backend (planned,
live, finished, rest day) and in sample mode. Committed to draft PR #152 with
the owner's approval, and a new real-account Release build with it is installed
on the owner's phone (launched and running; the owner's own schedule not yet
seen).

The owner approved setting up sign-in on the phone with the real account: add
`hyper-native://auth/callback` to the production project's (Hypertrophy-App,
`nnwfaaxmyvqsdnfcdxom`) Auth redirect allow-list, and install a Release build
that uses production. The phone build reads the web app's `.env` only inside
the build command (`EXPO_PUBLIC_HYPER_PREVIEW=0` plus URL and anon key); nothing
is written to the repo. That build (production host present in the bundle, no
local test hosts) is installed on the owner's iPhone and launched without
crashing; signing in there is the owner's step. The allow-list change was made in the Supabase dashboard
after the owner signed in to Supabase in the app's browser (`supabase config
push` would overwrite the whole production auth config, providers included, and
reading the CLI's saved token was refused by the session's safety check). After
a reload the list shows `hyper-native://auth/callback`: 32 URLs, previously 31,
the others and the Site URL unchanged. CocoaPods was installed via Homebrew for native builds.

The owner then asked for the startup animation and the old hyPer logo back:
the red P as the app's symbol and home-screen icon, upgraded rather than copied.
From the [mark board](https://claude.ai/artifact/P393qgKxM7heBwoRKZRhf1) they
chose direction C (P monogram) with a longer hold on the spelled-out word. With
the owner's approval it is committed (45636a4) to draft PR #152, and a
real-account Release build with it is installed on the owner's phone, where the
owner confirmed it works:
- The red italic P (Fraunces Mark Medium Italic, subset to five glyphs, OFL in
  `native/assets/fonts`) is the app icon (light, dark, tinted), sits in Today's
  top-left header slot, and replaces the tally on sign-in and offline. Red now
  also marks the brand P; Fraunces appears nowhere else; the tally stays for
  set progress. The launch screen is plain chalk (black in dark mode).
- Cold-launch intro (`native/src/components/BrandIntro.tsx`): once the first
  screen has mounted and frames run smoothly, the P blooms, "hyPer" unfolds out
  of it and holds about 0.9 s, the letters fold back, and the P flies to its
  resting mark as the screen rises in under a lifting veil, with a soft haptic.
  A tap skips ahead; Reduce Motion and scripted dev launches leave it out.
  Geometry comes from the font metrics (`native/src/lib/brandGeometry.ts`,
  tested in `tests/nativeBrandMark.test.ts`); the landing spot is read from
  UIKit by a new local module, `native/modules/hyper-view`.
- React Native's new renderer drops the italic when a font is named by its face
  name and picks the family's upright face; the mark names family, weight and
  style instead.

Verified in the iPhone 17 Pro simulator (Debug, sample data and a signed-out
run) from screen recordings checked frame by frame: light and dark, Today and
sign-in landings, the hand-over to the resting P within half a point (softened
by a 180 ms fade), tap-to-skip, Reduce Motion, the new home-screen icon. Checks:
1,873 tests, lint with instruction checks, test type-check, web build, native
type-check. Not verified: the offline screen (needs a saved session without a
network), and the dark and tinted icons on a home screen (the simulator shows
light icons).

Milestone 3 started with the owner's pick, the in-workout essentials. A
movement sheet (⋯ on the current card, a finished
movement's row, or a long press on any row) corrects a logged set, adds or
removes sets within the program's range, keeps a movement note (saved after a
pause, on close and in the background) and swaps a movement for this workout or
switches it back. Session order, swaps and set ranges come from the new shared
`src/lib/sessionPlan.ts`, which the web Train page now also uses (same
behaviour); later sets start from the set just logged, as on the web. Checked
with UI-test taps in sample mode and against a throwaway local Supabase
backend, where the database held each change in the web's format (corrected
set, set count, `workouts.notes` JSON, the swap in `workout_day_plans` with
`substitutes_for`) and a relaunch restored the note and the swap before
switching back. Dark mode checked.

The owner then asked for three changes:
- Sets can be added or removed whatever the program says (1 to 12; only
  unfinished sets are removed). The web still keeps to the program's range.
- Rest length editing is back: a rest sheet with 1, 2, 3 and 5 minutes or a
  custom time, kept per movement through the shared `restPreferences` (synced
  to `exercise_rest_preferences`, as on the web); a logged set now rests at its
  movement's length instead of a fixed 2 minutes.
- A timer button in Train's header (beside Finish) opens that sheet to start a
  rest without logging a set, add 30 seconds or end it.
UI-test taps in sample mode covered these (a chosen 3:00 survived a relaunch);
the rest-length sync was not checked against a database.

With the owner's approval, the Train work is committed (3c952f7) to draft PR
#152, and a real-account Release build with it is installed on the owner's
phone (production host in the bundle, no local test hosts or test-account
values; launched and still running after the intro). Not yet tried there.
Still to build for milestone 3: start or schedule a session, flexible mode,
supersets, reorder, and add or remove movements.

The owner then asked for rest on a locked phone: the "Rest over" alert, pause,
and the lock-screen countdown. With the owner's approval it is committed
(2735031) to draft PR #152, and a real-account Release build with it is
installed on the owner's phone (production host in the bundle, no local test
hosts or test-account values; the widget signs as `app.hyper.native.widgets`
under the team's wildcard profile, and the app has no push entitlement). The
launch after install was refused because the phone was locked, so the build
has not been opened yet. What it does:
- The rest is now the web's stored rest session (`src/lib/restTimer.ts`, plus
  a new `extendRestTimerSession` for +30 s): it runs, pauses and resumes, and
  survives leaving Train and a force quit. The rest sheet has +30 s, Pause or
  Resume, and End rest; the workout bar shows a paused rest.
- "Rest over" uses expo-notifications through the native swap of
  `src/lib/restNotifications.ts`, with the web's words and single slot. It is
  local only (`enableRemoteNotifications: false`, so no push entitlement) and
  asks for permission on the first rest. In the app it plays the sound with no
  banner, alongside the haptic.
- The workout Live Activity is a SwiftUI widget extension (HyperWidgets,
  `app.hyper.native.widgets`) added on prebuild by
  `native/plugins/withHyperWidgets.js` from `native/targets/widgets`, driven by
  a local ActivityKit module, `native/modules/hyper-activity`. As on the web,
  the card shows the movement that's up, the shared detail line, the session
  clock and a rest countdown with a draining bar; a paused rest shows its time
  left still. It uses Blanc's tokens and the red P (font bundled in the
  extension). The ordering rules moved from `src/lib/liveActivity.ts` into
  `src/lib/workoutActivitySync.ts`, which the web file now wraps (same
  behaviour, its tests pass); `restTimerWorkoutGuard` gained an optional
  callback so native drops its copy of a cleared rest.
Checked with UI tests in the iPhone 17 Pro simulator (sample data, light and
dark): the notification prompt, pause and resume, the Dynamic Island (P and
countdown, paused), the lock-screen card (running and paused), "Rest over"
delivered while locked, the card counting down on its own while locked, a
rest surviving a force quit, and finishing the workout removing the card. The
earlier rest and set-count test still passes. Checks: 1,894 tests, lint with
instruction checks, web build, native type-check. Not verified: anything on a
phone (sound, haptic, the card's look on a real lock screen), and the card's
"rest over" state after a rest ends with the app away (iOS redraws a stale
card on its own schedule; the simulator's always-on display draws lock-screen
frames ahead of time, so its captures run ahead of the real clock). iOS asks
"Allow Live Activities?" the first time the card reaches the lock screen.
Building this needs a regenerated iOS project (`expo prebuild --clean`); a
phone build also registers the extension's App ID through automatic signing.

The owner confirmed the locked-phone rest build works on the phone. The rest
of milestone 3 followed (2026-10-27), matching the web's Train rules:
- Before a session, Train shows today's card from the schedule (the same
  `PlanCard` as Today: planned day with Start, rest day or trained today with
  the next session, or "Set your schedule"), the program's week, and every
  other day with Start plus the web's note on how that shifts the plan.
- A header menu (⋯) holds Schedule and "Train by": program days or flexible
  sessions (`setWorkoutMode`; the web keeps this on Program, which native
  builds in milestone 6). The schedule sheet has the web editor's choices
  (Day 1 today, tomorrow or a picked date; set weekdays from a first day, or
  in order from a chosen day) and saves through the new shared
  `buildPlanSchedule`, which the web Train page now also uses. The shared
  `usePlanSchedule` takes an optional revision so native screens re-read a
  schedule saved on the device (web unchanged).
- Flexible mode: name the session or pick one of up to six quick starts, then
  Add movement (the exercise picker now serves swap, add and superset), pair
  a superset or remove a movement from its movement sheet, rename from the
  header pencil, and on Finish choose "Finish and save as quick start".
  Adding and removing movements stays flexible-only, as on the web.
- Supersets (program or flexible) alternate A1, B1, A2 and rest only after B,
  with the reason shown when a set is out of turn. The rules moved out of
  the web page into `supersetFlows` and `supersetLogBlock` in
  `src/lib/sessionPlan.ts`; both apps use them.
- Reorder: a sheet from "Reorder" on the Movements section, built on SwiftUI's
  List in edit mode (Expo UI), so the handles and drag are Apple's. Pairs move
  as one row; each drop saves the session order at once
  (`reorderWorkoutExercises`, program untouched) and a failed save puts the
  previous order back with a note.
Work moved to this session's own worktree
(`.claude/worktrees/pensive-gagarin-e7e1ec`, branch
`claude/pensive-gagarin-e7e1ec` tracking `origin/feat/native-blanc`) because
the session may not write into `.claude/worktrees/native-blanc`; it was pushed
to `feat/native-blanc`, so that worktree's local branch is now behind origin.
Checked with UI-test taps in the iPhone 17 Pro simulator (sample data): the
start screen, the menu, the schedule sheet (both rhythms, a picked date,
saved and re-read); a flexible session from empty through Add movement (two),
a superset (A1 logged moved to B1 with no rest, B1 started rest), reorder by
dragging a handle (the curl moved to the top and stayed), remove with its
confirm, rename, and "Finish and save as quick start" with the quick start
offered afterwards. Dark mode checked for the live workout, reorder, start
screen and schedule. Fixed during the check: typing the session name quickly
could put the cursor back mid-word (the field now keeps its own text), and
the workout bar says "No movements yet" for an empty session. Checks: 1,904
tests (new ones for superset rounds, the flexible model and the schedule
builder), lint with instruction checks, web build, native type-check. Not
verified: a reorder save that fails (the sample backend never fails; the
sheet clears its pending order on failure, so the saved order shows again),
anything on a phone, and against a real database (flexible writes, quick
starts, schedule sync). Metro once served stale copies of two edited files;
`npx expo start --clear` fixed it.
With the owner's approval, a real-account Release build of this commit is
installed on the owner's iPhone (production host in the bundle, no local test
backend). iOS refused to open it after install, most likely because the phone
was locked, so it has not been opened yet.
The owner then saw the flexible name field's hint ("Upper, push, arms…")
drawn with its letters squeezed together on the phone (dark mode). The
simulator showed the same; iOS's own placeholder in that field misdrew, and
a version without a line height drew nothing at all, while the picker's
search placeholder is fine. The hint is now plain text behind the empty
field (also a VoiceOver hint), checked in light and dark. This Mac has no
watchman, so Metro can miss edits made by scripts: restart it with
`npx expo start --clear` before trusting a simulator check.
A real-account Release build with this fix is installed on the owner's phone
and opened there.

Milestone 4, Fuel, followed with the owner's go-ahead (2026-10-27). Built on
`feat/native-blanc` in this session's own worktree (another session's hook
blocks editing `.claude/worktrees/native-blanc` from here):
- Shared rules first. The web logger's food-row choice moved out of
  components into `src/lib`: `ensureFoodRow` (foodPersistence, the USDA
  basis rule that native/src/lib/fuel.ts had copied; that TODO is closed),
  `buildEntryPayload` and `chosenFoodLogSource` (saveNutritionEntry),
  `lookupBarcode` (new barcodeLookup), `resolveManualFood` (new manualFood),
  `loadSavedMeals`, `replaceSavedMeal`, suggestions and matching (savedMeals),
  photo grounding, totals and the combined or per-item save (new photoReview),
  day changes for groups and entries (new nutritionDay), the calendar, ledger
  labels, day summary and units (new nutritionCalendar, nutritionLedger,
  fuelSummary, foodUnits). FoodLogger, MealLogger, BarcodeScanner,
  NutritionGroupLedger and the Fuel page call them, with the same behaviour;
  `tests/fuelShared.test.ts` covers them.
- Fuel tab: Sunday-first week strip (swipe for another week; future days off),
  eaten kcal of target with the web's left/over line on today, macros, meal
  sections (Unassigned first; empty Breakfast/Lunch/Dinner hidden, a hand-made
  meal or snack stays), a calendar sheet with dots (`fuel-month`), Add meal or
  snack. Entries: tap to edit; swipe for More and Delete (no confirm, as on the
  web); hold for Edit, Move to…, Move to yesterday (before 05:00 only) and
  Delete. A meal's ⋯ logs food into it, moves it up or down, or deletes a
  hand-made one. The Fuel store now loads a month (`useFuelStore.select`), and
  Today reads `todayTotals`.
- Log food sheet (`native/src/app/log-food.tsx`, parts in `native/src/fuel`):
  Saved (filter, review, one-tap +, Edit to change or delete, New), Search
  (USDA as you type, Retry), Scan (VisionKit through the new local module
  `native/modules/hyper-barcode`, a port of the Capacitor plugin; digits too;
  a miss creates a saved product bound to the code), Manual (Describe with AI
  through the photo worker, saved-meal suggestions, servings stepper, Save as
  reusable or Update saved meal), Photo (top and 45° photos from camera or
  library, re-encoded to the worker's JPEG budget, item review with USDA
  sources, Log as one meal). A chosen food gets the review (amount and unit,
  When, "This entry"). When = iOS date and time pickers plus Add to; another
  day logs Unassigned. Build a meal keeps the web draft key and rules
  (resume, destination check, retry save, discard). Closing mid-analysis or
  with an unseen estimate asks first.
- Camera permission (`expo-image-picker` config, the Capacitor app's wording);
  `build-phone.sh` now also passes the web `.env` photo worker URL.
Not ported: drag to move entries or groups (menus instead) and the "Entry
saved" toast (a success haptic instead).
The owner then said they log food only with Gemini, never the private photo
worker (Alex's). The native app now defaults to Gemini (`VITE_FOOD_ANALYSIS_MODE`
falls back to `gemini` in `native/babel/vite-env.js`; a stored device choice
still wins): the AI tab (`native/src/fuel/AiTab.tsx`, the web FoodTrialLogger:
text and up to two photos, one follow-up question, item review, sources,
Save as reusable), Manual's "Review with Gemini" hand-off, and "Describe
amount" on the food review. The item-to-food rules moved to `src/lib/foodTrial`
(`trialItemFood`, `trialLogSource`, `trialIngredientFood`). Metro watches
`supabase/functions/analyze-food-trial`; native setup adds
`AbortSignal.timeout` and `structuredClone` when Hermes lacks them.
The owner also set the interaction standard ("This should work, and it does"):
saved meals now swipe for Edit and Delete (a full swipe deletes, no confirm;
the row folds away and returns if it fails) and hold for a menu; entries,
meal ingredients and AI items use the same `SwipeRow`. An app-wide
interaction audit is deferred until parity.
A real-account Release build of 434ccca is installed on the owner's phone
(the first install attempt failed with an iOS install error and a retry
worked); iOS refused to open it, most likely because the phone was locked.
Checked in a new "hyPer Fuel" simulator (iPhone 17 Pro, sample data, light and
dark) with a scripted UI test: swipe actions, More and Move to, delete,
saved review and log, one-tap add, Scan by digits (VisionKit is unavailable in
the simulator), photo analyze and Log 1 meal, Describe with AI then log,
build a meal and log it, editing an entry, month sheet, adding a snack, USDA
search. Checks: 1,929 tests, lint with instruction checks and test
type-check, web build, native type-check. Not verified: the camera scanner
and photo capture on a phone, and writes against a real database (only the
sample backend ran). The iOS project needs `expo prebuild --clean` for the
new module and permission; pod install needs `LANG=en_US.UTF-8`.
With the owner's approval, a real-account Release build of this commit is
installed on the owner's iPhone and opened there. The Mac's disk filled during
that build (1.9 GB free); with the owner's go-ahead only rebuildable output
was deleted (Xcode DerivedData for hyPerNative, an old session's scratch
builds, the test simulator), leaving about 18 GB. Builds and simulators from
the native work had used roughly 55 GB; keep one simulator and delete scratch
build folders when a session ends.

Milestone 5, History and Progress, followed with the owner's go-ahead
(2026-10-27), in this session's own worktree
(`.claude/worktrees/objective-banach-56ee89`, pushed to `feat/native-blanc`):
- Shared rules first: `src/lib/historyMonth.ts` (month load with day names,
  Sunday-first grid, movement order with superset partners and plan notes,
  neighbour moves, the past-set update rule, day summary),
  `buildActivityInput` and `guardActivityEdit` in `activitySessions`,
  `src/lib/volumeCoaching.ts` (coaching call and order),
  `src/lib/trainingHours.ts` and `averageLoggedDays`. The web History,
  Coaching and WeeklyNutrition use them unchanged in behaviour; covered by
  `tests/historyMonth.test.ts` and `tests/progressShared.test.ts`.
- History (Train header, clock button, before a session): a month calendar
  in a native paging scroll view (swipe or arrows; a turned page selects its
  first day or today), Today and WHOOP Sync header buttons, and the day's
  workouts and activities. Workouts: tap to open, swipe to delete (asks
  first), hold for Open/Delete. Activities: tap to edit, swipe for Merge and
  Delete, hold for Edit, Merge with… and Delete; WHOOP-known activities are
  hidden rather than deleted, as on the web. Add activity sheet
  (`native/src/app/activity.tsx`).
- A past workout (`native/src/app/(tabs)/train/past.tsx`): every movement's
  sets (tap to correct in `past-set`, swipe to delete, hold for a menu), Add
  set, a ⋯ menu per movement (Add set, note via iOS's text prompt, Move up or
  down, Superset with… or Unlink, Remove movement), Add movement (the shared
  picker now also serves past workouts), WHOOP stats attach and remove, and
  Delete workout (header menu or the red row; asks first, then returns).
  Every edit runs the web's protocol (`runWorkoutEdit`: edit, reload,
  completion only after a clean save), one at a time per workout
  (`native/src/lib/history.ts`). Deliberate difference from the web: after a
  past-workout edit or delete, this week's volume is recalculated.
- Progress (Today's "This week" → Progress): the flat front and back muscle
  figure from the web's maquette shapes (react-native-svg, new native
  dependency), tap a muscle to open its row; muscles by coaching priority
  with a landmark rail and, opened, the landmarks in plain words and the
  recommendation; training time over eight weeks; calories and protein over
  the last seven days against target.
Checked in the iPhone 17 Pro simulator (sample data) with a scripted UI test
using real touches: calendar paging both ways and the arrows, opening a
workout, correcting a set (the figure selects on tap), swipe-delete with
renumbering, Add set, Move down, Add movement from the picker, a note, Delete
workout with its confirm, adding an activity, the long-press menus, the
header menu, Progress, and dark mode for Progress and a past workout. Found
and fixed: the set sheet's auto-focused weight appended typed digits instead
of replacing them; a sideways swipe on the calendar triggered iOS 26's
swipe-back (now a paging scroll view, which iOS lets win); the old day stayed
selected after a month turn. Checks: 1,945 tests, lint with instruction
checks and test type-check, web build, native type-check. Not verified:
writes against a real database (only the sample backend ran), WHOOP sync and
attach with a real connection, and anything on a phone until the build
below. Building needs `expo prebuild --clean` for react-native-svg.

The owner confirmed milestone 5 on the phone and asked to keep going.
Milestone 6, Program, followed (2026-10-27), in this session's own worktree
(`.claude/worktrees/great-varahamihira-1cfca3`, pushed to `feat/native-blanc`;
a hook blocks writing into other worktrees, and its native folders were
cloned copy-on-write from objective-banach):
- Shared rules first: `src/lib/programSummary.ts` (counts, which program
  shows as active, set and rep labels, quick-start labels, rename with the
  overwrite question), `src/lib/programQuestions.ts` (the five guided
  questions, blank day choices, the guided draft with its "left out"
  notice), `shouldPromptPlanStart` and `dismissPlanStartPrompt` in
  `planSchedule`, and `dayLabel`, `daySummary`, `blockStartIndexes`,
  `pickerTargetFor` in `splitDraft` (`exerciseBlocks` is now generic).
  `discardSplitEdit` takes the confirm to use (the web sheet by default).
  The web Program page, chooser, editor sheet and day card use them,
  unchanged in behaviour; `tests/programShared.test.ts` covers them.
- Program (`train/program`, from Train's ⋯ menu, which now holds Schedule
  and Program; "Train by" moved here as a segmented control, locked during
  a workout). Programs: tap to view (`train/program-view`: days and
  exercises, Edit, Set active or Make active, Delete), swipe for Edit and
  Delete, hold for Set active, Edit, Delete. Delete asks first, as on the
  web, and refuses the program of a workout in progress (deliberate change:
  the web allows it and the workout then drops off Train). Quick starts in
  flexible mode: Start, tap or hold for the list and Start, Rename (iOS text
  prompt; a clashing name asks to replace) and Delete; swipe for Rename and
  Delete (a full swipe deletes with no question; the row folds away and
  returns if it fails). Today's and Train's "No program yet" card now
  offers Create.
- The editor (`native/src/app/program-edit`, a page sheet with its own
  stack) runs the shared `splitEditStore`, device draft autosave and save
  protocol: the chooser (resume an unsaved program, five questions with a
  live plan name, or blank days), name and description, days (tap to open,
  swipe to remove with Undo, hold for rename, move or remove, Reorder with
  iOS's list handles), a day's exercises (tap for the sets and reps sheet
  with steppers and a set range, swipe to swap or remove with Undo, hold for
  everything incl. superset and move), the restore offer for unsaved edits,
  and Cancel or swipe-down asking before unsaved edits go. The picker
  (`swap.tsx`, now built on `native/src/components/ExercisePicker.tsx`)
  adds several exercises at once and creates a custom exercise from the
  search text (it joins the library on save). After create or Set active,
  the web's plan-start question offers the schedule.
- Fixed for every swipe list: a full swipe never ran its destructive action
  (the row sprang back past the threshold and disarmed itself before
  settling); `SwipeRow` now decides at release.
Checked in the iPhone 17 Pro simulator (sample data) with scripted UI tests
using real taps, drags and swipes: list, view, swipe and full swipe, delete
with its question and the in-progress guard, edit (sets stepper, range,
swap, multi-add, remove and Undo, day drag), save through the snapshot
(view shows the change), guided and blank create with the plan-start
question and Set now, the unsaved-program offer after a relaunch, Cancel
and swipe-down discard questions, Make active, flexible mode with a saved,
renamed quick start; dark mode for list, editor, picker and sets sheet.
Found and fixed on the way: the picker sheet drew blank (its root was not
a scroll view; Add moved to the header), long names were clipped, and Sets
+ made a range when there was none. Checks: 1,959 tests, lint with
instruction checks and test type-check, web build, native type-check, and
the web Program page in the browser (sandbox). Not verified: saves against
a real database (only the sample backend), custom exercise insert on save,
and the first-run card (sample data always has a program).
With the owner's approval, a real-account Release build of 721b963 is
installed on the owner's iPhone over Wi-Fi (production host in the bundle,
no local test backend); iOS refused to open it because the phone was
locked. Build output was deleted afterwards (simulator DerivedData, the
phone build folder); the Release React Native frameworks are in place, so
run `use-rn-core.sh Debug` before the next simulator build.

The owner confirmed milestone 6 on the phone. Milestone 7, You, followed
(2026-10-27), in this session's own worktree
(`.claude/worktrees/trusting-euler-be9eef`, pushed to `feat/native-blanc`):
- Shared rules first, used by the web You page too: target defaults, hand
  edits, drift, daily-burn wording, resume and sign-out wording in
  `settingsUx`; weigh-in wording, parsing and unit switch in the new
  `bodyWeightSummary`; the calculator's draft rules in the new
  `nutritionWizard` (the web wizard now runs on them); WHOOP wording and the
  consent return in the new `whoopStatus`; `connectOrSyncHealthWeights`,
  `healthSyncMessage` and `deleteManualBodyWeight` in `healthWeights`;
  `foodTrialUsageLine` in `foodTrialUsage`. `useNativeHealthSync` uses
  `appVisibility`, and Health checks `hasNativeHealth()` instead of the
  Capacitor test. Covered by `tests/youShared.test.ts`.
- Deliberate changes: the calculator prefills weight to one decimal (it used
  to round to whole numbers, so saving it recorded a made-up weigh-in, on the
  web too); typed weigh-ins can be deleted (swipe), Health ones cannot (a
  later sync would bring them back); Suggest targets shows only when
  Food analysis is Your Mac and a worker is set (the coach has no Gemini
  path yet; the owner asked on 2026-10-27 why it ignores Gemini, and a
  hosted coach needs a production function deploy); You has no search; Appearance reads Automatic, Light, Dark.
- You (see the blanc-native skill for the routes): name and account, body
  weight with Log, targets, saved meals (a built meal opens the meal builder
  through `log-food?savedMeal=`), food analysis and the Mac worker,
  connections, appearance menu, adaptive scheduling switch, about. The tab
  layout now runs WHOOP foreground sync and Apple Health weight sync, as the
  web shell does.
- Apple Health: `native/modules/hyper-health` (HealthKit read of body mass,
  observer, background delivery), entitlements and the usage text in
  `app.json`. Needs `expo prebuild --clean`; the phone build registers
  HealthKit for `app.hyper.native` through automatic signing.
- Fuel's Scan tab no longer opens the camera on arrival (the owner's
  request); Scan barcode does.
Checked in a temporary iPhone 17 Pro simulator (sample data) with scripted
UI tests: You, Body weight (chart tap readout, full-swipe and button delete
of weigh-ins, Log weight with the unit switch), targets edit with the drift
note and the discard question, the calculator through to saved targets, the
coach's sample suggestion into the edit sheet, saved meals (edit numbers,
full-swipe delete, a built meal edited and saved from You), food analysis,
Mac worker, WHOOP connect (sample), Apple Health permission sheet and sync,
appearance Dark persisting across a relaunch and back to Automatic, account
name, about; dark mode for the new screens. Checks: 1,977 tests, lint with
instruction checks and test type-check, web build, native type-check. Not
verified: anything against a real database, WHOOP's real consent screen and
return, Apple Health with real samples (the simulator had none), the Scan
button on a phone, and the web You page in a browser.
With the owner's approval, a real-account Release build of d0a233b is
installed on the owner's iPhone over Wi-Fi (production host in the bundle,
no local test backend; HealthKit entitlements signed for `app.hyper.native`);
iOS refused to open it because the phone was locked. The phone build folder,
this session's simulator DerivedData and the temporary simulator were
deleted afterwards; the Release React Native frameworks are in place, so run
`use-rn-core.sh Debug` before the next simulator build.

After trying it on the phone (2026-10-27), the owner asked for three fixes,
all on `feat/native-blanc`:
- Suggest targets follows the Food analysis choice. With the owner's
  approval, `analyze-food-trial` gained a `suggest-targets` action (Gemini,
  the Mac worker coach's reasoning rules, the same daily limit and replay)
  and was deployed to Hypertrophy-App. The deploy used the live copy of
  `model.ts`, which is older than main's (main's parallel Tavily searches
  are still undeployed); a later full deploy of the function ships them.
  Checked live only to the sign-in gate (401 without a session).
- Calculate targets: gain rates raised at the owner's request (lean bulk
  0.15–0.35% a week, starting 0.25; bulk 0.35–0.75%, starting 0.5), rates
  shown per week with lb a month, and a choice between the learned burn and
  the formula when a learned one exists. Formula targets are saved as set by
  hand, or the weekly adaptive update would pull them back to the learned
  burn. The owner's case (130 lb, 5'9", 12% body fat, bulk) gave 2,160 kcal
  from a learned burn near 2,060 and a +100 kcal bulk. A saved rate outside
  the new ranges is moved to the nearest edge the next time targets adapt.
- "Discard these changes?" asked again after Discard and never closed: the
  guard stopped its own re-sent close. Every You sheet now uses
  `useLeaveGuard` in `native/src/lib/leaveGuard.ts`, which steps aside
  before closing.
Checked in a temporary simulator (sample data with adaptive on): the bulk
rate and its weekly and monthly wording, the burn choice, and Discard closing
both the calculator and the edit sheet. A real-account Release build of
ff86dc6 is installed and opened on the owner's iPhone; the build folder, the
simulator and its DerivedData were deleted afterwards.

The owner then found the targets still low (about 2,300 kcal for a 0.5%
bulk) and asked to redo the calculation from the evidence. Rebuilt in
`src/lib/nutritionCalculator.ts` (shared with the web app):
- Resting rate: Cunningham (500 + 22 x fat-free mass) when body fat is
  known, which tracks lean, trained people best against calorimetry
  (Tinsley et al. 2019; Katch-McArdle read about 150 kcal low); Mifflin-St
  Jeor otherwise.
- Activity levels inside the doubly-labelled-water ranges (FAO/WHO/UNU
  2004): 1.4, 1.55, 1.7, 1.85, 2.0, up from 1.25 to 1.8.
- About 7,700 kcal per kg for gains as well as losses (overfeeding studies
  measure about 8,000 kcal per kg gained, Forbes et al. 1986); it was 6,000.
  The adaptive estimator uses the same figure.
- Unchanged: the 10–20% surplus ceiling (Iraki et al. 2019), protein 2.0 g
  per kg of lean mass (2.4 when cutting), fat about 25%.
- The calculator shows the target as burn plus change ("2,791 burn + 334 to
  gain") and says when the learned burn sits more than 15% under the
  formula (usually unlogged food).
For the owner (130 lb, 5'9", 12% body fat, 0.5% a week): 3,125 kcal
moderately active, 2,860 lightly active, 2,385 on their learned burn of
about 2,060. Golden tests in `tests/nutritionCalculator.test.ts` were
recomputed by hand. Raising activity levels also raises cut and maintenance
targets for everyone on the next calculation, and the adaptive estimator's
"predicted" burn rises with them.
- Train: tapping the workout bar during a rest now opens the rest panel
  (the owner's request); otherwise it still returns to the workout.
- Train: each movement shows last time's note (the newest earlier workout
  with one, from the shared `fetchPreviousMovementNotes`) under the set
  card's "Last time" line and in the movement sheet's Note section. The web
  app has no such view; the sample data now carries two movement notes.
Checked in a temporary simulator: the calculator with the owner's numbers
(3,125 kcal, "2,791 burn + 334 to gain"), the rest bar opening the rest
panel, and last time's note on the card and in the sheet.
A real-account Release build of 3e809d1 is installed on the owner's iPhone
(iOS did not open it, likely a locked phone); the build folder, simulator
and DerivedData were deleted.

2026-10-28: saving targets from Suggest targets always failed ("Could not
save daily targets"). The coach sheet staged the whole suggestion, so its
rationale, cautions and confidence went into the `macro_targets` upsert, and
PostgREST refused the unknown columns (PGRST204). Fixed twice over: the sheet
stages only the four numbers, and `updateMacroTarget` in the shared store
sends only the table's columns (`macroTargetColumns` in `settingsUx`). The
sample backend accepts any field, so the simulator check had missed it.
Reproduced and confirmed against a throwaway local Supabase with
`supabase/schema.sql`: the old payload failed with PGRST204 and the new one
saved; production was not written to.
A real-account Release build of 5d75e87 (with milestone 8's Run and widgets)
is installed and opened on the owner's iPhone; the build folder was deleted.
A save from the phone is the owner's to try.

Milestone 8, Run tracker and widgets, followed (2026-10-27, the owner asked
to keep going while away from home), in this session's own worktree
(`.claude/worktrees/elegant-joliot-6c1457`, pushed to `feat/native-blanc`):
- Shared rules first: the run page's words and choices moved into
  `src/lib/runDisplay.ts` (mode names, auto-split choices and checks, pace
  and distance wording, the live status, the finished run's splits, the
  diagnostics export, the save error); the web page uses it unchanged in
  behaviour. `useRunTracker` asks the bridge's new `hasNativeRun()` instead
  of the Capacitor test and hears the app return through `appVisibility`
  instead of `document`. Covered by `tests/runDisplay.test.ts`.
- `native/modules/hyper-run`: the Capacitor recorder ported call for call
  (permission with temporary full accuracy, then Motion; the JSONL trace and
  UserDefaults controls under the same keys; background location; never
  restarting on its own; the run Live Activity at most every 3 s; the
  diagnostics share sheet from the topmost screen) plus native lap and
  sprint tones (`RunCuePlayer`) that mix over music with the screen locked.
  New app settings: location and motion usage text, background modes
  `location` and `audio`, App Group `group.app.hyper`.
- Run (`native/src/app/run.tsx`; Train ⋯ menu, You's Start a run, or the
  run card): set up, live, finished, save to History, discard (asks first),
  export diagnostics. A refused location shows Open Settings on the set-up
  screen. The screen draws its own top bar: toggling a modal's iOS header
  rebuilds the screen and would drop the run.
- The run card (`targets/widgets/RunLiveActivity.swift`): distance, pace
  line and clock, Split / Rest or Resume / Finish (a second tap within 8 s
  finishes), opening the run on tap; a card the app stopped updating says
  so. `RunControlIntent` is compiled into the app as well, since iOS runs a
  Live Activity button in the app's process.
- Widgets (`targets/widgets/HomeWidgets.swift`): Fuel (small, medium, and
  the lock screen's circular, rectangular and inline) and Training (small,
  medium with the next three days, lock-screen rectangular and inline). The
  app writes a snapshot to the App Group (`native/src/lib/widgets.ts`,
  rules in `widgetPlan.ts` with `tests/nativeWidgetPlan.test.ts`); signing
  out clears it; at midnight the widgets move to the next day on their own.
Checked in a temporary iPhone 17 Pro simulator (sample data) with scripted UI
tests: a simulated long run (rest, resume, hold to finish, save into
History), a simulated 8 × 400 splits run (auto and manual splits, the splits
table, the share sheet), and the real recorder on a `simctl location` route:
recording on with the screen locked (distance kept growing), the Dynamic
Island and lock-screen card, Rest from the lock screen reaching the app, Finish
twice from the lock screen ending the run, and a killed app resuming the run.
Fuel and Training widgets added through the home screen's widget gallery,
showing the app's numbers and the saved schedule's days, light and dark;
tapping Fuel opened Fuel. Checks: 2,000 tests, lint with instruction checks
and test type-check, web build, native type-check.
Not verified: anything on a phone (GPS accuracy, the cues' sound, haptics,
the card on a real lock screen), the lock-screen widget sizes (built, not
placed), saving a run against a real database, and the web run page in a
browser.
With the owner's standing approval for installs, a real-account Release build
of 0e35d2a is installed and opened on the owner's iPhone (production host in
the bundle; the App Group signed for the app and the widget extension through
automatic signing). iOS asks for location, Motion and Live Activities the
first time they are used. The temporary simulator, its build folder and the
phone build folder were deleted; the Release React Native frameworks are in
place, so run `use-rn-core.sh Debug` before the next simulator build.

# Previous work snapshot — a single set stuck on every retry

Recorded 2026-10-25 (Pacific). The owner supplied screenshots of an unsaveable
Lat Pulldown set and reported that deleting/re-adding it worked. They requested
root-cause investigation and implementation. Work starts from freshly fetched
`origin/main` at `002d9f8` (merged #150), in the isolated local checkout
`/Users/sinan/orca/hyPer/.tmp/stuck-set-save-20261025`, branch
`codex/stuck-set-save` (moved there after validation from an isolated `/private/tmp` clone).
The saved `/Users/sinan/orca/hyPer` checkout remains on its older `main`; its
unrelated untracked files are preserved. After validation, the owner authorized
opening a pull request and merging it. The owner will handle the iOS TestFlight
release; production-data writes and backend deployment remain outside this task.

**Reproduced cause:** `addWorkoutSet` allocated the next `set_number` from the
local snapshot without guarding overlapping taps. Two requests could create
distinct rows with the same number; the schema has no uniqueness rule for this
metadata. The workout renders ledger positions as `idx + 1`, but both the row
preflight and `logSet` looked up the first `(exercise_id, set_number)` match.
The later duplicate then failed every Retry locally, before any PATCH. Replacing
it allocated a fresh number and removed the ambiguity. The screenshot's visible
"Set 4" paired with "Next … set 3" is consistent with this exact mismatch.
The owner's actual database rows/device logs were not inspected, so this remains
a reproduced defect that fits the incident, not proof of the phone's cause.

- `WorkoutSetRow` and `logSet` now address the immutable set ID throughout.
  Already duplicated rows can save without being deleted or renumbered. Deleted
  or replaced rows remain guarded, and automatic retries still use the same
  PATCH payload and completion timestamp.
- Live and History Add set actions share one in-flight addition per account
  generation/workout/exercise. Overlapping taps join it; a later deliberate tap
  allocates the next number. A failure releases the guard. Other movements,
  workouts, and later sign-ins proceed independently.
- History set-count edits now merge confirmed inserted and deleted IDs into
  the active workout. Previously they could retain deleted IDs or omit new ones
  until a successful reload. Only server-confirmed deletions are removed, so a
  set logged while a shrink is pending survives.
- Removing a single set or exercise now updates active rows immediately after
  a successful delete, including already-absent requested rows. Later compaction or plan failures still report errors,
  but cannot leave those deleted IDs saveable. Renumbering merges only server
  snapshots/confirmed updates and preserves newer set values and additions.
- Local stale-row failures and rejected server writes enter the existing
  capped `hyper:auth-diagnostics` trail. Only fixed outcome labels, HTTP status
  and validated PostgREST/SQLSTATE codes are added; no row IDs, entered values,
  server messages, credentials, or account data.

Four initial ID regression cases failed before the fix: inline/capsule save
with duplicate numbers, renumbering during an asynchronous guard, and selecting
the correct duplicate through the real SDK. The Add regression showed two POSTs
both allocating number 2; four History lifecycle cases and six partial-delete
cases also failed before their fixes. Two additional empty-delete regressions
failed before the repeated-delete correction. Coverage protects failed retries, edits, concurrent saves,
account/workout changes, saved sets during deletes, and diagnostic redaction.

Validation passed: all **1,839 tests across 151 files** (33 new regressions),
`npm run lint` including instruction checks/test typechecking, the production
web build, Capacitor sync, and the iOS simulator build for **arm64 and x86_64**.
The full suite's existing worker boot tests required permitted local loopback
access. Native compilation required normal Xcode caches/simulator services and
used a copied public package cache pinned to Capacitor 8.4.2 at
`9b9fb0af76b2b653f6e9b999f658adc132b9ab4c`, matching `Package.resolved`, with
package updates disabled. Runtime Supabase settings were passed from the existing
workspace environment without copying an `.env` or printing values. Generated
iOS/dependency files have no tracked changes. Existing chunk-size/Browserslist
and Node warnings remain. Independent final review found no blocking issue.

No auth flow or database schema was changed. There is no cross-device lock on
set-number allocation, so simultaneous additions from different clients can
still share a number; ID-based saving handles those existing rows. iOS bundles
`dist` locally (`capacitor.config.ts`); a merged PR does not update installed
TestFlight apps. The previous handoff records no release of #150. The screenshot
does not identify its build, and physical-device/production persistence remains
unverified. The next authorized iOS build should exercise duplicate-row saving,
rapid Add taps, and background/foreground recovery, then confirm History values.

# Previous work snapshot — native session-read failure and workout save recovery

Recorded 2026-10-24 (Pacific). The owner and Alex still see set-save errors mid-workout after the earlier race/auth fixes. The owner requested investigation and a scoped fix from the latest remote source, followed by a PR and merge after validation. Work starts from a fresh clone of `origin/main` at `531bf2d` (merged #147), on branch `fix/workout-save-auth-stall`. No production data writes or iOS release were performed during validation.

Two defects were reproduced and corrected. **Neither has been established as the cause of the owners' original device incidents.** Investigation found both a first-failure path in native session storage and a separate recovery failure. No incident timestamp or foreground sequence was available. Production logs remained unavailable because authenticated access could not be established. The existing iPhone simulator had a design-preview build and no `hyper:auth-diagnostics` records.

**Native session-read defect:** after a successful session load, an ordinary Keychain read rejection returned null instead of the cached session. Through the real Supabase 2.115 SDK this sent the set PATCH with the anonymous key, received an authorization error, and emitted no `SIGNED_OUT` event. The UI therefore continued showing the signed-in workout and the generic save error. A timeout already used the cached session; an ordinary native error did not. This behavior was reproduced with an injected native read rejection, not an actual failed Keychain call on the owners' phones.

- `src/lib/nativeSecureStorage.ts`: ordinary read errors now use the same process-only fallback as timeouts. A successful Keychain miss still clears the cached value; an unknown cold-start value retains the legacy/signed-out fallback. A removal marker prevents failed deletes or stale reads from reviving this launch's signed-out session, while a later sign-in replaces that marker. Mutation revisions prevent a read started before a newer write/removal, including legacy promotion, from returning the obsolete session.
- Ordinary native failures now enter the local diagnostic trail as `keychain:error`. Only an allowlisted native code and optional Int32 OSStatus are recorded. `HyperAuthPlugin.swift` adds the numeric Keychain read status to rejection metadata, without keys, values, tokens or OS-generated messages. This can identify a future real native failure; it does not retrospectively identify one.
- Six regression cases failed before this correction, including the real-SDK authenticated PATCH, ordinary read-error fallback, failed-delete sign-out, stale reads after write/remove, and sign-out during legacy promotion. They now pass; additional tests cover authoritative misses, new sign-in after removal, and diagnostic redaction.

**Separate recovery defect:** `timedFetch` only called `AbortController.abort()` at its deadline, then continued awaiting fetch or the response body. If either never acknowledges cancellation, the SDK keeps its single-flight token refresh pending. The previous recovery's stop/start ticker and bounded `refreshSession` wait do not cancel that shared refresh, so both set-save attempts time out behind it. Three new regression cases failed before the recovery fix: a fetch ignoring abort, a body ignoring abort, and an expired-session set save through the real SDK. These tests simulate the transport stall; they do not prove WebKit caused the first hang.

- `src/lib/timedFetch.ts`: race fetch plus complete-body consumption against an independently rejecting cancellation/deadline promise, while still aborting the transport. Late responses and rejections remain observed but cannot reach the SDK and overwrite newer auth state. An already-aborted caller is rejected before any fetch, so a save whose auth lookup outlives its deadline cannot send a stale write afterward.
- Refresh-token transport attempts now have a 5 s deadline, leaving room for the SDK's initial 200 ms retry inside an 8 s set-save attempt. Other database/auth calls retain 30 s, program snapshots retain 120 s, and edge functions remain unchanged. This bounds each transport attempt, not the entire SDK refresh cycle.
- `tests/workoutAuthRecovery.test.ts`: real SDK with asynchronous session storage and stubbed transport, covering one and two fetch/body stalls, exactly one confirmed set write after auth recovers, late stale refresh responses, and session retention plus manual retry after a sustained outage. `tests/timedFetch.test.ts` also covers ignored cancellation, a late rejected transport, and pre-aborted callers. The misleading recovery comment in `saveWorkoutSet.ts` is corrected; its save/retry behavior is unchanged.

Other investigation: a controlled native-active-before-document-visible sequence can leave the auto-refresh ticker stopped when both events share an in-progress resume. A real-SDK set save still refreshed successfully after expiry, so this race alone did not reproduce persistent save failure and was left unchanged. The Keychain uses `AfterFirstUnlockThisDeviceOnly`, so ordinary screen locking is not by itself evidence that its read should fail. Native calls run on Capacitor's serial bridge queue; no synchronous queue deadlock was found in the app's native plugins.

Validation: the final full run passed all 1,806 tests across 148 files with approved loopback access for the two existing photo-worker boot tests. `npm run lint` (instruction checks, eslint, test typecheck), `npm run build`, and `git diff --check` passed. Build retains the existing large-chunk and stale-Browserslist warnings, plus a Node 26 module-registration deprecation warning. After `npx cap copy ios`, the iOS simulator build passed for arm64 and x86_64, including the Swift diagnostic metadata. Initial package resolution waited on an unrelated macOS credential lookup; compilation succeeded using a copy of the existing public package cache, with Capacitor 8.4.2 and its commit verified against this checkout's `Package.resolved`, and package updates disabled. Signing, installation and launch were not performed. No dependency or tracked generated-file changes.

Limitations/tradeoffs: no physical iPhone, TestFlight, real WKWebView suspension or production backend was exercised. Five seconds can retry a slow but otherwise healthy refresh; the SDK still retries for roughly a 30 s window and then caches a failed refresh for 60 s. During a sustained outage, a set can correctly remain unconfirmed, and manual retries may continue failing until that cooldown expires. A hard deadline stops JavaScript waiting; it cannot undo a refresh or write already accepted by the server. The removal marker is process-only and cannot guarantee deletion across a cold restart if the OS rejects the native delete. Existing best-effort native writes remain: a failed write followed by a successful read of the older persisted value can replace the cached rotated token; that separate persistence-failure path was not changed without device evidence. Keychain accessibility, sign-in flows and database schema are unchanged.

Next device verification, after an authorized build/release: background past token expiry, return on a degraded connection, restore the connection, and save/retry a set without force-quitting. Confirm the saved values in History, repeat with an edit to the same set, and capture the existing on-device `hyper:auth-diagnostics` trail if an error persists. That evidence is needed before claiming the original device issue is resolved.

# Previous work snapshot — Native Frame step 1 (type and labels)

Recorded 2026-10-21 (Pacific). The owner asked for a calmer, more native UI (less text in fewer sizes, no scrolling for a tab's main job, clearer arrangement), reviewed three directions on a Design canvas (https://claude.ai/artifact/Ms1Y55CKKLtUy1t26wnxPF) and approved **B, Native Frame**, to be built in three pull requests. The audit behind the canvas was taken on a local `main` that was 101 commits behind `origin/main`; the current Metal screens were re-measured before building, and the plan below is adapted to Metal. Work is on `feat/native-frame-type` from `origin/main` at `c75338d` (#142). A pull request was requested; merge and release were not.

Step 1 (this branch): the spaced-capitals label role retires everywhere (Metal `Eyebrow`, legacy `t-label`, set headings, History/Fuel/You/Run label rules, theme toggle, figure Front/Back); half-pixel sizes round onto 12 / 13 / 14 / 15 / 17; hero captions and notes read at 15px; `BigFigure` is 44px; Fuel's date and Program's active plan move onto the title line, and You, Coaching, Run and the live session drop the caption above the title. Today keeps its live status; Train pre-session and History keep their caption until step 2. The studio-design guide records the new label role and scale.

Step 2 (next PR): one shared header; Train gains Session · Program · History; Coaching gets a back control that returns where you came from; the tab bar stops lighting You on History and Coaching; Today's Progress / Program / History capsules go. Step 3: Fuel (Today · Meals), Coaching (figure + selected muscle, the rest as sheets) and History refits so each tab's main job fits 402×874.

Validation: lint (instruction checks, eslint, test typecheck), 1,788 tests across 147 files, the production build, and a preview pass at 402×874 in Black and Ivory over Today, Train, Fuel, Program, History, Coaching and You. Not exercised: a native device and the iOS 26 glass tab bar (unchanged). The History and Program reveal animations did not finish in the hidden preview pane.

# Current work snapshot — set logging stuck after iOS resume

Recorded 2026-10-13 (Pacific). Production bug on TestFlight: after the app sat in the background past token expiry, every Save set attempt and retry hung until a cold restart. Server logs showed hourly refreshes stop at that point and no stuck retry reaching the server. Fix on `fix/set-logging-auth-refresh` from `main` at `e54c096` (#144), committed locally; push, PR, merge and release were not requested.

Likely cause: supabase-js reads the session (the iOS Keychain through the native bridge) before every request and single-flights refreshes. After resume, its suspended ticker and unbounded resume handling, or a bridge call that never settles, left every request waiting on auth; the 8 s save deadline fired on each attempt and the retry waited on the same stall.

- `src/lib/nativeSecureStorage.ts`: each Keychain get/set/remove gives up after 3 s and takes the existing fallback. A timed-out read reuses the value this launch last read or wrote (in memory only), else the legacy copy, else signed-out. Plain Keychain errors behave as before.
- `src/lib/authResume.ts`, wired once in `src/lib/supabase.ts` (not for the preview client): on `visibilitychange` and Capacitor `appStateChange`, stop/start auto-refresh and refresh a session expiring within 60 s; stop the ticker when hidden. This replaces the SDK's own visibility listener. Steps have 3 s (5 s for refresh) deadlines and never throw.
- `src/lib/saveWorkoutSet.ts`: every save timeout starts a single-flight auth recovery (restart auto-refresh, `refreshSession` within 5 s). The automatic retry and any later manual Retry wait for it; the payload is unchanged. Also covers Finish workout, which shares `runSaveWithRetry`. The wait before an error grows from 16 s to about 21 s (27 s if every auth step stalls).
- `src/lib/authDiagnostics.ts`: an on-device trail of the last 50 auth events (token refresh start/end with outcome and duration, resume/pause, Keychain timeouts, set-save timeouts) in memory and localStorage `hyper:auth-diagnostics`. No network, no tokens or account details. Read it from Safari Web Inspector on a TestFlight device to confirm the next occurrence.

Validation: 1,721 tests across 138 files (Node 20 with `--experimental-websocket`; Node 22 needs no flag), lint with test typecheck and instruction checks, and the production build. New coverage: hanging Keychain reads, writes and removals, plus a real supabase-js `getSession` over a hung read; resume stop/start and refresh only within 60 s; stalled resume steps; save timeout → recovery → successful identical retry, a stalled recovery, and a manual Retry waiting for recovery; diagnostics capping and redaction.

Not exercised: a physical device or TestFlight build, real WKWebView suspension, and a native iOS build (no native files changed). The root cause is inferred from server logs and SDK behavior, not reproduced. Risks: a timed-out Keychain write is not cancelled, so a late native write could land out of order (the plugin is expected to serialize calls); a real Keychain read slower than 3 s at cold start with no legacy copy shows sign-in for that launch; each save timeout now triggers one extra token refresh; and if the stall is inside the SDK's single-flight refresh itself rather than storage, recovery only helps once that request reaches the 30 s `timedFetch` deadline.

# Previous work snapshot — shared program editor redesign

Recorded 2026-10-13 (Pacific). The owner approved a redesign of program (split) create/edit and asked for it on `feat/split-editor-redesign` (from `main` at `e54c096`, #144), committed per phase. No push, merge, release, production write or migration was requested; none was done.

- One editor for create and edit. **New** opens a small chooser (the five guided answers on one screen with a live preview, or N blank days) that only seeds the shared editor's draft; the program is created on save through `createSplit` (insert inactive → `save_split_snapshot` → activate), because the RPC requires an existing split row. Edits still save through `save_split_snapshot`. The `SplitBuilder` wizard is deleted; `splitTemplates` and `programDesigner` are unchanged. Template names missing from the library are left out as before, now with a notice.
- Reorder: days and exercises drag by a handle (`@dnd-kit/core` + `sortable`, the repo had no drag library) — press and hold 200 ms on touch, mouse/pen after 4 px, Space/arrows/Space from the keyboard, with spoken positions. A superset pair is one block with one handle; drops and the row menu's Move earlier/later share the same block rule (`src/lib/splitDraft.ts`).
- One bottom-sheet picker for add (select several, then "Add N"), swap and superset, reusing search, the cached library and the collapsed calisthenics section. Custom exercises are made there; a typed name the library has picks that row, a new one stays a placeholder until save, when all are inserted in one call (a unique-name conflict rereads the library once). Workout and History use the picker unchanged.
- In-app confirm sheet (`requestConfirm` + `ConfirmDialogHost`) replaces `window.confirm` for discarding edits and deleting a program.
- Device-only draft copy: written 600 ms after edits pause and when the app is hidden, keyed per account and program id (or `new`); offered back on reopen (with a note if the saved program changed since), cleared on save or discard. Never sent to Supabase.
- Performance: name/description/day-name fields commit on blur or Enter; days, superset blocks and rows are memoized on draft objects with stable keys; the per-row `layout` and the `LayoutGroup` re-measure are gone (add/remove fade only).

Validation: 1,731 tests across 141 files under Node 22 (`npx -y node@22 node_modules/vitest/vitest.mjs run`; Node 20 here still fails the seven WebSocket suites, as on `main`), `npm run lint` with the test typecheck, and `npm run build`. New coverage: block drag/superset moves, multi-add, create vs edit save paths (including through the preview mock's real `createSplit`), the batch insert helper, template/blank seeding, draft storage and the debounced autosaver, the confirm queue and the save/cancel actions. A headless Chrome run on `/preview` at 390×844 with touch emulation covered press-and-hold drag, swipe-without-hold (no drag), superset block drag, keyboard reorder, row-menu move, multi-add with a custom exercise, save with a focused field, reload → restore, the discard confirm, guided and blank creation (name required) in Ivory, and drag/picker in Black, with no console errors.

Not verified: iOS WebKit/native touch (long-press callout, scroll vs. hold timing inside the sheet), VoiceOver announcements, and production saves; the custom-exercise insert and program creation ran only against the preview mock. The Program route chunk grows from 27.0 to 42.2 KB gzip (lazy route). Risks: restoring an old copy over a program changed elsewhere replaces those changes on save (the banner warns); device copies stay in local storage after sign-out (account-keyed, no expiry); empty days are allowed when creating, as they already were when editing; the flexible-template rename overwrite still uses `window.confirm` (outside this flow). Commits use a placeholder author (`Claude <noreply@anthropic.com>`) because this machine has no git identity.

# Previous work snapshot — exercise library and program editor

Recorded 2026-10-12 (Pacific). The owner asked for missing gym exercises, a less cluttered exercise picker with calisthenics separated, partial multi-word search, and a faster program building/editing flow. Built on `fix/exercise-library-and-editor` from `main` at `2d6bc7d` (#141). A pull request was requested; merge, release and production writes were not.

- Migration `20261012120000_add_exercise_category_and_gym_staples.sql` (not applied) adds a nullable `exercises.category` (`gym`/`calisthenics`), backfills it by name rules, and inserts Hack Squat, Machine Chest Press, Machine Shoulder Press, One-Arm Chest-Supported Machine Row, Cable Overhead Tricep Extension, Cable Curl and 45° Back Extension with `ON CONFLICT (name) DO NOTHING`. Nothing is deleted or renamed; "Weighted Hyperextension" keeps its history. The app classifies rows the same way when the column is missing or NULL (`src/lib/exerciseSearch.ts`), so it works before the migration is applied.
- The picker (shared with Workout and History) shows gym movements first and calisthenics in a collapsed section; search matches every word in any order, partial words, plurals and common shorthand. Cached library rows are reused for five minutes instead of refetched on every open.
- Program editor: the add picker stays open for several picks; days open as a one-line overview; removals of exercises and days offer Undo (day removal no longer uses a confirm dialog); reorder moves superset pairs together; number cells select on focus; the swap icon is always visible. The custom builder uses the cached library and the new search.

Validation: 1,695 tests across 136 files under Node 22 (Node 20 here lacks the native WebSocket that seven existing suites need, on `main` too), lint with test typecheck, and the production build. The migration ran twice against an in-memory Postgres (PGlite). A headless browser run at 390×844 in Ivory and Black covered edit, multi-add, calisthenics toggle, search, remove/Undo, save and the custom builder, with no console errors. Native device behavior, select-on-focus in iOS WebKit and the migration against production remain unverified.

# Previous work snapshot — session-only exercise swaps

Recorded 2026-10-04 (Pacific). The owner asked for an intuitive way to swap a movement mid-session, for that workout only (e.g. Lat Pulldown taken → weighted Pull-Ups), mainly in program (split) workouts, so History shows what was really done instead of a note. Built on `feat/session-swap` from `main` at `1841914` (#139). The owner then authorized a commit and pull request; merge and release were not requested.

PR #121 already had a basic swap in the movement menu. It now:
- has a visible Swap action beside the target on expanded program-session movements, plus Swap exercise and Switch back in the menu;
- carries the remaining set count and rep target to the replacement (loads still come from the replacement's own history);
- records the planned movement as `substitutes_for` on the session plan item (JSONB, no migration), shown as "Instead of …" on the card and in History;
- switches back with one tap, rejoining sets the original already finished.

The saved program is never changed, and flexible templates drop the marker. Also fixed: Today's resume cue now follows the session plan for program workouts, the rest bar's "Next ·" label follows a swap, and History no longer shows raw `[set-range]` tags from plan notes.

An independent review found that a superset replacement numbered from set 1 could block the partner's last round. Replacements in a superset now keep the moved sets' round numbers. Switching back now widens a program set range to admit the sets left.

Validation: 1,662 tests across 135 files, the test typecheck, eslint on every changed file, and the production build passed. A headless browser run at 390×844 in Ivory and Black covered swap, menu, switch back with rejoin, leave/return, Today, finish and History, with no console errors. Native device behavior and production persistence were not exercised.

A concurrent typography session is editing this same checkout: `.tmp/typography-*`, `src/index.css`, `settings.css`, `rest-timer.css`, `RollingNumber.tsx`, two nutrition loggers, three iOS Swift files and the studio-design skill. Those edits are not part of this changeset, which commits only its own files by name. The typography work should move to its own branch from `main` (`git switch -c <branch> main`) before it commits. Full `npm run lint` in the shared checkout currently fails only on its `.tmp/typography-ios` build output.

# Previous work snapshot — optimization second-review fixes

Recorded 2026-10-04 (Pacific). The owner requested a thorough review of the six optimization commits after `de2cd14`, then explicitly requested implementation of all thirteen recommendations. Implementation began on `opt/batch-c2-pr` at `e0a7ce0`. The owner subsequently authorized a PR and merge; the changeset is prepared on `fix/optimization-recovery` against `main` at `5da071d`, retaining the newer sheet-layer and zero-value set fixes. Deployment, release, and production-data writes remain outside this request.

The [second review and implementation record](../audits/2026-10-04-optimization-second-review.md#implementation-follow-up) maps R1–R13 to the changes and regression tests. Fixes cover WHOOP retry progress, native GPS/control ordering and legacy recovery, account isolation, schedule retry conflicts, workout note lifetimes, honest History failures, flexible start/restore recovery, response-body deadlines, nutrition month callbacks, retained Gemini drafts, and focused numeric program edits.

Validation after integration with current main: all 1,646 tests across 134 files passed in one full run, plus lint/test typechecking, web build/Capacitor sync, and the iOS simulator build. Fixture browser checks at 390×844 covered Ivory/Black, focused numeric Save/Cancel, and declining AI-draft replacement. Required runtime variables were present. No tracked generated iOS files changed.

Physical-device run/background/Live Activity behavior and production persistence remain unverified. Legacy snapshots with mixed in-app/native pauses cannot be reconstructed with certainty; migration uses a conservative accounted-prefix rule. Multi-statement workout mutations remain non-atomic but report failure and retain retry paths. See the implementation record for limits and prior deployment follow-ups.

The pre-existing untracked `.claude/launch.json` and `supabase/.temp/linked-project.json` were preserved and excluded from this changeset. The audit, implementation helpers, and new regression tests belong to this changeset.

# Previous work snapshot — optimization pass

Recorded 2026-09-26 (Pacific). The owner asked for a thorough optimization review that loses no quality or feature usability. The read-only multi-agent review is recorded in [the optimization review](../audits/2026-09-26-optimization-review.md): 98 confirmed findings, each with a safety guard.

The owner said "go" for Batch A plus the two data-loss packages. Each was implemented in its own worktree lane, independently reviewed and fixed, then integrated:
- `opt/batch-a` (Batch A):
  - the safety net (A1);
  - cleanup (A2);
  - the small fixes (A3), except the ones waiting on a decision.
- `opt/whoop-sync` (B-1, G1/G4/G13/G14). It conflicts with Batch A only in `tests/appStore.mustWork.test.ts`, where tests are appended.
- `opt/run-tracking` (B-2, F72/F8/F9/F57/F10/F56). It merges cleanly with Batch A.

The combined state of all three passed:
- 1247 tests;
- lint, including the new test type-check;
- the web build;
- the iOS simulator build.

A preview click-through covered Today, set save and rest, finish, food logging with time, History, Coaching, Program, Run, You and Saved meals, in Ivory and Black, with no console errors. Fonts are now self-hosted, with no Google requests.

Owner decisions (2026-09-30), all implemented in PR #134:
- Monday–Sunday training week (F24);
- the 21-day weight rate (F81);
- delete the Cronometer importer (F110);
- approve the offline sign-in change (F53).

PRs #128, #129 and #130 are merged. PR #134 (`opt/batch-b-pr`; per-finding history on `opt/batch-b`) carries:
- Batch B packages B-3, B-4, B-6/B-7, B-8, B-10, B-11, B-12, B-13 and B-14;
- the four owner decisions.

It passed 1452 tests, lint, build and the iOS build, plus a preview click-through.

Production steps, none done:
- F66 step B (delete the deployed process-food-photo function and its secrets);
- F64 tier 2 (baseline migration and repair);
- F103 (deploy analyze-food-trial);
- C-6 (per-account USDA cache migration).

PR #134 is merged. The next PR (`opt/batch-c1`) carries:
- B-5 (F1): session-based user ids, removing the auth round trip before queries.
- B-9 (F7): 30 s request limits, and 120 s for program saves.
- C-2 (F44 + F99): route splitting plus a vendor chunk. The launch load drops from about 407 to 338 KB gzip.
- C-5 (F50 step 2): the motion light runs only while lit surfaces are mounted.

The final PR (`opt/batch-c2`, stacked on `opt/batch-c1`) carries:
- C-1 (F22): the workout read race guard, shared in-flight reads, and an instant Today/Train keyed to `hydratedForUserId`.
- C-3 (F28): a shared tested set-count and plan helper, fewer plan reads, and the duplicate "Set 1" fix.
- C-4 (F41): food and saved-meal persistence shared by FoodLogger and Settings.

The only remaining item from the review is C-6 (F65, the per-account USDA cache). It needs an owner-approved production migration.

Known follow-up from C-1: on a planned or rest day in split mode, the Today hero can still shimmer briefly on tab switch, because the schedule hooks reload. Device checks listed in the PRs remain for the owner, notably the run tracking scenarios, the rest ring, the barcode scanner and the Health weight backlog.

# Previous work snapshot — Kinetic beautification pass

Recorded 2026-09-26 (Pacific). All four Kinetic phases shipped as PRs #124–#127 (merged): motion foundation and charts, workout and nutrition moments, lazy three.js maquette and session token, and native iOS 26 glass surfaces. Physical-device feel (glass, haptics, motion light, VoiceOver) is still for the owner to check on TestFlight.

# Previous work snapshot — adaptive scheduling setting

Recorded 2026-09-05 (Pacific). Implemented locally on
`codex/adaptive-scheduling-toggle`, based on freshly fetched upstream `f026eeb`
(PR #112, current You settings). The former `3735/hyPer` worktree was removed;
this task uses an isolated clone at `/private/tmp/hyPer-adaptive-setting-20260905`.
The saved main checkout and its unrelated `supabase/.temp/linked-project.json`
were left untouched. After reviewing the implementation and account-wide
persistence, the user explicitly authorized a GitHub PR and merge in this
session. A separate production change or iOS release was not requested.

You → Training (within the existing Activity directory) now has one standard
“Adaptive split scheduling” switch and short explanatory text. No duplicate
Train/dashboard control or new dashboard card. Missing settings on existing/new
accounts default on. Successful changes are saved to the existing account user
metadata and persisted session; no schema migration or auth-flow changes. Failed
saves retain the previous value and show an error; delayed saves cannot overwrite
another account's local state.

Today and Train share the reactive preference. On retains existing completed-day
anchoring. Off uses the original saved fixed calendar, with no completion-read
dependency; flexible mode still advances by eligible completion counts in saved
order, including compatibility with legacy offsets. Re-enabling immediately
returns to the existing adaptive history projection. Workouts and saved splits
are never rewritten by the switch. The preview backend now echoes and retains
mock account metadata across reloads; workout fixtures continue to reset.

Verification: 890 tests across 76 files passed, including 26 new toggle cases and
an actual Supabase SDK persisted-session restoration test; lint/instruction
checks and production build/TypeScript passed. Tests used non-secret localhost
Supabase placeholders because this isolated checkout has no .env. Existing
large-bundle/Browserslist warnings remain. Independent final review found no
actionable issues.

Bundled Playwright browser verification at 390×844 covered Ivory/Black, default-on,
off/on after reload, failed saves retaining their confirmed value, and identical
Today/Train changes (saved Lower A when off; adaptive Lower B when re-enabled from
completed Upper B). No page errors or horizontal overflow. Test fixtures stayed
in the isolated preview browser; no source fixtures or real account data changed.
Screenshots: `/private/tmp/adaptive-toggle-ivory-on.png` and
`/private/tmp/adaptive-toggle-black-off.png`.

Native/device appearance and real-service persistence were not exercised; the
SDK persistence regression uses a mocked auth server with real session storage
behavior. Account metadata uses the existing session refresh behavior on other
devices. No local cache is used as a substitute for a successful account save.

Next: check the GitHub PR for `codex/adaptive-scheduling-toggle`. PR creation
and merge are authorized for this setting; native device validation remains pending.

## Photo worker models + VM re-login (2026-09-29, DEPLOYED)

User asked: re-login Codex and Claude on the VM; AI food logging (photo +
describe) on gpt-6-sol and claude-sonnet-5-5. Merged in PR #131 (b414477f).

- Worker defaults: `gpt-6-sol`, `claude-sonnet-5-5`, both `high`. The coach
  now has its own `PHOTO_WORKER_COACH_MODEL` (default `claude-opus-5`, `max`);
  before, it shared `ANTHROPIC_MODEL` and would have silently moved too.
  `/health` reports `models.coach` / `efforts.coach`.
- `gpt-6-sol` needs codex-cli >= 0.158 on a ChatGPT account. 0.146 returns
  "model is not supported when using Codex with a ChatGPT account". Verified
  on 0.158 with the worker's exact describe flags; Sonnet 5.5 verified too.
- The Gemini `analyze-food-trial` edge function is a separate trial and was
  not changed.
- Staged on the VM (md5-verified): worker + core + schemas in
  `/home/aross/hyper-deploy/scripts/`, and `/home/aross/worker-models-relogin.sh`.
  Live service still reported the old models after staging.
- The script (run interactively with sudo): upgrades the service user's
  Codex to 0.159.0 only if < 0.158; `codex login --device-auth` as
  `hyper-photo`; Claude via `setup-token` if the env file uses
  `CLAUDE_CODE_OAUTH_TOKEN`, else `claude auth login`. It real-call checks
  gpt-6-sol, sonnet-5-5 and opus-5 against a CANDIDATE env file via
  systemd-run (same user, env parser, flags). Only if all pass: back up
  `/etc/hyper/photo-worker.env`, install, wait for in-flight jobs, run
  `worker-code-deploy.sh`, assert `/health` models.
- Validation: 594/594 vitest, eslint clean, env-editing helpers harness-tested.
  Not yet exercised: the script end to end (needs sudo + the user's logins).
- Risk (recorded earlier in the root handoff): the worker serves other app
  users through personal ChatGPT/Claude subscription logins.

Deployed 2026-09-29 20:46 UTC: the user ran the script; it only installs
after all three real-call checks pass. Verified afterwards: service active,
`/health` models gpt-6-sol / claude-sonnet-5-5 / coach claude-opus-5, efforts
high / high / max, both providers authenticated, deployed worker md5 matches
b414477f. Rollback: `/etc/hyper/photo-worker.env.bak.1790714545` + restart.
