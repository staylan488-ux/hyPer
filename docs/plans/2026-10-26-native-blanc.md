# Native rebuild in Blanc

Recorded 2026-10-26 (Pacific). The owner said they have never liked the UI after
months of tweaks, approved the **Blanc** direction from the
[Native Reset board](https://claude.ai/artifact/BpCMr6sj8G1i18zFP1atkk), and set the
goal as a **full native app**, not a patch of the web app.

Blanc is Apple's structure with quiet white labels on a chalk ground, SF Pro with
thin figures, and one mark of hyPer's own: the set tally (strokes in groups of
five, closed with a diagonal), also used for the app icon. The owner's references
(Maison Margiela's restraint, Apple's clarity) are inspiration only. The first
draft borrowed Margiela's four stitches and circled numbered label; the owner
ruled out copying existing designs, so both were replaced by the tally.

## Why native

The audit of origin/main (af16add) found that most of the "website" feeling is
behaviour, not looks: screens swap instead of sliding, there is no swipe-back,
text is selectable, the keyboard shows the web accessory bar, sheets are drawn by
the web view, and only the tab bar, rest dock and toasts were native overlays. Five
stacked design systems (Studio, Luminous, Kinetic, Metal, Native Frame) had left
32 text sizes, 86 colours and 11 weights. A new visual layer on the web view would
have repeated that pattern.

## Approach

- **React Native + Expo (SDK 58)** in `native/`, using Apple's own components:
  native stack with large titles and swipe-back, NativeTabs (iOS 26 glass tab bar)
  with a BottomAccessory for the live workout, form sheets with detents, SF Symbols,
  Expo UI SwiftUI controls, haptics.
- **Reuse the tested logic.** `native/metro.config.js` resolves `@/…` to `../src`,
  so the stores, data access, nutrition and training rules run unchanged. A few
  browser- or Capacitor-only modules are swapped for `native/src/platform`
  versions (Supabase client, native bridge, OAuth, preview flag, Capacitor shim);
  `import.meta.env` is rewritten at build time and localStorage is provided by
  Expo SQLite. The web app keeps working from the same `src`.
- **Preview first.** The app starts in preview mode: the shared stores run against
  the in-memory sample backend from `src/preview`, so screens can be built and
  tested without signing in or touching real data. Real accounts are a milestone.
- **Separate app until parity.** Bundle ID `app.hyper.native` ("hyPer Native")
  installs beside the current app. At cutover it takes over `app.hyper.mobile`, so
  the App Store listing and TestFlight group stay the same.

## Milestones

1. **Foundation (started 2026-10-26).** Blanc design system, tab and stack shell,
   Today, live workout (log set, RPE, rest, change movement, finish with the tally
   summary), Fuel day, Log food sheet (saved and USDA search), basic You. Simulator
   build and phone install.
   Brand (2026-10-26, the owner chose direction C on the
   [mark board](https://claude.ai/artifact/P393qgKxM7heBwoRKZRhf1), with a longer
   hold on the word): the red italic P (Fraunces, subset to five glyphs, OFL) is
   the app icon (light, dark and tinted) and sits in Today's top-left corner; the
   tally stays for set progress. On a cold launch the P blooms, "hyPer" unfolds
   out of it and holds, folds back, and the P flies to its corner as the app
   rises in. The launch screen is plain chalk so the intro starts seamlessly.
2. **Real accounts.** Email and Google sign-in (system web-auth sheet + PKCE), secure
   session storage, offline restore. Decide with the owner whether testing uses a
   separate account first.
   Safety work done first (2026-10-26):
   - The native Supabase client has the web client's request deadlines
     (`timedFetch`) and refresh diagnostics, and runs the shared `authResume`
     steps on iOS app state. In the simulator, a request to a server that never
     answers failed at 30 s with status 0 instead of hanging.
   - Native versions replace the shared haptics, keep-awake, rest-notification
     (a no-op until milestone 3) and focused-field wrappers, and the status bar
     import is shimmed. Shared hooks learn that the app came back or went away
     through `src/lib/appVisibility.ts`, which the native app backs with
     AppState (Today refresh, WHOOP foreground sync, program draft autosave).
     The run tracker stays web-only until milestone 8.
   - The native app keeps its own scheme `hyper-native` until cutover. Its
     bridge supplies `hyper-native://auth/callback`, which the shared callback
     parser then accepts.
   Sign-in built (2026-10-26, not yet on the owner's phone):
   - Sign-in screen with the web form's rules and words (email and password,
     create account, verification resend, existing-account prompt), Google and
     Apple through iOS's web-authentication sheet with PKCE, an offline screen
     for a saved session without a network, and sign-out in You.
   - The session lives in the Keychain through `native/modules/hyper-keychain`,
     which writes the web app's items (service `<bundle ID>.auth`, account =
     storage key, after first unlock, this device only), so cutover keeps people
     signed in. The shared `nativeSecureStorage` logic (timeouts, cache,
     sign-out tombstone) now takes its Keychain as a parameter.
   - After sign-in the tab layout loads the account like web Today (program,
     workout, targets, volume, mode, nutrition profile, today's food) through
     the shared `useTodayRefresh`.
   - `crypto.getRandomValues` and SHA-256 `crypto.subtle.digest` come from
     expo-crypto; without them Google and Apple sign-in failed to start.
   - Checked end to end in the simulator against a local Supabase backend (the
     reference schema, a throwaway test account): sign in, relaunch still
     signed in, start a session and log a set (saved), sign out, relaunch still
     signed out; the Google sheet opens and closing it shows nothing.
   Done with the owner's approval (2026-10-26):
   - `hyper-native://auth/callback` added to the production project's Auth
     redirect allow-list (Hypertrophy-App; 31 URLs before, 32 after, nothing
     else changed). It is also the email confirmation return.
   - A Release build pointed at production is on the owner's phone. Signing in
     there, and Google or Apple end to end, are the owner's checks.
   Still later:
   - WHOOP connect waits for cutover: its function accepts only
     `app.hyper.mobile://settings`. Health permission and Live Activities are
     granted again under the final bundle ID.
   Earlier: `crypto.randomUUID` (expo-crypto), retry-safe food entry ids, the
   session user id and the day's meal groups.
3. **Train complete.** Start/schedule, flexible mode, supersets, drag reorder with
   restore on failure, session swap and switch back, notes, add/remove sets and
   movements, editing logged sets, rest Live Activity.
   In-workout essentials built first (2026-10-26, the owner's pick): a movement
   sheet to correct a logged set, add or remove sets (1 to 12, past the
   program's count, at the owner's request), keep a movement note and swap a
   movement for this workout or switch back; a rest sheet from the timer button
   in Train's header starts a rest without logging a set and sets each
   movement's rest length (shared with the web). Session order, swaps and set ranges now come from the shared
   `src/lib/sessionPlan.ts` (the web Train page uses it too, unchanged in
   behaviour), and later sets start from the set just logged, as on the web.
   Rest on a locked phone next (2026-10-26, the owner's pick): the web's
   "Rest over" notification, pause and resume, +30 s, and the workout Live
   Activity on the lock screen and in the Dynamic Island, as SwiftUI in a widget
   extension that `native/plugins/withHyperWidgets.js` adds on prebuild. The
   rest is the web's stored rest session (`src/lib/restTimer.ts`) and the card
   follows the shared ordering rules in `src/lib/workoutActivitySync.ts`.
   The rest of Train (2026-10-27), by the web's rules: Train before a session
   shows today's card from the schedule (shared with Today) and every other
   day to start; a schedule sheet sets Day 1 and the rhythm (the web's
   editor, saved through the shared `buildPlanSchedule`); a header menu holds
   the schedule and the training mode (program days or flexible sessions,
   until Program arrives in milestone 6). Flexible sessions are named or
   started from a quick start, built with Add movement, paired as supersets,
   renamed, and can be kept as a quick start on finish. Supersets in either
   mode alternate A1, B1, A2 and rest after B, through the shared
   `supersetFlows` and `supersetLogBlock` (the web page uses them too). A
   reorder sheet drags movements with iOS's own list handles, pairs moving as
   one, and puts the order back if the save fails. Adding and removing
   movements stays a flexible-session feature, as on the web.
4. **Fuel complete.** Barcode (VisionKit), photo and describe analysis, manual entry,
   build a meal, edit/delete with swipe actions and menus, time picker, saved
   meals, month view.
   Built 2026-10-27: the web logger's food rules now live in `src/lib` and both
   apps call them; the Fuel tab (week strip, month sheet, meals with swipe and
   hold menus, meal ⋯ menu), the Log food sheet (Saved, Search, Scan through
   the `hyper-barcode` VisionKit module, Manual with Describe with AI, Photo,
   review with iOS date and time pickers, Build a meal). Left out on purpose:
   the hosted Gemini mode and Describe amount (production uses the worker),
   drag moves (menus instead).
5. **History and Progress.** Calendar, day ledger, editing past workouts and
   nutrition, activities and WHOOP merge, charts, volume map and trends.
   Built 2026-10-27: History from Train's header (paging month calendar, day
   ledger, a past workout to correct, extend, reorder, annotate or delete,
   activities with merge and WHOOP stats) and Progress from Today (muscle
   figure, muscles by coaching priority, training time, last week's eating).
   Past nutrition is edited in Fuel, as on the web. The rules moved to
   `src/lib/historyMonth.ts`, `volumeCoaching.ts` and `trainingHours.ts`. The
   owner wants to view, edit and delete past workouts here, including a
   set-less test workout now in their account (noted 2026-10-27).
6. **Program.** Programs list, split editor (drag reorder, multi-add picker), schedule.
   Built 2026-10-27: Program from Train's ⋯ menu (training mode, programs
   with a view, swipe and hold menus, quick starts), the shared editor in a
   page sheet (chooser, days, exercises, sets and reps, reorder with iOS's
   handles, multi-add and custom exercises, Undo, unsaved-edit questions and
   device draft), and the plan-start question. The page's rules moved to
   `src/lib/programSummary.ts` and `programQuestions.ts`; the schedule sheet
   came with milestone 3.
7. **You.** Profile, targets and calculator, coach, saved meals, food analysis
   worker, connections (WHOOP OAuth), Health weight sync, appearance, adaptive
   scheduling.
   Built 2026-10-27: You (name, body weight with a 30-day line and Log,
   targets, saved meals, food analysis, connections, appearance menu,
   adaptive scheduling switch, about), Body weight (trend, 3-week rate,
   90-day chart to tap or hold, recent weigh-ins with swipe to delete typed
   ones, units), Targets (edit sheet, one-page calculator, coach on the Mac
   worker, resume adaptive), saved meals (swipe Edit and Delete; a built meal
   opens the meal builder), Mac worker, WHOOP and Apple Health (new
   `hyper-health` module, HealthKit entitlement), account and sign-out. The
   web page's rules moved to `settingsUx`, `bodyWeightSummary`,
   `nutritionWizard`, `whoopStatus`, `healthWeights` and `foodTrialUsage`.
   Left out on purpose: You's search (a short list needs none). Start a run
   arrived with milestone 8.
8. **Run tracker and widgets.** Port the Swift run, Live Activity and widget targets
   as Expo modules and config plugins.
   Built 2026-10-27: the Capacitor recorder is `native/modules/hyper-run` (same
   calls, events, storage keys and trace folder, so the shared
   `nativeRunSource` and `useRunTracker` run unchanged and a run carries over
   at cutover), plus native lap and sprint tones that mix over music with the
   screen locked. The run screen (`native/src/app/run.tsx`, from Train's ⋯
   menu and You) sets up, runs and saves a run with the web's rules, which
   moved into `src/lib/runDisplay.ts`. The run's Live Activity (Split, Rest
   and Finish on the lock screen, Finish asking twice) and two home-screen
   widgets, Fuel (calories and protein left, also on the lock screen) and
   Training (today's session and the days ahead), joined the widget
   extension. Widgets read a snapshot the app writes to the App Group
   `group.app.hyper` (`native/modules/hyper-widget-data`); signing out clears it.
9. **Parity check and cutover.** Walk the parity inventory, switch the bundle ID,
   TestFlight, then retire the Capacitor app. Each release and production step needs
   the owner's explicit approval.

The parity inventory (`docs/plans/2026-10-26-native-parity-inventory.md`) lists
every screen, flow and rule the native app must keep.

## Risks

- **Data integrity.** Set and food saves reuse the shared code, so its retry and
  recovery rules carry over; logic still living inside web components must move to
  `src/lib` before reuse rather than being copied (USDA food creation and the
  rest of the food logger's rules moved there in milestone 4).
- **Auth.** No backend or schema change is planned; the native sign-in must keep
  session restore and offline behaviour identical.
- **Native ports.** Run tracking, Health, barcode and Live Activities are Swift
  today and become Expo modules; each needs device testing.
- **Two apps during the rebuild.** Shared-logic fixes reach both; UI fixes go to the
  native app only.
