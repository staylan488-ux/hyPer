---
name: blanc-native
description: Build or change hyPer's React Native app in native/ with the approved Blanc design, the shared ../src logic, and its simulator checks.
---

# Blanc native app

`native/` (Expo SDK 58, Expo Router) is hyPer's iPhone app: the full native
rebuild approved on 2026-10-26, released as hyPer 2.0 on 2026-10-28 in place of
the retired Capacitor web app. Blanc is approved: do not explore new directions
for native work. Where these notes say "the web", they name where a shared rule
came from; the web app itself was removed on 2026-10-30 (Git history keeps it).

## Architecture

- Reuse, don't copy. Stores, data access, nutrition and training rules come from
  `../src` through `@/…` ([Metro config](../../../native/metro.config.js)); native
  code imports its own files as `~/…`. `src` holds no UI: screens and
  components live in `native/`, and only logic worth sharing or testing goes in
  `src/lib`, `src/stores` or `src/hooks`.
- [Platform swaps](../../../native/src/platform/) replace the few shared modules that
  cannot run in React Native: the Supabase client, native bridge, OAuth, preview
  flag, haptics, keep-awake, rest notifications, the workout Live Activity,
  focused-field commit, app visibility, run cues, plus Capacitor shims. The
  bridge's `NativeHealth` is `native/modules/hyper-health` (HealthKit body
  weight) and `NativeRun` is `native/modules/hyper-run` (the GPS recorder),
  both ports of the Capacitor plugins, so `hasNativeHealth()` and
  `hasNativeRun()` are true here while `isNativeIOS()` (the Capacitor shell)
  stays false. Add a swap rather than importing React Native
  into `src`. TypeScript mirrors the swaps in `native/tsconfig.json` paths.
- Shared code that reacts to the app coming back or going away uses
  `@/lib/appVisibility`, never `document`; the native app backs it with AppState.
- The native Supabase client keeps the web client's safety: `timedFetch`
  deadlines, refresh diagnostics and the shared `authResume` steps. Its session
  lives in the Keychain through `native/modules/hyper-keychain`, which uses the
  Capacitor app's items (service `<bundle ID>.auth`), so the 2.0 update kept
  people signed in.
- Auth uses the shared `authStore` and `authScreen` rule; the root layout guards
  the app, sign-in and offline screens with `Stack.Protected`. After sign-in the
  tab layout loads the account (`native/src/lib/accountData.ts`).
- The live workout follows the shared session plan rules in `src/lib/sessionPlan.ts`
  (order, swaps, set ranges), the same ones the web Train page uses. Writes go
  through the store's own actions (`logSet`, `addWorkoutSet`,
  `removeLastUncompletedSet`, `substituteWorkoutExercise`,
  `switchBackWorkoutExercise`); movement notes use the shared `noteAutosave`
  through `native/src/lib/notes.ts`, and a swap waits for pending notes.
- `native/modules/hyper-view` reads a view's real window frame from UIKit. React
  Native's own measure works from its layout tree, which does not know where iOS
  put an item inside a navigation bar.
- Preview mode is the default in development builds: the shared stores run on
  the in-memory sample backend. `EXPO_PUBLIC_HYPER_PREVIEW=0` with
  `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` uses the real
  project. A Release build uses the real project unless the flag is `1`, so an
  archive cannot ship the sample data.
- Two builds of one app ([app.config.js](../../../native/app.config.js) over
  app.json): the test app by default ("hyPer Native", `app.hyper.native`,
  scheme `hyper-native`, installed beside the released app) and, with
  `HYPER_APP=release`, the released app (`app.hyper.mobile`, scheme
  `app.hyper.mobile`, widget extension `app.hyper.mobile.HyperWidgets`, shown
  as "hyPer"). `HYPER_BUILD_NUMBER` sets
  the build number. Prebuild with `--clean` when switching variant. The URL
  scheme in JavaScript and Swift follows the bundle ID iOS reports
  (`modules/hyper-keychain/bundle.ts`, `WidgetSnapshotStore.appScheme`), never
  a hard-coded value. Links from outside go through
  [+native-intent](../../../native/src/app/+native-intent.tsx): the email
  confirmation's `auth/callback` exchanges its code there.
- Use Apple's components before drawing your own: native stack (large titles,
  swipe-back, `formSheet` with detents), NativeTabs with the BottomAccessory for
  the live workout, header items with SF Symbols, Expo UI SwiftUI controls,
  `expo-glass-effect`, `expo-haptics`, context menus, `ActionSheetIOS`,
  `Alert`.

## Design

- [Tokens and type roles](../../../native/src/theme/blanc.ts): the system font only.
  Section 20/600, title 24/600, body 17, secondary 15, footnote 13, Menlo 12 for
  label details; big figures in SF Pro Thin (weight 200, tabular digits).
- Chalk ground, white labels, black ink, graphite for secondary text. No accent
  colour; red only for live state, errors, over-limit and the brand P.
  Over-limit follows the saved nutrition goal through the shared
  `warnsOverTarget` (`src/lib/fuelSummary.ts`): protein past target is never
  red, and while bulking or lean bulking nothing past target is (calories read
  "extra", the line stays full in ink); cutting, maintaining or with no goal
  saved, calories, carbs and fat past target turn red (the owner's call on
  2026-10-30).
- The white [Label](../../../native/src/components/Label.tsx) is the one container
  (10 pt continuous corners). Sections are separated by space, rows by hairlines
  with an iOS press highlight. Ink capsules are primary actions; quiet fill
  capsules are secondary.
- The brand mark is the red italic P ([BrandMark](../../../native/src/components/BrandMark.tsx),
  Fraunces Mark Medium Italic, approved 2026-10-26): the app icon, Today's top-left
  corner and the sign-in and offline emblem. Fraunces appears nowhere else.
- The set [Tally](../../../native/src/components/Tally.tsx) counts sets like a
  paper training log: one stroke per set in groups of five, the next set's stroke
  taller, a finished group closed with a diagonal. Use it for set progress and
  finished-session summaries only, never as a logo or decoration.
- Inspiration, never imitation: do not reproduce another brand's marks, labels,
  layouts or signature details (the owner ruled out copying Maison Margiela's
  stitches and numbered label on 2026-10-26).
- No costume luxury: no serif type outside the P, no Roman numerals,
  faux-editorial copy, glow, 3D or particles. Sentence case. Touch targets at
  least 44 pt.
- Restraint over completeness (the owner found the web app bloated: numbers and
  text everywhere). A card carries one title, at most one quiet line and at most
  one action. Leave out zeros, placeholders ("– lb × –") and figures that repeat
  another; add a row only when it changes what the person does next.
- Fuel follows the web logger through shared `src/lib` rules (foodPersistence
  `ensureFoodRow`, saveNutritionEntry, manualFood, barcodeLookup, photoReview,
  nutritionDay, savedMeals, recentFoods, repeatEntries, savedMealFromLog); never copy them into
  `native/`. Log food is one sheet (`native/src/app/log-food.tsx`, parts in
  `native/src/fuel`) with Recent, Saved, Search, Scan, Manual and Photo, a
  review for a chosen food, and the meal builder (Scan opens the camera only
  when Scan barcode is tapped, the owner's call on 2026-10-27). Recent opens
  first: four weeks of the log, most often eaten lately first, + logs the
  usual amount and a tap reviews at it; a swipe hides a food on this device
  until it is logged again. A day's entries swipe for More and Delete and hold
  for the same menu; on a past day a meal's ⋯ and an entry's menu offer Copy
  to today (same foods, amounts and times into today's matching meal), and on
  any day Save as meal (the meal builder opens with those foods at the amounts
  eaten, to rename, trim or add to; it saves to Saved without logging, in the
  place of a saved meal with the same name; closing it cancels, asking first
  once it was changed; not offered for one saved meal as saved). Barcode scanning is VisionKit through `native/modules/hyper-barcode`
  (unavailable in the simulator: type the digits there). Pod install needs
  `LANG=en_US.UTF-8`.
- "This should work, and it does" (the owner, 2026-10-27; app-wide audit
  2026-10-28): every list item that can be removed swipes left for its actions
  ([SwipeRow](../../../native/src/components/SwipeRow.tsx)): the destructive
  one in red, a full swipe (past about half the row, decided at release)
  fills the row red and runs it, one row open at a time, and a scroll, a tap
  on another row or leaving the screen closes it. The touch that swipes also
  lifts as a press on the row under it, so a row's tap and long press start
  with `if (closeOpenSwipeRow()) return;` (Row does). Actions report their own
  success or error haptic; removals are optimistic and come back with an alert
  on failure. Rows move with the shared motion in `native/src/lib/motion.ts`
  (`rowEnter`, `rowExit` slides off left, `blockExit`, `rowLayout`), and the
  Label around them (an Animated.View) takes `layout` with `overflow: hidden`.
  Anything with more to do offers it on a long press: iOS's own context menu
  ([HoldMenu](../../../native/src/components/HoldMenu.tsx), `menu` on a Row,
  through `native/modules/hyper-menu`), which lifts the row on its label's
  white with an SF Symbol beside each item and submenus for choices such as
  Move to. A choice marked `removes` (a delete that does not ask, a move)
  runs as the menu closes while the lifted row fades in place; any other
  runs once the menu is off screen. Where a swipe row's buttons sit behind
  the row, give `backdrop` the row's colour. A hold on a text field stays
  the field's. A swipe's More shows the same actions as a sheet
  (`showActionSheet`), and a Row gives VoiceOver each item and its swipe
  actions. A value that looks editable
  opens its editor when tapped, a card that leads somewhere is tappable as a
  whole, a FieldRow focuses on a tap anywhere on the row, number pads get
  iOS's Done (or Next) bar through `returnKeyType` (`numberPadReturnKey`),
  sheets with unsaved work use `useLeaveGuard`, screens of server data pull
  to refresh, and a small destructive button with no swipe behind it asks
  first.
- Food AI: the owner logs with Gemini (the web logger's hosted mode), so the
  native app defaults to it (AI tab, Manual's hand-off, Describe amount); a
  device set to the worker gets the Photo tab instead.
- Per-movement actions live in one sheet (`native/src/app/movement.tsx`), opened
  from ⋯ on the current card, a finished movement's row, or a hold (lifted and let go) on any
  row: logged sets to correct (never starts rest), the set count from 1 to 12
  whatever the program says (the owner's call on 2026-10-26; the web keeps to
  the program's range; only unfinished sets are removed), the note, and swap
  for this workout or switch back. In a flexible session the same sheet pairs
  a superset, unlinks it, or removes the movement (logged sets stay in the
  workout). Last time's note for the movement shows under the
  set card's "Last time" line and in the sheet's Note section. Tapping an unfinished row still makes it the next movement.
- Before a session, Train shows today's [PlanCard](../../../native/src/components/PlanCard.tsx)
  (shared with Today), then every other day to start. Its header menu holds the
  schedule sheet (`native/src/app/schedule.tsx`, the web's Day 1 and rhythm
  choices, saved through the shared `buildPlanSchedule`; saving bumps
  `useScheduleRevision` so open screens re-read it) and Program, which
  holds the training mode. Flexible mode names the session or starts a quick
  start; the session grows with Add movement, the pencil renames it, and
  Finish offers to keep it as a quick start. Adding and removing movements is
  a flexible-session feature, as on the web.
- Supersets in either mode follow the shared `supersetFlows` and
  `supersetLogBlock`: rounds go A1, B1, A2, rest comes after B only, and a set
  out of turn shows why instead of logging. The one exercise picker
  (`native/src/app/swap.tsx`) serves swap, add and superset through its
  `mode` parameter.
- Reorder in the live workout is in place (the owner's call on 2026-10-28,
  replacing the Reorder sheet): hold a movement to lift it (a firm tick) and
  drag it; the others slide aside with a light tick per place, and a drop
  saves at once (a failed save puts the order back). Held and let go without
  moving, it opens the movement sheet. A pair moves as one; VoiceOver gets
  Move up and Move down. [DragList](../../../native/src/components/DragList.tsx)
  places rows by position (no jump while a drop saves), rounds the card's
  first and last rows itself, holds row presses through `holdRowPresses`,
  and the page stops scrolling while a row is lifted.
- Beat last time (the owner's pick, 2026-10-30): a set logged in Train that
  beats the same set last time, by the shared `describeSetGain` rule
  ([beatLastTime](../../../native/src/lib/beatLastTime.ts)), gets
  `haptics.beat` (success, then one firm tick) and, for four seconds, "↑ Beat
  last time · +5 lb" in ink where the card's "Last time" line sits (it stays on
  "All sets logged"). The movement sheet marks those sets with ↑, and the
  finish label adds a "Beat last time" row when any did. The tab layout runs
  the one "last time" lookup (`usePreviousTargetsLookup`), so Finish from
  Today counts too. Corrections never celebrate.
- Rest: the timer button in Train's header, or the workout bar tapped during
  a rest, opens the rest sheet to start a rest
  without logging a set, pause or resume it, add 30 seconds, change the
  movement's rest length (1, 2, 3 or 5 min, or a custom time) or end it. The
  rest is the web's stored rest session (`src/lib/restTimer.ts`), so it
  survives leaving Train and relaunching. Lengths are kept per movement through
  the shared `src/lib/restPreferences.ts`, as on the web (own length, else the
  last one chosen, else 90 s), and a logged set starts rest at its movement's
  length.
- Away from the app ([lib/rest.ts](../../../native/src/lib/rest.ts)): a running
  rest schedules the web's "Rest over" notification (expo-notifications, local
  only: `enableRemoteNotifications: false` keeps push out of the entitlements),
  and the workout's Live Activity counts it down on the lock screen and in the
  Dynamic Island. Pause cancels the notification and shows the time left still;
  End rest and a finished workout clear both; a rest that runs out leaves the
  notification to fire. While a rest runs or is paused, the card has +30 s and
  End rest, which work without unlocking: `RestControlIntent` (in
  `modules/hyper-activity/shared`, run in the app's process) moves the card and
  the notification itself, so both follow while the app sleeps, and logs the
  tap; the app applies logged taps to its stored rest, each at its own time
  (`native/src/lib/restControls.ts`), on launch, on the module's `restControl`
  event, on return to the front and before a rest reads as over. In the app, rest ends with a haptic and the sound, no
  banner. The shared `restTimerWorkoutGuard` clears a rest whose workout ends
  elsewhere and on sign-out. Card updates go through the shared ordering rules
  in `src/lib/workoutActivitySync.ts` (also behind the web shell's card).
- The Live Activity is SwiftUI in a widget extension, added on prebuild by
  [plugins/withHyperWidgets.js](../../../native/plugins/withHyperWidgets.js)
  from [targets/widgets](../../../native/targets/widgets/). The card's data,
  `WorkoutActivityAttributes`, has one definition in
  `native/modules/hyper-activity/ios`, compiled into the app's module and copied
  into the app (for the rest buttons' intent) and the extension; ActivityKit
  matches the copies by name and fields. The card
  uses Blanc's tokens (`targets/widgets/Blanc.swift`) and the P's font
  (bundled into the extension). Prebuild with `--clean` after adding or
  removing extension files. The run card and the home-screen widgets live in
  the same extension (below).
- Program lives in Train's stack (`train/program`, `train/program-view`)
  and holds the training mode. Editing goes through the shared
  `splitEditStore` in the `program-edit` page sheet (its own stack: the
  program, then a day); `usePreventRemove` in its layout asks before
  unsaved edits go, through `discardSplitEdit(confirmAlert)`. Sets and
  reps (`program-exercise`), reorder (`program-reorder`) and the picker
  (`swap` with `program=add|swap|superset`) are root sheets over it and
  change the draft only; nothing is written until Save or Create.
- History lives in Train's stack (`train/history`, `train/past`,
  `train/activity-view` for an activity's numbers, notes and a run's splits)
  and Progress
  in Today's (`today/progress`). Past-workout edits go through
  `editPastWorkout` in [lib/history.ts](../../../native/src/lib/history.ts),
  which runs the web's edit protocol one edit at a time per workout. Delete a
  workout only after `confirmDeleteWorkout` asks. The muscle figure draws the
  shared maquette shapes with react-native-svg.
- You (milestone 7) is the You tab's stack (`you/weight`, `targets`,
  `adaptation`, `meals`, `analysis`, `worker`, `connections`, `account`,
  `about`) plus root sheets (`log-weight`, `targets-edit`,
  `targets-calculate`, `targets-coach`, `saved-meal`). Screen state shared
  between them lives in `native/src/lib/you.ts`; the rules come from
  `settingsUx`, `bodyWeightSummary`, `nutritionWizard`, `healthWeights`,
  `whoopStatus` and `foodTrialUsage`, which the web You page also uses. The
  calculator and coach hand their numbers to the edit sheet (`stageTargets`);
  nothing is saved until Save there. Appearance (Automatic, Light, Dark) keeps
  the web's `hyper-theme` key and applies through `Appearance.setColorScheme`
  before the first screen draws. WHOOP connects through iOS's sign-in sheet
  with the return address `app.hyper.mobile://settings` (the only one the
  whoop-oauth function accepts; the sheet catches it, so it never reaches the
  other app). The tab layout runs the shared WHOOP foreground sync and Apple
  Health weight sync, as the web shell does.
- Run (`native/src/app/run.tsx`, a full-screen modal from Train's ⋯ menu,
  You's Start a run, or the run card): set up (Long run or Splits, auto-split,
  a simulated route in sample mode), live (the current split's pace, time,
  distance, average; Split, Rest or Resume, and Hold to finish), then the
  finished run to save (to History), discard (asks first) or export its
  private GPS diagnostics. The engine and recovery are the web's
  (`useRunTracker`, `src/lib/runTracker.ts`, `nativeRunSource`), the words and
  choices `src/lib/runDisplay.ts`. Location (and Motion) are asked on Start,
  with a way to Settings if refused. The screen draws its own top bar: a
  modal that shows and hides iOS's header is rebuilt, which drops the run.
- `native/modules/hyper-run` is the Capacitor recorder ported call for call:
  every GPS sample appended to `HyperRunRecorder/<runId>.jsonl`, lock-screen
  controls in UserDefaults (the Capacitor app's keys, so the update kept a run),
  background location, never restarting on its own. JavaScript keeps running
  while locked, so laps and sprint tones play then too (`RunCuePlayer`, mixed
  over music; the app has the `audio` background mode for this).
  `RunActivityAttributes.swift` is compiled into the module, the app and the
  extension; `shared/RunControlIntent.swift` into the app and the extension,
  because iOS runs a Live Activity button's intent in the app's process
  (`withHyperWidgets.js` adds both).
- Widgets (`targets/widgets/HomeWidgets.swift`): Fuel (calories and protein
  left; small, medium and the three lock-screen sizes) and Training (today's
  session; the medium adds the next three days). They read a snapshot the app
  writes to the App Group `group.app.hyper` through
  `native/modules/hyper-widget-data`: `native/src/lib/widgets.ts` builds it
  from Today's rules (`widgetPlan.ts`, two weeks of plan ahead) and clears it
  on sign-out. At midnight they turn to the next day on their own. Tapping
  one opens Fuel or Train (`hyper-native://fuel`, `://train`).
- A screen with unsaved edits uses `useLeaveGuard` (`native/src/lib/leaveGuard.ts`):
  closing asks first, and after Discard it steps aside before closing. Never
  re-dispatch the held action straight from `usePreventRemove`'s callback;
  the guard is still on and asks again forever.
- A sideways swipe on a pushed screen is iOS 26's swipe-back. Horizontal
  paging there (History's calendar) uses a paging ScrollView, which iOS lets
  win, never a gesture-handler fling.
- Motion is native transitions plus Reanimated springs for press feedback and
  the tally. Figures that change in place (calories and macros, the rest
  timer, set counts) roll their digits with SwiftUI's numeric text transition
  through [RollingText](../../../native/src/components/RollingText.tsx), drawn
  over a hidden copy of the same text so layout, baselines and VoiceOver do
  not change. The copy's frame grows or shrinks on SwiftUI's smooth spring
  when the figure gains or loses a digit; text beside it moves on the same
  spring (`figureLayout`), a figure whose right edge is fixed aligns right,
  and a centred one (the rest time) sets `textAlign: 'center'`. Never scroll a large-title screen programmatically to "the top":
  it fights the title and short pages snap back. Reveal content only when it is
  hidden.
- The one branded animation is the cold-launch [intro](../../../native/src/components/BrandIntro.tsx):
  the P blooms, "hyPer" unfolds from it and holds (longer while the account
  loads), folds back, and the P flies to the first screen's anchored BrandMark as
  the content rises in, with a soft haptic on landing. Geometry comes from the
  font metrics in `native/src/lib/brandGeometry.ts`. A tap skips it; Reduce
  Motion and scripted dev launches (`-hyperIntro off`, or any `-hyperRoute` or
  `-hyperAction`) leave it out. It never replays on return from the background.
- Haptics match the web app's rule: a light tap on every tab, button, header
  item and chip; select for value changes; success or error for saves; none
  for typing or scrolling. iOS's own tab bar and header items are silent, so
  wire them.
- The tab bar shrinks on scroll on every tab (the owner wants it everywhere).
  iOS only shrinks pages that scroll well past the screen and sticks on pages
  just past that, exactly like a plain SwiftUI app. Tab root pages use
  [TabScroll](../../../native/src/components/TabScroll.tsx), which gives any
  page that scrolls at least 200 points of travel; re-measure its insets if
  iOS changes its bars.

## Behaviour to keep

Rest starts only after a set saves; a failed save keeps the numbers and the
button becomes Retry. Food saves use the shared helpers. Before rebuilding a
flow, read the shared rule in `src/lib` it uses and the tests that cover it.

## Checks

- `cd native && npx tsc --noEmit`. It also type-checks the shared code the app imports.
- Simulator: start Metro (`npx expo start --port 8081`), then build with
  `npx expo run:ios --device <udid> --no-bundler` (CocoaPods required). Prefer
  this development build over Expo Go: links opened with `xcrun simctl openurl`
  stop at an "Open in …?" prompt that a script cannot answer.
- Motion: record a cold launch with `xcrun simctl io <udid> recordVideo`, slice it
  with ffmpeg and check the frames; a still screenshot cannot show a handover
  jump or a stutter.
- Debug builds accept launch arguments for headless checks
  ([devLaunch](../../../native/src/platform/devLaunch.ts)), for example
  `xcrun simctl launch <udid> app.hyper.native -hyperRoute /train -hyperAction logSet`,
  then `xcrun simctl io <udid> screenshot <file>`. Check light and dark
  (`xcrun simctl ui <udid> appearance dark`).
- Lock screen and Dynamic Island: a UI test presses Home
  (`XCUIDevice.shared.press(.home)`) or locks the simulator with the private
  `pressLockButton` selector, then saves `XCUIScreen.main.screenshot()`. The
  first rest brings iOS's notification prompt (tap Allow on SpringBoard), and
  the card's first lock-screen showing asks "Allow Live Activities?". iOS can
  take a while to redraw a card after its stale date, so a rest that ran out
  with the app away may read 0:00 until the app returns.
- Runs: start a route with `xcrun simctl location <udid> start --speed=3.4
  --interval=1 <lat,lon> <lat,lon> …` and pick Real GPS on the run screen
  (sample mode defaults to a simulated route); `simctl location <udid> clear`
  afterwards. `-hyperAction noWorkout` finishes the sample account's live
  workout, so the run card shows alone on the lock screen. The card's
  buttons are SpringBoard elements in a UI test (labels Split, Rest, Finish,
  Tap again; the workout card's are Add 30 seconds and End rest).
- Widgets: in a UI test, long-press an empty spot on the home screen, then
  Edit, Add Widget, search "hyPer" and tap the result by coordinate (a label
  match hits the app icon); a swipe on the size carousel can pick the
  preview up and drop it on the home screen, so add one size at a time.
- Request deadlines: start Metro with `EXPO_PUBLIC_HYPER_PREVIEW=0` and
  `EXPO_PUBLIC_SUPABASE_URL` pointing at a local server that accepts connections
  and never answers, then launch with `-hyperAction probeTimeout`. Metro should log
  `status=0` after about 30 s.
- Debug and Release builds share prebuilt React Native, Hermes and Expo frameworks.
  Run one build at a time, and run `native/scripts/use-rn-core.sh Debug|Release`
  before a build whose configuration differs from the last one or after
  `pod install`; otherwise a build can fail to link or crash at launch.
- Sign-in and real data: never test against production without the owner's
  approval. Run a local backend with `supabase start` from a scratch workdir
  holding `supabase/schema.sql` as its one migration, grant table access to the
  `authenticated` role there (newer local stacks no longer do), create a test
  user through the local auth admin API, and point Metro at it with
  `EXPO_PUBLIC_HYPER_PREVIEW=0`, `EXPO_PUBLIC_SUPABASE_URL` and the local anon key.
- TestFlight: `scripts/ship.sh` (the ship bot's script, from main) builds this
  app as `app.hyper.mobile` through [native/fastlane](../../../native/fastlane/Fastfile):
  the next TestFlight build number, a clean prebuild, an App Store archive,
  [check-release.sh](../../../native/scripts/check-release.sh) (bundle and
  extension IDs, build numbers, production host, no local backend), upload.
  Every upload needs the owner's approval.
- Real-account phone builds: `native/scripts/build-phone.sh [device-id]` builds
  Release against production (the Supabase URL and anon key come from the main
  checkout's `.env`, only inside the build), checks that the bundle has the
  production host and no local test backend, and with a device id
  (`xcrun devicectl list devices`) installs and opens it. Ask the owner before
  installing. A locked phone refuses the launch, but the install lands. Run
  `use-rn-core.sh Debug` before the next simulator build.
- `HYPER_APP=release` builds the released app, which installs over hyPer on
  the phone; without it, the test app installs beside it. Signing follows
  [the iOS workflow](../ship-ios/SKILL.md). A simulator run does not prove device
  behaviour, haptics or performance.
