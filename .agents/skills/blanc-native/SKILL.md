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
  need the phone: the Supabase client, native bridge, OAuth, preview flag,
  haptics, keep-awake, rest notifications, the workout Live Activity,
  focused-field commit, app visibility and run cues. The shared file stays as
  a default for tests and type-checks (most do nothing) and must keep the
  exports shared code imports; Metro resolves it before swapping it. The
  bridge's `NativeHealth` is `native/modules/hyper-health` (HealthKit body
  weight) and `NativeRun` is `native/modules/hyper-run` (the GPS recorder), so
  `hasNativeHealth()` and `hasNativeRun()` are true here while `isNativeIOS()`
  (the retired Capacitor shell) stays false. Add a swap rather than importing
  React Native into `src`. TypeScript mirrors the swaps in
  `native/tsconfig.json` paths.
- Shared code that reacts to the app coming back or going away uses
  `@/lib/appVisibility`, never `document`; the native app backs it with AppState.
- The native Supabase client keeps the web client's safety: `timedFetch`
  deadlines, refresh diagnostics and the shared `authResume` steps. Its session
  lives in the Keychain through `native/modules/hyper-keychain`, which uses the
  Capacitor app's items (service `<bundle ID>.auth`), so the 2.0 update kept
  people signed in.
- Auth uses the shared `authStore` and `authScreen` rule; the root layout guards
  the app, sign-in, new password and offline screens with `Stack.Protected`. A
  password reset link signs in with `PASSWORD_RECOVERY`, which shows New
  password before the app. A link that fails says so on sign-in
  (`native/src/lib/authLink.ts`). Delete account (You › Account) calls the
  `delete-account` Edge Function, then signs out locally. After sign-in the
  tab layout loads the account (`native/src/lib/accountData.ts`).
- The launch copy ([launchCache](../../../native/src/lib/launchCache.ts), rules in
  [launchSnapshot](../../../native/src/lib/launchSnapshot.ts)) keeps the last
  program, quick starts, the week's volume, the target, the profile and today's
  food for the signed-in account in expo-sqlite's localStorage (one
  `hyper-launch:<part>` key per part), so a cold start draws them the moment
  sign-in is restored and the account load refreshes them in place. It never
  sets a store's loaded marker, never feeds a widget or adaptive-target write,
  never keeps the live workout (only whether one was live, so the plan card
  waits for the workout read), saves a part only from this launch's reads or
  the person's edits, and never runs in preview. Today's plan-card seed is
  drawn only while its `planBasis` (program days, saved schedule, adaptive
  scheduling) matches the live one; while it shows, the plan's `upNext` stays
  unknown (the Schedule sheet waits for the reads) and the widgets keep the
  plan last written. Fuel's month shows only beside the today figures it was
  saved with (its `dayKey`; Fuel moving to another month removes it), and
  Today shows those figures through `todayTotalsShown` (`todayCopyKey`, the
  copy's own day only, never another day's). Sign-out, another account, a
  launch with no saved sign-in and each new build drop it. While Fuel shows
  the copied month it never makes default meals from the copy
  (`ensureDayGroups` waits for the real read); Log food and Copy to today
  read the day's meals from the server and make any missing ones from
  those. An edit re-reads the month (`editsCopy` in
  `native/src/lib/fuel.ts`). A finished day from the copy says "Trained
  today" at the record's height until History's read brings the record
  (History is never kept). Bump `LAUNCH_SNAPSHOT_VERSION` when a kept type
  changes in a way a screen reads.
- The live workout follows the shared session plan rules in `src/lib/sessionPlan.ts`
  (order, swaps, set ranges), the same ones the web Train page used. Writes go
  through the store's own actions (`logSet`, `addWorkoutSet`,
  `removeLastUncompletedSet`, `substituteWorkoutExercise`,
  `switchBackWorkoutExercise`); movement notes use the shared `noteAutosave`
  through `native/src/lib/notes.ts`, and a swap waits for pending notes.
- The React Compiler (app.json) memoizes every component it can compile. A value
  read during render from outside React (`new Date()`, `today()`, `isToday`) is
  kept with the component's other values, so a screen or sheet left open past
  midnight keeps yesterday. Read the day through a hook in
  `native/src/lib/accountData.ts`: `useCurrentDayKey` (the clock's day, rendering
  again at midnight) or `useAccountDay` (the day the account data was read
  for), and derive dates from that key so they stay memoized (a `new Date()`
  made on every render undoes the memo around it). A ref written inline in JSX
  drops the memo around it; write it through a stable callback. A test runs a
  file as compiled with `loadNativeModule(file, imports, { compile: true })`.
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
  as "hyPer"). Both carry app.json's version unless `HYPER_APP_VERSION`
  sets another; `HYPER_BUILD_NUMBER` sets the build number. Prebuild with
  `--clean` when switching variant. The URL scheme in JavaScript and Swift
  follows the bundle ID iOS reports (`modules/hyper-keychain/bundle.ts`,
  `WidgetSnapshotStore.appScheme`), never a hard-coded value. Links from
  outside go through [+native-intent](../../../native/src/app/+native-intent.tsx): the email
  confirmation's and password reset's `auth/callback` exchanges its code there.
- Use Apple's components before drawing your own: native stack (large titles,
  swipe-back, `formSheet` with detents), NativeTabs with the BottomAccessory for
  the live workout (it leads with the movement and set and the live clock, and
  steps aside on Today's and Train's roots, which show the workout themselves,
  except on Train during a rest; tab pages size their foot from
  `useWorkoutBarShown`), header items with SF Symbols, Expo UI SwiftUI controls,
  `expo-glass-effect`, `expo-haptics`, context menus, `ActionSheetIOS`,
  `Alert`.

## Design

- [Tokens and type roles](../../../native/src/theme/blanc.ts): the system font only.
  Section 20/600, title 24/600, body 17, secondary 15, footnote 13, Menlo 12 for
  label details; big figures in SF Pro Thin (weight 200, tabular digits).
  Figures at rest (Today's and Fuel's 56 pt kcal, Body weight's 56 pt and
  You's 44 pt weight) use `restingFigure` (proportional digits, so a "1"
  leaves no gap) and `figureLead` (pulls the first digit's ink onto the text
  edge); counting figures keep tabular digits. Train's 72 pt weight and reps
  sit on a ruled line (ink while typing) with Menlo "last 60" captions under
  each field, shown only while the field differs from last time (the line's
  height stays); the rep target is in ink on the line under the movement, and
  the card's notes sit at that line's 15 pt graphite (one quiet level). The
  card's whole header fades under the compact bar before the bar names the
  movement. Every text field draws its caret and selection in ink
  (`selectionColor={c.ink}`).
  Text fields take `field` (one line, with `lineBreakModeIOS="tail"`) or
  `fieldLines` (wrapping), never body: React Native reuses a field's native
  view, and iOS drew the new placeholder with the last one's letter spacing (a
  big figure's, squeezing the letters together) unless the field names its own
  (`tests/nativeTextFields.test.ts` checks).
- Chalk ground, white labels, black ink, graphite for secondary text. No accent
  colour; red only for live state, errors, over-limit and the brand P, and it
  is one red: `live` and `brand` share a value in each palette (the P's brick
  in light; the design council's call on 2026-11-05).
  Over-limit follows the saved nutrition goal through the shared
  `warnsOverTarget` (`src/lib/fuelSummary.ts`): protein past target is never
  red, and while bulking or lean bulking nothing past target is (calories read
  "extra", the line stays full in ink); cutting, maintaining or with no goal
  saved, calories, carbs and fat past target turn red (the owner's call on
  2026-10-30).
- The white [Label](../../../native/src/components/Label.tsx) is the one container
  (10 pt continuous corners). Sections are separated by space, rows by hairlines
  with an iOS press highlight. Ink capsules are primary actions; quiet fill
  capsules are secondary. A chosen chip is lifted on the fill like a segmented
  control's choice (label colour, hairline edge), so a sheet's one filled shape
  stays its main button. One way for each repeated idea: the live workout's
  clock is `LiveClock` (live dot, ticking m:ss) everywhere; a value against its
  target reads "130 of 190 g"; in-content "more" is a bare graphite ellipsis;
  in-content adds read "+ Verb"; chart labels are the system font with tabular
  digits (Menlo only under Train's figures and in expanded Progress rows). Switches are ink
  (`switchOn`), never iOS green; in dark they turn over like the ink capsule
  (light track, dark knob, `switchThumbOn`), so on never reads as grey. One-line rows are 52 pt in regular weight; a
  row with a detail line is 60 pt with a medium title and its value on the
  title's line. Sheets' round buttons (`GlassButton`) are a quiet fill in every
  sheet.
- The brand mark is the red italic P ([BrandMark](../../../native/src/components/BrandMark.tsx),
  Fraunces Mark Medium Italic, approved 2026-10-26): the app icon, Today's top-left
  corner and the sign-in and offline emblem. Fraunces appears nowhere else.
- The set [Tally](../../../native/src/components/Tally.tsx) counts sets like a
  paper training log: one stroke per set in groups of five, logged strokes in
  ink, the next set's stroke taller (about half again) and in the live red,
  still to do in `mark`, a finished group closed with a diagonal. One grammar
  everywhere: a finished movement recedes through its name, never its strokes.
  Use it for set progress and finished-session summaries only, never as a
  logo or decoration.
- Data marks (past bars, weigh-in dots, a rail's in-range band, the target's
  dashes) are `mark` at full strength, 3:1 or more in every palette; the
  current period is ink and over is red. No opacity tricks: hierarchy comes
  from size and weight. Chart keys are left-aligned with the card title.
  Progress's nutrition charts show the seven days before today, named by
  their dates ("Oct 30–Nov 5"), with the average of the logged days; their
  targets' figures sit in a column beside the bars, as Body weight's scale
  does, and one key names the dashed line. Bar charts read one bar at a
  time like Body weight (tap, tap again to let go, or hold and slide): the
  header shows that bar's date and value and the bar turns ink; they are
  adjustable for VoiceOver. A chart still loading shows one graphite spinner
  in its space, and a failed first read a short line with a quiet Retry. The
  hollow ring ("No entry") appears only where an unlogged day isn't zero
  (Nutrition); an untrained week is 0 h, a 2 pt tick in `mark`. Training time
  dates its first and last week only. The muscle figure pair fills about 70% of its
  card: below range a graphite 1.25 pt outline, in range `mark`, over red.
  Day marks (Fuel's week strip, the month sheet) are 28 × 4 pt, ink over
  `mark`, red past target only where the goal warns, nothing on an unlogged
  day, and the selected day keeps its mark. Every week and calendar starts on
  Monday (`TRAINING_WEEK`, M T W T F S S). Bars appear at their value and
  animate only changes. A row's detail passes parts when its end matters
  (time, Estimate), so only the first part (the amount) truncates.
- Every screen section is a `Section` header over one Label; no footnote
  group labels. Today's sections are named for the screens they open (Fuel,
  Progress), and its session card has one layout live and done (header with
  day and clock or length, tally, title line, quiet line, action). Fuel's
  figure, bar and macros are one Label. Session complete is top-anchored:
  the day as the large title, one quiet line ("Session complete · day ·
  time", or "5 of 9 sets · …" when short, never "complete"), then the tally,
  "N sets beat last time" in ink, Volume, Time and Best set. A card that opens a screen shows a chevron (on a figure card,
  on the figure's line) and uses the `pressed` fill. A segmented control's
  `Host` matches its contents vertically only, with an explicit width.
- Inspiration, never imitation: do not reproduce another brand's marks, labels,
  layouts or signature details (the owner ruled out copying Maison Margiela's
  stitches and numbered label on 2026-10-26).
- No costume luxury: no serif type outside the P, no Roman numerals,
  faux-editorial copy, glow, 3D or particles. Sentence case. Touch targets at
  least 44 pt.
- Accessibility (2026-11-04): the app works with VoiceOver, every text size up
  to AX5, Increase Contrast and Reduce Motion, and looks exactly the same at
  iOS's default settings. Keep it that way in new work:
  - A Row's detail line in parts ("6:58 AM · 16 min · 0.40 mi") stacks one
    part per line at these sizes, so no figure breaks from its unit.
  - Text grows along each role's iOS text style ([textSize](../../../native/src/theme/textSize.ts),
    through BlancText); big figures stop at 1.3×. Layout for the accessibility
    sizes goes behind `useLargeText()` from
    [accessibility](../../../native/src/lib/accessibility.ts) (stack side by
    side text, wrap, lift `numberOfLines`, `minHeight` for `height`, scroll a
    `fitToContents` sheet), so the default code path never changes.
  - VoiceOver reads one stop per fact, in words: BlancText speaks plain string
    children through `speak()` ("8–10 reps · 135 lb" as "8 to 10 reps, 135
    pounds"); labels holding a clock use `spokenClock`. Every control has a
    role, a label and its state; a visible label beside a control is hidden
    from VoiceOver; a number between − and + is one adjustable element; long
    press, drag and swipe also exist as custom actions.
  - Status changes a sighted person sees (an error, a save, results, a timer
    ending) are announced with `useAnnounce` or `announce`.
    `accessibilityLiveRegion` does nothing on iOS, and a test forbids it.
    `onMagicTap` does not fire on React Native 0.88's New Architecture (its
    native side reads `onAccessibilityMagicTap`), so Train's and rest's Magic
    Tap handlers stay silent until React Native fixes it.
  - Text colours come from `useBlanc()`, which switches to the Increase
    Contrast palettes; never hard-code one. Reanimated follows Reduce Motion
    live; an animation marked `ReduceMotion.Never` needs its own plain fade.
  - `tests/nativeAccessibility.test.ts` checks what it can from the source
    (labels on fields, images and icon buttons, roles on pressables, the
    spoken words, the contrast ratios).
- Restraint over completeness (the owner found the web app bloated: numbers and
  text everywhere). A card carries one title, at most one quiet line and at most
  one action. Leave out zeros, placeholders ("– lb × –") and figures that repeat
  another; add a row only when it changes what the person does next.
- Fuel follows the web logger through shared `src/lib` rules (foodPersistence
  `ensureFoodRow`, saveNutritionEntry, manualFood, barcodeLookup, photoReview,
  nutritionDay, savedMeals, recentFoods, gapPicks, repeatEntries, savedMealFromLog); never copy them into
  `native/`. Log food is one sheet (`native/src/app/log-food.tsx`, parts in
  `native/src/fuel`) with a Search foods field above its Recent and Saved
  segments (typing takes the sheet over; Cancel returns to what was showing;
  matching saved meals list first, then USDA's, and only results for the
  words in the field show) and the
  entry methods Barcode, Manual, Photo and Describe (a symbol over each name)
  as a quiet row under them (`native/src/fuel/EntryMethods.tsx`), a review
  for a chosen food, and the meal builder. Photo and Describe are two doors
  into the one meal view, where a photo and a long description can be
  combined (the owner's call on 2026-11-05): Photo opens the camera at once
  and adds what it takes, Describe puts the cursor in Your meal, and nothing
  is estimated until Analyze meal; only Snap a meal estimates on its own. A
  device set to the worker gets Photo alone. Search stays a food search; with no
  match, or offline, it offers Enter it manually (Manual with the words as the
  name). The
  line under the title says where food goes ("Adds to today", "Adds to
  Lunch"); its menu offers No meal, the day's meals, New meal and New snack
  (on Fuel's day). "No meal" (`NO_MEAL`) names foods outside a meal
  everywhere, and a lone unnamed snack is "Snack" (`nutritionGroupTitle`).
  The line names only where food goes, never a total, in a 44 pt target; it is
  the one meal control (a review's When holds only Day and Time).
  The chosen entry method is lifted like a chosen Chip. No food list carries
  a kcal heading. Recent ends in Build a meal; Saved has no Edit mode (each
  meal swipes and holds for Edit and Delete) and ends in New saved meal. At
  the accessibility sizes only the title, destination and Search foods stay
  pinned. An added photo's corner shows a white ellipsis for its menu. A quick add's tick
  belongs to one day and meal; a failed one says "Couldn't confirm. Tap + to
  try again." and its retry reuses its first entry id, time and meal.
  Fuel's date line opens the month (its chevron says so) and "+" stands alone
  in the bar; a day with food ends on a quiet Log food. Fuel's rows read
  amount · protein · time · source.
  Barcode opens its camera only when Scan barcode is tapped (the owner's call
  on 2026-10-27). Recent opens
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
- Photo's Add photo opens the camera at once, full screen, with no Take
  photo or Choose from library sheet first (the owner's call on 2026-11-05).
  iOS's camera picker has no library button, so the camera is hyPer's own
  ([food-camera](../../../native/src/app/food-camera.tsx), `expo-camera`,
  photos only with no microphone permission), opened through `pickFoodPhoto`
  and `openFoodCamera` (`native/src/fuel/foodCamera.ts`), which settles once
  the screen has gone. Black chrome in either appearance (the dark palette):
  close top left, the flash top right, the shutter centred at the foot and
  the photo library bottom left (iOS's photo picker, which needs no library
  permission; cancelling it returns to the camera). A shot shows Retake and
  Use Photo. Camera access is asked as the screen opens; refused, or with no
  camera (the simulator), the screen says so with Choose from library right
  under the words (and Open Settings when refused); the library button bottom
  left still works, and closing it leaves the reason under Photo.
  A photo already added keeps its own menu (Replace photo, Remove photo).
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
  native app defaults to it (Photo and Describe, Describe amount); with
  Gemini, Manual opens straight on its fields (Describe is the door beside
  it), while the worker's Manual keeps its own Describe with AI estimate; a
  device set to the worker gets the worker's photo view under the same Photo button.
  While a Gemini analysis runs, its buttons give way to the Analysis card
  (`native/src/fuel/AnalysisProgress.tsx`, wording in `src/lib/analysisProgress.ts`;
  the owner's ask, 2026-11-06): the step under way on top with a graphite
  spinner and the time since the tap, finished steps ticked beneath, newest
  first. The steps are the function's own (`progress: true` makes
  `analyze-food-trial` answer with server-sent events, the saved outcome
  last); never invent a step or a timed message. The input tip and an empty
  Photos row step aside so the card stays in view.
- Per-movement actions live in one sheet (`native/src/app/movement.tsx`), opened
  from ⋯ on the current card, a finished movement's row, or a hold (lifted and let go) on any
  row: logged sets to correct (never starts rest), the set count from 1 to 12
  whatever the program says (the owner's call on 2026-10-26; the web app kept
  to the program's range; only unfinished sets are removed), the note, and swap
  or skip for this workout, switch back or bring back. In a flexible session the same sheet pairs
  a superset, unlinks it, or removes the movement (logged sets stay in the
  workout). Last time's note for the movement shows under the
  set card's "Last time" line and in the sheet's Note section. Tapping an unfinished row still makes it the next movement.
- Skip (the owner's call, 2026-11-01): Skip beside Add RPE on the set card, a
  row's swipe, or the movement sheet skips a movement for this workout only.
  It is a `skipped` mark on the session plan item (`skipWorkoutExercise`; sets
  and the program are untouched), shown at once through `usePendingSkips`
  while it saves; a failed save puts it back with an alert. The movement
  stays in the list as Skipped (a tap brings it back as the one up now; Undo
  at the foot does the same for 5 s), its unlogged sets leave the counts and
  never come up next, and a superset partner carries on alone. Finish names
  what was skipped and deletes those unlogged sets (`removeUnloggedSets`)
  before it closes the workout, so History shows what was done; if that
  fails, the workout stays open to finish again. Logged sets
  stay, so beat last time and next time's "Last time" read only logged sets.
  Quick starts and a movement chosen again never keep a skip
  (`withoutSessionMarks`).
- Before a session, Train shows today's [PlanCard](../../../native/src/components/PlanCard.tsx)
  (shared with Today), then every other day to start. Its header menu holds the
  schedule sheet (`native/src/app/schedule.tsx`: Day 1, then either the exact
  training weekdays, a tap per day switching training and rest, or In order;
  saved through the shared `buildPlanSchedule`, which keeps the days picked
  and orders them Monday first, a saved first weekday kept; saving bumps
  `useScheduleRevision` so open screens re-read it; Today's and Session
  complete's week count goes by the days picked, `weekSessionTarget`) and
  Program, which
  holds the training mode and, in Program days with a program, Adaptive
  scheduling. Flexible mode names the session or starts a quick
  start; the session grows with Add movement, the pencil renames it, and
  Finish offers to keep it as a quick start. Adding and removing movements is
  a flexible-session feature, as on the web.
- Supersets in either mode follow the shared `supersetFlows` and
  `supersetLogBlock`: rounds go A1, B1, A2, rest comes after B only, and a set
  out of turn shows why instead of logging. A round waits only for a partner
  set that exists and is unfinished, so the longer movement carries on alone. The one exercise picker
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
- Warm-up and plates (the owner's pick, 2026-11-08): beside Add RPE the set
  card offers Warm-up before a movement's first set (nothing of it logged, a
  barbell or compound movement, a weight with a ramp to it) and otherwise
  Plates on a barbell weight above the bar. Both open one sheet
  (`native/src/app/warm-up.tsx`) at the weight typed: warm-up rows to tick
  off (kept for the launch only, never logged, so they stay out of volume
  and last time), then the working set's plates drawn on a bar
  ([PlateBar](../../../native/src/components/PlateBar.tsx)) with the Bar
  menu (45, 35, 25 or 15 lb, kept per movement on this phone per account).
  The ramp, plates and bar rules are `src/lib/warmupPlates.ts`: plates 45,
  25, 10, 5 and 2.5 lb heaviest first; a barbell ramps from the empty bar
  through about 40, 60 and 80% for 5, 3 and 2, each step moved up to 10 lb
  to need fewer plates; other equipment gets about 50% for 8 and 75% for 4.
- Rest: the timer button in Train's header, or the workout bar tapped during
  a rest, opens the rest sheet to start a rest
  without logging a set, pause or resume it, add 30 seconds, change the
  movement's rest length or end it. The length is set only on the presets
  track (1:00, 1:30, 2:00, 3:00, 5:00, then Custom, chosen for any other
  length; a 44 pt touch band around a 38 pt fill); the big time is display
  only, in proportional digits while idle and tabular while it runs. The
  rest is the web's stored rest session (`src/lib/restTimer.ts`), so it
  survives leaving Train and relaunching. Lengths are kept per movement through
  the shared `src/lib/restPreferences.ts`, as on the web (own length, else the
  last one chosen, else 90 s), and a logged set starts rest at its movement's
  length, except the last set of a program session (nothing left to rest
  for; a flexible session still rests, its next movement comes after).
  Finish asks first unless a program session is fully logged with nothing
  skipped. Whenever the movement up changes, its card scrolls just into view.
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
  in `src/lib/workoutActivitySync.ts`.
- Fuel reminder ([lib/fuelReminder.ts](../../../native/src/lib/fuelReminder.ts),
  rules in `fuelReminderPlan.ts`; the owner's pick, 2026-11-04): off by
  default, an evening time in You (5:00 PM to 11:00 PM, 8:00 PM to start), kept
  on this phone per account. A local notification goes out when a quarter or
  more of today's target is still to go: calories only while bulking or lean
  bulking, protein on any goal ("850 kcal and 40 g protein to go", or "Nothing
  logged today"), and none without a saved target. Being past a target is
  never mentioned. One calendar request per day for today and the next two,
  handed over again whenever today's food, the targets, the goal, the setting
  or the permission change and on every return to the front; at most one a
  day (a per-account record). Logging enough cancels it and dismisses a shown
  one; switching off, sign-out and the sign-in screen clear everything. In the
  app it goes quietly to Notification Center (the one handler is in
  `platform/restNotifications.ts`). A tap posts a Log food press (a Fuel
  press when today's reminder names close-the-gap picks, below) and its Snap
  a meal button (category `fuelReminder`) a Snap a meal press, so both run like
  the quick actions below. The root layout reads taps from launch
  (`followReminderTaps` beside `takeNativeLaunch`), never the tabs, so a tap
  made on the offline or sign-in screen keeps the press rules and never opens
  on a later visit. The trigger has no time zone, so after travel it follows
  the new zone from the next return to the front.
- Close the gap (the owner's pick, 2026-11-08): on today, from 6:00 PM (or
  the Fuel reminder's time when it is on and earlier), when today is well
  short by the reminder's own rule (`fuelShortfall`), Fuel shows a Close the
  gap section under the day's card ([GapPicks](../../../native/src/fuel/GapPicks.tsx)):
  the set of one to three usual foods (eaten on two days or more of Recent's
  four weeks, never hidden ones) that best covers what's left at the amounts
  usually logged (rules in `src/lib/gapPicks.ts`, phone glue in
  `native/src/lib/closeGap.ts`). While gaining it aims at the calories (a
  little past is free) with the protein as a bonus; otherwise at the protein,
  within the calories left. Nothing shows with nothing logged or no saved
  target. + logs a pick now at its usual amount into the meal that fits the
  time, its tick takes it out, a tap reviews it in Log food (`review=1`,
  handed over by `offerReview`), and a swipe or hold hides it here and in
  Recent. Once touched the card holds still until Fuel is left. Today's
  reminder names the same picks ("… would cover it.") from Recent's kept logs
  (`fuel/recent.ts`, read at most every ten minutes while the reminder is on),
  and its tap then opens Fuel on today (the JavaScript-only `fuel` press).
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
  and holds the training mode and Adaptive scheduling. Editing goes through the shared
  `splitEditStore` in the `program-edit` page sheet (its own stack: the
  program, then a day); `usePreventRemove` in its layout asks before
  unsaved edits go, through `discardSplitEdit(confirmAlert)`. Sets and
  reps (`program-exercise`), reorder (`program-reorder`) and the picker
  (`swap` with `program=add|swap|superset`) are root sheets over it and
  change the draft only; nothing is written until Save or Create.
- History draws strength sessions, finished or live, as a tally (the live
  one's next stroke red, its state in words beside the live dot); a finished
  session's reveal stays within 700 ms with one haptic at the end.
- History lives in Train's stack (`train/history`, `train/past`,
  `train/activity-view` for an activity's numbers, notes and a run's splits)
  and Progress
  in Today's (`today/progress`). Past-workout edits go through
  `editPastWorkout` in [lib/history.ts](../../../native/src/lib/history.ts),
  which runs the web's edit protocol one edit at a time per workout (the set
  editor's weight goes Next to reps). History's month pages stop at the
  current month, as Fuel's do, and follow midnight (`useCurrentDayKey`).
  Program view's rows open that day in the editor (`editProgramDay`), or the
  program alone while unsaved edits kept on the device wait for Restore or
  Discard. Delete a
  workout only after `confirmDeleteWorkout` asks. The muscle figure draws the
  shared maquette shapes with react-native-svg.
- You (milestone 7) is the You tab's stack (`you/weight`, `weigh-ins`,
  `targets`, `adaptation`, `meals`, `analysis`, `worker`, `connections`,
  `account`, `about`) plus root sheets (`log-weight`, `targets-edit`,
  `targets-calculate`, `targets-coach`, `saved-meal`). Body weight's chart
  reads 1M, 3M (the default), 6M, 1Y or All on a calendar axis ending today,
  Recent starts at the weigh-in before the figure's (left out with only one)
  and always ends in All weigh-ins (every one, by month, with each month's
  average); You's card reads the default 3M range through
  `weightRangeSummary` ("+0.3 lb/wk since Aug 9"), its sparkline over the same
  days; both come from one paged read of every weigh-in
  (`loadWeights({ all: true })`, rules in `src/lib/weightHistory.ts`), joined
  to the 90-day read that every log and sync repeats. A gain reads like a
  loss, signed and in ink. Screen state shared
  between them lives in `native/src/lib/you.ts`; the rules come from
  `settingsUx`, `bodyWeightSummary`, `nutritionWizard`, `healthWeights`,
  `whoopStatus` and `foodTrialUsage`. The
  calculator and coach hand their numbers to the edit sheet (`stageTargets`);
  nothing is saved until Save there. In the edit sheet a new calorie figure
  carries carbs and fat with it, in their split, so the macros still add up;
  protein never moves, and carbs or fat typed there stay put
  (`rebalanceMacros`; the owner's call, 2026-11-08). Appearance (Automatic, Light, Dark) keeps
  the web's `hyper-theme` key and applies through `Appearance.setColorScheme`
  before the first screen draws. WHOOP connects through iOS's sign-in sheet
  with the return address `app.hyper.mobile://settings` (the only one the
  whoop-oauth function accepts; the sheet catches it, so it never reaches the
  other app). The tab layout runs the shared WHOOP foreground sync and Apple
  Health weight sync.
- Run (`native/src/app/run.tsx`, a full-screen modal from Train's ⋯ menu,
  You's Start a run, or the run card): set up (Long run or Splits, auto-split,
  a simulated route in sample mode), live (the current split's pace, time,
  distance, average; Split, Rest or Resume, and Hold to finish, which fills,
  ticks and ends the run as the finger lifts, so the next screen gets its first
  tap), then the
  finished run to save (to History, opened on the run's day), discard (asks first) or export its
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
  one opens Fuel or Train (`hyper-native://fuel`, `://train`). A tap that
  launches the app is kept through the intro and the account load
  ([launchLink](../../../native/src/lib/launchLink.ts)), and the intro then
  fades without flying the P, since that screen has no mark to land on.
- Snap a meal from anywhere (the owner's pick, 2026-11-04): the Snap a meal
  control (`targets/widgets/SnapMealControl.swift`, iOS 18: Control Center,
  the lock screen, the Action button), the App Shortcuts (Snap a meal, Log
  food, Open Train; `native/modules/hyper-launch/shared`) and the Home Screen
  quick actions (Snap a meal, Log food, Train; app.json) leave a press in
  `native/modules/hyper-launch` (the App Group, one key per app). The app
  takes it at launch, on the module's event and on return to the front
  ([lib/launch.ts](../../../native/src/lib/launch.ts)) and runs it once, when
  the signed-in tabs are up, the intro is gone and the app is active
  (`launchActions.ts`: a minute at most; leaving the app or the sign-in screen
  drops it). JavaScript posts one with `postLaunchPress(action)`. Snap a meal
  opens Log food on AI (Photo for the worker) and the camera once the sheet
  has slid up, and Use Photo analyzes at once. Nothing open is closed: an open
  Log food sheet answers through `sheetSnap` (takes the photo as a new entry
  for now, starts over in place when it holds nothing, otherwise refuses with
  an error haptic and "Finish what's open, then try again." announced for
  VoiceOver). Search's portion read holds a press off (`beginRead`) without
  holding the sheet: closing then still closes, while `beginBusy` lookups ask
  first. A save running (`beginSave`) refuses a press as well, since the tabs
  hold still until it lands, and so does a quick add left unconfirmed (its
  retry would close with the meal). Camera access turned off shows Open Settings
  under the error. Train only switches tabs when nothing covers them and never
  starts a workout. One camera or picker at a time (`pickFoodPhoto`), none while
  a photo's menu is up (`showPhotoChoices`). Intents that open the app
  compile into the app (the control's also into the extension), App Shortcuts
  only into the app, never into a pod.
- First-time and failure paths (UX pass, 2026-11-07): Today's No program yet
  Create opens the new-program questions at once; You's empty weight card
  opens Log weight; a workout read that failed shows "Couldn’t load your
  plan" with Retry rather than an empty place; sign-in and food analysis say
  common failures in plain words (`authErrorWords`, foodTrial's `outcome`),
  never a bare status code. Opening the workout from Today, the workout bar
  or Progress goes through `openTrain` (Train's stack popped to its top, never
  stacked over History). Done on Session complete opens the tab bar out
  (`useTabBarExpand`), since iOS keeps it shrunk from the workout page.
  Undo and second chances: deleting a Fuel entry shows an Undo bar over the
  tab bar (5 s, 20 s with VoiceOver; `restoreEntry` writes the row back,
  then reads the month and today's totals again). Undo stays, busy, until the
  write is confirmed. A failure's alert offers Try again for that entry only
  (an Undo a newer delete replaced just says it failed). A delete that
  answered with a failure keeps its Undo, since the answer may have been lost
  after the row went; its alert says the delete couldn't be confirmed (never
  "Not deleted"), and the store reads the day again to show what is saved.
  Deleting a meal of your own (its foods move to no meal) fails the same
  way: the same alert, and the day's meals and foods read again. The bar never runs out behind any of Fuel's alerts
  (`holdingUndoAlert`: failures and Copy again's question): dismissed,
  whatever it offers then gets its full time again. A quick-add's
  tick takes the food back out on a second tap; its hold menu and VoiceOver
  say Log only before the add and Take it out after, and nothing logs that
  food and meal again while its removal runs. Edit entry closes
  with ✕ and changes the food from its Change food row. Saved meals' + builds
  a new saved meal without logging it. Rest alerts say what they are for
  before iOS's notification prompt (`explainRestAlerts`). Log weight's Day
  (today by default, never later) logs a missed weigh-in at the present time
  of day. On Barcode, Log food's scroll keeps room for Look up barcode above
  the number pad's bar (a button under that bar takes no taps), and the
  lookup adds no second tap to the capsule's own.
- A screen with unsaved edits uses `useLeaveGuard` (`native/src/lib/leaveGuard.ts`):
  closing asks first, and after Discard it steps aside before closing. While
  a save runs, pass `busy` so a close waits for it (Log food claims it for
  each tab's save, apart from lookups). Never
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
- An animated style that Reanimated parses from a string (a shadow, a colour)
  writes its numbers with fixed decimals, as
  [liftShadow](../../../native/src/lib/liftShadow.ts) does. Near 0 JavaScript
  writes "1.6e-7", Reanimated's parser throws on it, and a release build
  closes (the reorder crash of 2026-10-31); a debug build shows a red screen
  only on the rare frame that hits it. Its resting value is written out too
  (an empty shadow, a colour), never `undefined`: Reanimated sends nothing
  for an undefined style value, so the view keeps the last one it drew (a
  dropped row kept its lifted shadow until 2026-11-04).
- The one branded animation is the cold-launch [intro](../../../native/src/components/BrandIntro.tsx):
  the P blooms, "hyPer" unfolds from it and holds (longer while sign-in is
  restored), folds back, and the P flies to the first screen's anchored BrandMark as
  the content rises in, with a soft haptic on landing. Geometry comes from the
  font metrics in `native/src/lib/brandGeometry.ts`. A tap skips it; Reduce
  Motion and scripted dev launches (`-hyperIntro off`, or any `-hyperRoute` or
  `-hyperAction`) leave it out, and so does a press waiting from outside the
  app (a later one hurries it like a tap); a widget or card launch fades it
  in place (`markless`). It never replays on return from the background.
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
  (`xcrun simctl ui <udid> appearance dark`). `-hyperAction launch:snap-meal`
  (or `launch:log-food`, `launch:train`) posts a press as iOS hands one over;
  the simulator has no camera, so Snap a meal's camera screen says "The
  camera isn’t available here." with its photo library button still working
  (`-hyperRoute /food-camera` opens that screen alone). `-hyperAction
  fuelReminder` sets a Fuel reminder a minute ahead and logs what iOS holds. A new local module (such as `hyper-launch`)
  needs `pod install`, which prebuild runs.
- Accessibility: `xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large`
  shows AX5 (`large` is the default) and `xcrun simctl ui <udid> increase_contrast enabled`
  the contrast palette; check every changed screen at both and at the default.
  VoiceOver can't be driven by a script in the simulator: use Accessibility
  Inspector on the Mac, or VoiceOver on the phone.
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
  the next TestFlight build number and version (the last digit up by one each
  ship), a clean prebuild, an App Store archive,
  [check-release.sh](../../../native/scripts/check-release.sh) (bundle and
  extension IDs, build numbers and versions, production host, no local
  backend), upload.
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
