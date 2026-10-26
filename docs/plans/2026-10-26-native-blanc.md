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
   Still needed, each production change with the owner's approval:
   - Supabase Auth redirect allow-list: add `hyper-native://auth/callback`
     before Google sign-in (it is also the email confirmation return).
   - Keychain storage that writes the web app's items (service
     `<bundle ID>.auth`, account = storage key, after first unlock, this device
     only), so cutover keeps people signed in. Check expo-secure-store against
     that, or add a small module.
   - WHOOP connect waits for cutover: its function accepts only
     `app.hyper.mobile://settings`. Health permission and Live Activities are
     granted again under the final bundle ID.
   Earlier: `crypto.randomUUID` (expo-crypto), retry-safe food entry ids, the
   session user id and the day's meal groups.
3. **Train complete.** Start/schedule, flexible mode, supersets, drag reorder with
   restore on failure, session swap and switch back, notes, add/remove sets and
   movements, editing logged sets, rest Live Activity.
4. **Fuel complete.** Barcode (VisionKit), photo and describe analysis, manual entry,
   build a meal, edit/delete with swipe actions and menus, time picker, saved
   meals, month view.
5. **History and Progress.** Calendar, day ledger, editing past workouts and
   nutrition, activities and WHOOP merge, charts, volume map and trends.
6. **Program.** Programs list, split editor (drag reorder, multi-add picker), schedule.
7. **You.** Profile, targets and calculator, coach, saved meals, food analysis
   worker, connections (WHOOP OAuth), Health weight sync, appearance, adaptive
   scheduling.
8. **Run tracker and widgets.** Port the Swift run, Live Activity and widget targets
   as Expo modules and config plugins.
9. **Parity check and cutover.** Walk the parity inventory, switch the bundle ID,
   TestFlight, then retire the Capacitor app. Each release and production step needs
   the owner's explicit approval.

The parity inventory (`docs/plans/2026-10-26-native-parity-inventory.md`) lists
every screen, flow and rule the native app must keep.

## Risks

- **Data integrity.** Set and food saves reuse the shared code, so its retry and
  recovery rules carry over; logic still living inside web components must move to
  `src/lib` before reuse rather than being copied (first case: USDA food creation,
  ported in `native/src/lib/fuel.ts` with a TODO).
- **Auth.** No backend or schema change is planned; the native sign-in must keep
  session restore and offline behaviour identical.
- **Native ports.** Run tracking, Health, barcode and Live Activities are Swift
  today and become Expo modules; each needs device testing.
- **Two apps during the rebuild.** Shared-logic fixes reach both; UI fixes go to the
  native app only.
