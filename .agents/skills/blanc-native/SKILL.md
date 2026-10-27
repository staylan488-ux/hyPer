---
name: blanc-native
description: Build or change hyPer's React Native app in native/ with the approved Blanc design, the shared ../src logic, and its simulator checks.
---

# Blanc native app

`native/` (Expo SDK 58, Expo Router) is the full native rebuild approved on
2026-10-26. It replaces the Capacitor web app screen by screen; see
[the rebuild plan](../../../docs/plans/2026-10-26-native-blanc.md) for
milestones and [the parity inventory](../../../docs/plans/2026-10-26-native-parity-inventory.md)
for what each screen must keep. Blanc is approved: do not explore new directions
for native work, and do not apply the web app's Studio/Metal rules here.

## Architecture

- Reuse, don't copy. Stores, data access, nutrition and training rules come from
  `../src` through `@/…` ([Metro config](../../../native/metro.config.js)); native
  code imports its own files as `~/…`. Logic that lives inside a web component
  moves to `src/lib` first, then both apps import it.
- [Platform swaps](../../../native/src/platform/) replace the few shared modules that
  cannot run in React Native: the Supabase client, native bridge, OAuth, preview
  flag, haptics, keep-awake, rest notifications, the workout Live Activity,
  focused-field commit, app visibility, plus Capacitor shims. Add a swap rather than importing React Native
  into `src`. TypeScript mirrors the swaps in `native/tsconfig.json` paths.
- Shared code that reacts to the app coming back or going away uses
  `@/lib/appVisibility`, never `document`; the native app backs it with AppState.
- The native Supabase client keeps the web client's safety: `timedFetch`
  deadlines, refresh diagnostics and the shared `authResume` steps. Its session
  lives in the Keychain through `native/modules/hyper-keychain`, which writes the
  Capacitor app's items so cutover keeps people signed in.
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
- Preview mode is the default: the shared stores run on the in-memory sample
  backend. `EXPO_PUBLIC_HYPER_PREVIEW=0` with `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` uses the real project.
- Use Apple's components before drawing your own: native stack (large titles,
  swipe-back, `formSheet` with detents), NativeTabs with the BottomAccessory for
  the live workout, header items with SF Symbols, Expo UI SwiftUI controls,
  `expo-glass-effect`, `expo-haptics`, `ActionSheetIOS`, `Alert`.

## Design

- [Tokens and type roles](../../../native/src/theme/blanc.ts): the system font only.
  Section 20/600, title 24/600, body 17, secondary 15, footnote 13, Menlo 12 for
  label details; big figures in SF Pro Thin (weight 200, tabular digits).
- Chalk ground, white labels, black ink, graphite for secondary text. No accent
  colour; red only for live state, errors, over-limit and the brand P.
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
- Per-movement actions live in one sheet (`native/src/app/movement.tsx`), opened
  from ⋯ on the current card, a finished movement's row, or a long press on any
  row: logged sets to correct (never starts rest), the set count from 1 to 12
  whatever the program says (the owner's call on 2026-10-26; the web keeps to
  the program's range; only unfinished sets are removed), the note, and swap
  for this workout or switch back. Tapping an unfinished row still makes it
  the next movement.
- Rest: the timer button in Train's header opens the rest sheet to start a rest
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
  notification to fire. In the app, rest ends with a haptic and the sound, no
  banner. The shared `restTimerWorkoutGuard` clears a rest whose workout ends
  elsewhere and on sign-out. Card updates go through the shared ordering rules
  in `src/lib/workoutActivitySync.ts` (also behind the web shell's card).
- The Live Activity is SwiftUI in a widget extension, added on prebuild by
  [plugins/withHyperWidgets.js](../../../native/plugins/withHyperWidgets.js)
  from [targets/widgets](../../../native/targets/widgets/). The card's data,
  `WorkoutActivityAttributes`, has one definition in
  `native/modules/hyper-activity/ios`, compiled into the app's module and copied
  into the extension; ActivityKit matches the two by name and fields. The card
  uses Blanc's tokens and the P's font (bundled into the extension). Prebuild
  with `--clean` after adding or removing extension files. Milestone 8's run
  card and home-screen widgets join the same extension.
- Motion is native transitions plus Reanimated springs for press feedback and
  the tally. Never scroll a large-title screen programmatically to "the top":
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
button becomes Retry. Food saves use the shared helpers. Check the parity
inventory before rebuilding a flow.

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
- Real-account phone builds: `native/scripts/build-phone.sh [device-id]` builds
  Release against production (the Supabase URL and anon key come from the web
  app's `.env`, only inside the build), checks that the bundle has the
  production host and no local test backend, and with a device id
  (`xcrun devicectl list devices`) installs and opens it. Ask the owner before
  installing. A locked phone refuses the launch, but the install lands. Run
  `use-rn-core.sh Debug` before the next simulator build.
- Phone installs use bundle ID `app.hyper.native` until cutover; signing follows
  [the iOS workflow](../ship-ios/SKILL.md). A simulator run does not prove device
  behaviour, haptics or performance.
