---
name: blanc-native
description: Build or change hyPer's React Native app in native/ with the approved Blanc design, the shared ../src logic, and its simulator checks.
---

# Blanc native app

`native/` (Expo, Expo Router) is hyPer's iPhone app. Blanc is the approved
design: do not explore new directions for native work.

This file holds what the code cannot tell you: the owner's decisions, traps
that have cost time before, and how to check work in the simulator. For how a
feature works, read its code and tests. Do not add feature descriptions here.

## Architecture

- Reuse, don't copy. Stores, data access, nutrition and training rules come from
  `../src` through `@/…` ([Metro config](../../../native/metro.config.js)); native
  code imports its own files as `~/…`. `src` holds no UI. Before rebuilding a
  flow, read the shared rule in `src/lib` it uses and the tests that cover it.
- [Platform swaps](../../../native/src/platform/) replace the shared modules that
  need the phone. The shared file stays as the default for tests and
  type-checks and must keep the exports shared code imports. Add a swap rather
  than importing React Native into `src`, and mirror it in
  `native/tsconfig.json` paths. `isNativeIOS()` means the retired Capacitor
  shell and stays false here.
- Shared code that reacts to the app coming back or going away uses
  `@/lib/appVisibility`, never `document`.
- Kept from the Capacitor app so the 2.0 update lost nothing: the sign-in
  session's Keychain items (service `<bundle ID>.auth`), the run recorder's
  UserDefaults keys and the `hyper-theme` key. Do not rename them.
- The launch copy ([launchSnapshot](../../../native/src/lib/launchSnapshot.ts))
  draws a cold start from the last saved data. It never sets a store's loaded
  marker, never feeds a widget or adaptive-target write, never keeps the live
  workout and never runs in preview. Bump `LAUNCH_SNAPSHOT_VERSION` when a
  kept type changes in a way a screen reads.
- The React Compiler (app.json) memoizes every component it can compile. A value
  read during render from outside React (`new Date()`, `today()`, `isToday`) is
  kept with the component's other values, so a screen left open past midnight
  keeps yesterday. Read the day through `useCurrentDayKey` or `useAccountDay`
  ([accountData](../../../native/src/lib/accountData.ts)) and derive dates from
  that key. A ref written inline in JSX drops the memo around it; write it
  through a stable callback.
- `native/modules/hyper-view` reads a view's real window frame from UIKit. React
  Native's own measure does not know where iOS put an item inside a navigation
  bar.
- Preview mode is the default in development builds: the shared stores run on
  the in-memory sample backend. `EXPO_PUBLIC_HYPER_PREVIEW=0` with
  `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` uses the real
  project. A Release build uses the real project unless the flag is `1`.
- Two builds of one app ([app.config.js](../../../native/app.config.js)): the
  test app by default (`app.hyper.native`, installed beside the released app)
  and, with `HYPER_APP=release`, the released app (`app.hyper.mobile`).
  Prebuild with `--clean` when switching variant. The URL scheme follows the
  bundle ID iOS reports, never a hard-coded value.
- The Live Activities, widgets and controls are SwiftUI in one widget
  extension, added on prebuild by
  [withHyperWidgets.js](../../../native/plugins/withHyperWidgets.js). Each
  card's attributes have one definition, compiled into the module, the app and
  the extension; ActivityKit matches the copies by name and fields. iOS runs a
  Live Activity button's intent in the app's process, so those intents compile
  into the app too. Intents that open the app compile into the app, never into
  a pod. Prebuild with `--clean` after adding or removing extension files.
- Notifications are local only: `enableRemoteNotifications: false` keeps push
  out of the entitlements.
- The run screen draws its own top bar. A modal that shows and hides iOS's
  header is rebuilt, which drops the run.
- WHOOP's return address is `app.hyper.mobile://settings`, the only one the
  whoop-oauth function accepts.
- Barcode scanning (VisionKit) and the camera are unavailable in the simulator.
  Pod install needs `LANG=en_US.UTF-8`.

## Design

- Use Apple's components before drawing your own: the native stack (large
  titles, swipe-back, `formSheet` with detents), NativeTabs, header items with
  SF Symbols, Expo UI SwiftUI controls, context menus, `ActionSheetIOS`,
  `Alert`. Reuse the app's own components for an idea that already has one
  (Label, Section, Row, SwipeRow, HoldMenu, Tally, LiveClock, RollingText).
- Type: the system font only, through the roles in
  [blanc.ts](../../../native/src/theme/blanc.ts). Text fields take `field` or
  `fieldLines`, never body: iOS draws a reused field's placeholder with the
  last one's letter spacing otherwise (`tests/nativeTextFields.test.ts`).
- Colour: chalk ground, black ink, graphite for secondary text.
  No accent colour. Red only for live state, errors, over-limit and the brand
  P, and it is one red. Colours come from `useBlanc()`, never hard-coded.
  Switches are ink, never iOS green.
- No cards. [Label](../../../native/src/components/Label.tsx) only groups:
  content sits on the page, ordered by type, space, hairlines and the 16 pt
  gutter. Buttons are Apple's interactive Liquid Glass
  ([Capsule](../../../native/src/components/Capsule.tsx)), plain frost with an
  ink title, lit from the fingertip on a press (warm for Log set, Resume,
  Start and Finish); a sheet's one filled shape is its main button.
- A tab's own page is grouped by space: its groups are `Section page`
  (`space.group`), clearly further apart than anything inside one. Semibold is
  for headings; a figure beside its label reads in regular weight. Whatever is
  pressed is a glass capsule (a heading's action is a small one), and a row
  that opens a screen ends in a chevron. Every right edge on a page is the
  16 pt gutter.
- Data marks are `mark` at full strength; the current period is ink and over
  is red. No opacity tricks: hierarchy comes from size and weight. Every week
  and calendar starts on Monday.
- The brand mark is the red italic P
  ([BrandMark](../../../native/src/components/BrandMark.tsx)); Fraunces appears
  nowhere else. The set [Tally](../../../native/src/components/Tally.tsx) is for
  set progress and finished-session summaries only, never a logo or
  decoration.
- Restraint over completeness (the owner found the web app bloated). A card
  carries one title, at most one quiet line and at most one action. Leave out
  zeros, placeholders and figures that repeat another; add a row only when it
  changes what the person does next.
- Inspiration, never imitation: do not reproduce another brand's marks, labels,
  layouts or signature details.
- No costume luxury: no serif type outside the P, no Roman numerals,
  faux-editorial copy, glow, 3D or particles (the molten glass and a press's
  light, below, are the approved exceptions). Sentence case. Touch targets at
  least 44 pt.
- "This should work, and it does" (the owner): every list item that can be
  removed swipes left for its actions
  ([SwipeRow](../../../native/src/components/SwipeRow.tsx)); anything with more
  to do offers it on a long press
  ([HoldMenu](../../../native/src/components/HoldMenu.tsx)); a value that looks
  editable opens its editor when tapped; a card that leads somewhere is
  tappable as a whole; screens of server data pull to refresh; a small
  destructive button with no swipe behind it asks first. Removals are
  optimistic and come back with an alert on failure.
- Accessibility: the app works with VoiceOver, every text size up to AX5,
  Increase Contrast and Reduce Motion, and looks exactly the same at iOS's
  default settings. Layout for the large sizes goes behind `useLargeText()`
  ([accessibility](../../../native/src/lib/accessibility.ts)) so the default
  code path never changes. Every control has a role, a label and its state;
  long press, drag and swipe also exist as custom actions. Status changes a
  sighted person sees are announced with `useAnnounce` or `announce`.
  `tests/nativeAccessibility.test.ts` checks what it can from the source.
- Motion is native transitions plus Reanimated springs for press feedback and
  the tally. Figures that change in place roll their digits through
  [RollingText](../../../native/src/components/RollingText.tsx). The one
  branded animation is the cold-launch
  [intro](../../../native/src/components/BrandIntro.tsx); it never replays on
  return from the background.
- Haptics: a light tap on every tab, button, header item and chip; select for
  value changes; success or error for saves; none for typing or scrolling.
  iOS's own tab bar and header items are silent, so wire them.

## The owner's decisions

Settled; do not reopen or "improve" them without being asked.

- Past target: protein is never red. While bulking or lean bulking nothing
  past target is red; otherwise calories, carbs and fat past target are
  (`warnsOverTarget`). The Monday check-in shows nothing past target in red,
  and the Fuel reminder never mentions being past a target.
- Log food: the entry methods are Barcode, Manual, Photo and Describe. Photo
  opens the camera at once, with no chooser sheet first. Describe puts the
  cursor in Your meal. Both lead to one meal view, and nothing is estimated
  until Analyze meal; only Snap a meal estimates on its own. Search stays a
  food search. Barcode opens its camera only when Scan barcode is tapped. No
  food list carries a kcal heading.
- Food AI defaults to Gemini. While an analysis runs, the Analysis card shows
  the function's own steps; never invent a step or a timed message.
- Train: a movement's set count goes from 1 to 12 whatever the program says.
  Skip skips a movement for this workout only and stays on the set card.
  Reorder is in place (hold and drag), with no Reorder sheet. Warm-up rows are
  never logged. Corrections never celebrate.
- Session complete names new records and "N sets beat last time".
- Editing targets: a new calorie figure carries carbs and fat with it;
  protein never moves.
- The tab bar shrinks on scroll on every tab
  ([TabScroll](../../../native/src/components/TabScroll.tsx)).
- Today holds the day's training, Fuel and Progress, and fits one screen.
  Progress is two rows built as You's: This week (the sessions done) and, on
  Mondays, Last week as one line (its weight change). The five-line recap and
  the muscles outside their range are one tap away, not on Today.
- No cards: he called them "cheap excuses for a bad UI". On 2026-11-09 he saw
  Today with the same content in glass cards beside it without, and kept no
  cards, "narrowly"; the trimmed content mattered more than the cards. Cards
  appear in one moment only, his idea: holding a group on Today brings glass
  cards in behind every group, it is dragged into an order kept on the phone,
  and the cards fade once it is set down (DragList's `cards`). A hold lifts
  the group, so a row inside one has no hold menu: Last week hides with a
  swipe. No scroll bars
  either: on a bare page one "makes the app kinda feel like a webapp".
- Molten glass behind the four tabs
  ([GlassField](../../../native/src/components/GlassField.tsx),
  `native/modules/hyper-glass-field`), judged on his phone on 2026-11-09:
  - It must feel rendered inside the app, never "like a video playing in the
    background": the display's full rate (120 fps on his phone), and one
    field shared by all tabs so a tab change never resets it. A field per tab
    at 30 to 60 fps was rejected as laggy and cheap.
  - Quiet: "something that you notice", not something that "screams". Out of
    four strengths he chose "faint" (`GlassLook`); there is no setting.
  - Battery is "really important": 15 s after the last touch, scroll, press
    or tab change it fades away, still moving, and stops drawing on the bare
    page; any use fades it back in. Never leave it frozen on screen ("like a
    video being paused").
  - Reduce Motion holds it still, Increase Contrast draws it fainter, Low
    Power Mode caps it at 60 fps.
  Hold anything else that moves behind the app to the same rules.

## Traps

- The touch that swipes a row also lifts as a press on the row under it, so a
  row's tap and long press start with `if (closeOpenSwipeRow()) return;` (Row
  does).
- Rest starts only after a set saves; a failed save keeps the numbers and the
  button becomes Retry.
- A screen with unsaved edits uses `useLeaveGuard`
  ([leaveGuard](../../../native/src/lib/leaveGuard.ts)). Never re-dispatch the
  held action straight from `usePreventRemove`'s callback; the guard is still
  on and asks again forever.
- A sideways swipe on a pushed screen is iOS's swipe-back. Horizontal paging
  there uses a paging ScrollView, which iOS lets win, never a gesture-handler
  fling.
- Never scroll a large-title screen programmatically to "the top": it fights
  the title and short pages snap back.
- An animated style that Reanimated parses from a string (a shadow, a colour)
  writes its numbers with fixed decimals, as
  [liftShadow](../../../native/src/lib/liftShadow.ts) does: near 0 JavaScript
  writes "1.6e-7", Reanimated's parser throws, and a release build closes. Its
  resting value is written out too, never `undefined`, or the view keeps the
  last value it drew.
- `accessibilityLiveRegion` does nothing on iOS, and a test forbids it.
  `onMagicTap` does not fire on React Native 0.88's New Architecture.
- An animation marked `ReduceMotion.Never` needs its own plain fade.
- The simulator hides what matters about the glass: its screen is 60 Hz, and
  its tab bar never switches between light and dark glass. Judge smoothness,
  tab changes and the tab bar on the phone, early. Frame rate from the phone:
  `xcrun devicectl device process launch --console --terminate-existing
  --device <id> app.hyper.native -- -hyperGlassStats YES` (ending that command
  ends the app, and the owner must keep the app in front).
- Give a view under the tab bar no native background colour of its own. iOS
  reads it for the bar's light or dark glass even when something opaque covers
  it; one left over from the other appearance turned the bar white on one tab
  until a relaunch.
- A SwiftUI `Host` sized by `matchContents` takes `ignoreSafeArea="all"`, or
  a picker sticks under a sheet's header while the sheet scrolls.
- iOS only shrinks the tab bar on pages that scroll well past the screen; tab
  root pages use TabScroll, which gives any scrolling page enough travel.
  Re-measure its insets if iOS changes its bars.

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
  fuelReminder` sets a Fuel reminder a minute ahead and logs what iOS holds. A new local module (such as `hyper-launch`),
  or a new Swift file in one, needs `pod install`, which prebuild runs.
  `-hyperGlassLevel off|faint|soft|full` compares the glass's strengths and
  `-hyperGlassStats YES` logs its frame rate.
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
