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
  cannot run in React Native (Supabase client, native bridge, OAuth, preview flag,
  Capacitor shim). Add a swap rather than importing React Native into `src`.
  TypeScript mirrors the swaps in `native/tsconfig.json` paths.
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
  colour; red only for live state, errors and over-limit.
- The white [Label](../../../native/src/components/Label.tsx) is the one container
  (10 pt continuous corners). Sections are separated by space, rows by hairlines
  with an iOS press highlight. Ink capsules are primary actions; quiet fill
  capsules are secondary.
- hyPer's one signature is the set [Tally](../../../native/src/components/Tally.tsx):
  sets counted like a paper training log, one stroke per set in groups of five,
  the next set's stroke taller, a finished group closed with a diagonal. Use it
  for set progress and finished-session summaries, not as decoration.
- Inspiration, never imitation: do not reproduce another brand's marks, labels,
  layouts or signature details (the owner ruled out copying Maison Margiela's
  stitches and numbered label on 2026-10-26).
- No costume luxury: no serif type, Roman numerals, faux-editorial copy, glow,
  3D or particles. Sentence case. Touch targets at least 44 pt.
- Motion is native transitions plus Reanimated springs for press feedback and
  the tally. Never scroll a large-title screen programmatically to "the top":
  it fights the title and short pages snap back. Reveal content only when it is
  hidden.
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
- Debug builds accept launch arguments for headless checks
  ([devLaunch](../../../native/src/platform/devLaunch.ts)), for example
  `xcrun simctl launch <udid> app.hyper.native -hyperRoute /train -hyperAction logSet`,
  then `xcrun simctl io <udid> screenshot <file>`. Check light and dark
  (`xcrun simctl ui <udid> appearance dark`).
- Phone installs use bundle ID `app.hyper.native` until cutover; signing follows
  [the iOS workflow](../ship-ios/SKILL.md). A simulator run does not prove device
  behaviour, haptics or performance.
