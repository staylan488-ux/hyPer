# Mobile input and sheet keyboard audit — 2026-09-06

## Findings and fix

- FoodLogger's selected-food amount input reused `t-data-lg`, which computes to
  14px. Similar compact editable text existed in workout notes, schedule dates,
  run distance and program editing. Shared editable-control CSS now sets a
  16px minimum relative to inherited text size. Display typography stays compact;
  the viewport meta tag continues to permit pinch zoom.
- `useAppViewport` returned early whenever visual viewport scale differed from 1.
  Keyboard dismissal while still magnified therefore retained old shell height,
  inset and navigation state. Geometry now updates throughout zoom and keyboard
  transitions, using scale-normalized height to distinguish zoom from occlusion.
- Real WKWebView keyboard focus can both shrink `window.innerHeight` and pan the
  page. On iPhone 17 / iOS 26.5, saved search produced innerHeight=471,
  visual height=471, offsetTop=403 and documentElement.clientHeight=874.
  The hook uses the stable document layout height, follows the full normal-scale
  pan, and detects keyboard presence independently of that pan. An attempted
  offset clamp during implementation failed this simulator case and was removed.
- After focus or viewport resize, only scrollable ancestors inside the active
  dialog reveal a clipped field. This avoids scrolling the background route or
  document and respects nested inert sheets and deliberate zoom.
- Native scanner code only presents/dismisses its scanner controller; no evidence
  linked it to the stuck geometry. Capacitor has no keyboard resize plugin here.
  Native configuration, native scanner, authentication and database code are unchanged.
- Selecting Scan now starts the existing camera flow automatically. The initial
  Start scanner button is removed; Scan again remains available after cancellation,
  stopping or failure. Manual barcode entry remains available. Startup runs once
  per tab mount, cancels pending startup on departure and ignores stale native
  availability/scan results. React effect replay cannot open a duplicate scanner.

## Verification

- Full Vitest suite: 942 tests across 80 files passed, including 11 viewport,
  lifecycle and nested-scroll regressions plus six scanner lifecycle regressions. This checkout has no production
  Supabase build configuration; tests used a dummy test URL/key. An initial run
  without these variables failed configuration-dependent tests.
- ESLint and instruction checks passed. Production web build and Capacitor iOS
  sync and final Xcode iOS simulator build passed (code signing disabled).
  Generated native files introduced no tracked churn.
- Browser preview at 390px: computed amount and manual-entry input fonts are
  16px; focused amount remains visible at 440px available height and recovers at
  844px; nested unit selection restores parent focus and converts two servings
  to 340g; fixture save records the amount and time. Ivory and Black inspected.
- iPhone simulator checks use an isolated development fixture bundle inside a
  temporary built app, with the real WKWebView and software keyboard. Serving
  edit and saved-food search stay visible above decimal/alphabetic keyboards.
  Done restores the sheets; closing a sheet with its keyboard open restores the
  full app and native tabs, and navigating to Today succeeds.
- Scanner lifecycle tests cover automatic startup, rerender stability, explicit
  retry after cancellation/error, effect replay and leaving during native startup.
  Browser preview enters camera-unavailable recovery directly from Scan, with
  Scan again and manual entry available; no Start scanner click is needed. The
  native simulator likewise enters its expected unavailable-camera state from
  Scan immediately; retry responds and manual digits survive keyboard dismissal.

## Limits

No physical iPhone was connected. Physical camera/barcode scanning, device-specific
keyboard variants and production-account behavior remain unverified. Fixture
saves are in-memory only. The follow-up authorizes a PR and merge; TestFlight upload remains with the
user. No deployment, release or production data write was performed. Background restoration after arbitrary user pinch gestures is covered
by geometry tests; no code forcibly resets the user's chosen zoom.
