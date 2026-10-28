# Native parity inventory (web app → Blanc native app)

Recorded 2026-10-26 (Pacific) for the native rebuild planned in
[2026-10-26-native-blanc.md](2026-10-26-native-blanc.md).

**What this is:** a list of every screen, action and rule in the current app
(React web app shipped to iOS through Capacitor) that the new React Native +
Expo app in `native/` has to keep. It is the checklist for milestone 9 ("walk
the parity inventory") of that plan, and it says which shared code the native
screens can reuse as it is and which code needs work first.

**Source and method**
- Checkout: `.claude/worktrees/native-blanc`, branch `feat/native-blanc`, based on `origin/main` at `af16add` (#151).
- Read-only. Six readers each covered one area in full (Train, Fuel, Program, You/sign-in/WHOOP/Health, Today/History/Coaching/Run, and iOS plus browser dependencies). About 30 of their claims were then re-checked against the source, and every one matched.
- Nothing was built, installed or run. Statements about React Native and Expo behaviour come from reading the installed packages in `native/node_modules` (Expo SDK 58, React Native 0.88). Items marked **verify** were not confirmed on a device.
- `native/` is untracked and was being edited by another session while this was read. Notes on what the native app already does describe it **as read at 02:14 Pacific on 2026-10-26** and will go stale. For example, `crypto.randomUUID` and the Fuel group / retry-id handling changed at 02:06 and are noted below.

**Conventions**
- Paths are relative to the repository root. Bare file names refer to `src/`, because their base names are unique there.
- `native/…` means the Expo app. `ios/…` means the current Capacitor iOS project.
- "Store" means `src/stores/appStore.ts`.

## Contents
0. [Read this first: the biggest findings](#0-read-this-first-the-biggest-findings)
1. [Screens and routes](#1-screens-and-routes)
2. [Behaviour rules that must survive](#2-behaviour-rules-that-must-survive)
3. [Logic that lives inside components](#3-logic-that-lives-inside-components-instead-of-srclib)
4. [Native iOS pieces](#4-native-ios-pieces-iosapp)
5. [Browser and Capacitor dependencies in shared modules](#5-browser-and-capacitor-dependencies-in-shared-modules)
6. [Suggested build order](#6-suggested-build-order)
- [Appendix A: backend surface](#appendix-a-backend-surface)
- [Appendix B: store action index](#appendix-b-store-action-index)
- [Appendix C: device-only state (localStorage keys)](#appendix-c-device-only-state-localstorage-keys)
- [Appendix D: tests that protect the shared rules](#appendix-d-tests-that-protect-the-shared-rules)
- [Appendix E: shared modules the native app imports](#appendix-e-shared-modules-the-native-app-imports-as-read-at-0214)

---

## 0. Read this first: the biggest findings

1. **Four Capacitor packages and one Supabase folder break the native bundle as soon as a screen imports them.**
   - Shared code imports `@capacitor/haptics` (`lib/haptics.ts`, used by about 22 files), `@capacitor/status-bar` (`stores/themeStore.ts`), `@capacitor/local-notifications` (`lib/restNotifications.ts`) and `@capacitor-community/keep-awake` (`lib/keepAwake.ts`). None is installed in `native/` or swapped by `native/metro.config.js`.
   - `lib/foodTrial.ts` imports files from `supabase/functions/analyze-food-trial/`, which Metro does not watch (**verify**).
   - The four stores themselves are safe, except `themeStore`. Most shared hooks and components are not.
2. **Shared code depends on `crypto.randomUUID()`, which React Native lacks.**
   - Unguarded calls:
     - the session-only exercise swap (`stores/appStore.ts:1230`),
     - the retry-safe id for every new food entry (`lib/pendingEntryId.ts:6`),
     - meal-builder ingredient ids (`lib/mealComposition.ts:100`).
   - Program supersets fall back to a non-UUID id (`lib/splitDraft.ts:47-50`), which the `save_split_snapshot` RPC rejects when it casts to UUID. The preview backend does not check UUIDs, so preview testing hides this.
   - Since 02:06, `native/src/platform/setup.ts:7-14` installs `crypto.randomUUID` from `expo-crypto` before any shared module loads. This covers all four, as long as it stays first in `native/index.ts`.
   - `crypto.subtle` is still missing (§5.2, `requestIdempotency.ts`).
3. **Five shared hooks use the browser `document` and crash when mounted:** `useTodayRefresh`, `useWhoopForegroundSync`, `useRunTracker` (once a run starts), `useAppViewport` and the program editor's `useSplitDraftAutosave`. `commitFocusedField` (Program Save, Cancel and Discard) does the same when called. Each needs an `AppState`-based or React Native version.
4. **Much of the app's behaviour still lives inside web screens, not `src/lib`:**
   - `components/nutrition/FoodLogger.tsx` (2,543 lines: food-row creation, barcode lookup order, manual-save rules, photo and AI save loops),
   - `pages/Workout.tsx` (2,529: session model, superset rules, finish sequence),
   - `pages/History.tsx` (2,047: edit protocol glue, calendar, activity rules),
   - `pages/Nutrition.tsx` (day orchestration, meal groups),
   - `pages/Dashboard.tsx` (Today state machine).
   Section 3 lists over 100 such places. The native app has already started re-deriving some of them differently (session order, autofill, finish summary, meal assignment, USDA food creation).
5. **Both apps write the same nutrition rows, so native writes must follow the web model exactly.**
   - Native Fuel was moving toward this during the read. Before 02:06 it wrote `meal_type` from the clock with `group_id: null`, inserted without a retry-safe id, and used the auth store's user id. As of 02:14, `native/src/lib/fuel.ts:85-102` writes the chosen group with `legacyMealTypeForGroup`, upserts by a pending id, and uses `getSessionUserId`.
   - Still different from the web:
     - Native never creates the day's Breakfast / Lunch / Dinner groups (the web does when a day is viewed, `Nutrition.tsx:256-318`). On a day not yet opened in the web app, the suggested group is therefore missing and entries go to Unassigned.
     - It always logs 1 serving at `logged_at` = now.
     - The USDA food-row rule is still a second copy.
6. **Sign-in and sessions won't carry over as they stand.**
   - The native app is `app.hyper.native` with the scheme `hyper-native`. The shared OAuth callback parser only accepts `app.hyper.mobile://auth/callback` (`lib/nativeOAuthCallback.ts:11`), and the WHOOP edge function only accepts `app.hyper.mobile://settings` (`supabase/functions/whoop-oauth/index.ts:46-60`).
   - Bound to the bundle id: the Keychain session (service `app.hyper.mobile.auth`), Health permission, run-recorder files and Live Activities.
   - Never reachable from the new app: WKWebView localStorage (theme, rest preferences cache, plan-schedule cache, drafts, cursors).
   - The native Supabase client (`native/src/platform/supabase.ts`) has none of the web client's request deadlines (`timedFetch`), refresh diagnostics or foreground auth resume. The set-save stall fixes of 2026-10-13 and 2026-10-24 depend on these.
7. **Run tracking, Health, barcode scanning, both Live Activities, rest notifications and the iOS 26 glass surfaces are Swift or Capacitor code.**
   - Each needs an Expo module or package. The Live Activities also need a widget-extension target that the Expo project does not have.
   - The current widget extension requires **iOS 26.5** (`ios/App/App.xcodeproj/project.pbxproj:516,554`). There are no home-screen widgets yet, only placeholder files.
8. **Some current behaviours look unintentional. Rebuild them on purpose, not by accident:**
   - Fuel and History calendars start on **Sunday** while training weeks start on **Monday**.
   - A food entry on a past day defaults to **00:00**.
   - History's Move earlier/later ignores superset pairs.
   - Nothing stops editing, activating or deleting a program during a live workout. Removing the live day makes that workout drop off Train.
   - Settings reports "WHOOP connected." when `connectWhoop` returns `null` with no session user.
   - Section 6.4 has the full list.

---

## 1. Screens and routes

### 1.1 Routes (`src/App.tsx:185-216`)

All app routes sit inside `PrivateLayout` (the sign-in gate, :112-142) and a pathless `errorElement` (`RouteErrorScreen`, :199). A page that throws therefore shows the error screen inside the shell, and the tab bar keeps working.

| Path | Screen | How it loads | Line |
|---|---|---|---|
| `/` | `pages/Dashboard.tsx` (Today) | in entry | :200 |
| `/train` | `pages/Workout.tsx` (Train: pre-session and live session) | in entry | :201 |
| `/nutrition` | `pages/Nutrition.tsx` (Fuel) | in entry | :202 |
| `/train/program` | `pages/Splits.tsx` (Program) | lazy | :203 |
| `/train/run` | `pages/RunTracker.tsx` | lazy | :204 |
| `/settings/*` | `pages/Settings.tsx` (You, every sub-page in one component) | lazy | :208 |
| `/analysis` | `pages/Analysis.tsx` (Coaching / Progress) | lazy | :209 |
| `/history` | `pages/History.tsx` | lazy | :210 |
| `/train/templates` → `/train/program`; `/workout` → `/train`; `/splits` → `/train/program`; `*` → `/` | redirects | — | :205-207, :211 |
| `/preview`, `/preview/intro`, `/preview/glass`, `/preview/sign-in`; `/preview/you` → `/settings`; `/sandbox` → `/` | dev only | — | :188-195 |

Notes:
- **Lazy pages** reload once when a deploy has replaced their chunk (`lib/staleChunkReload.ts`, :157-164). On the web they are warmed 3 s after launch (:169-177). Both are web-only concerns.
- **Settings stays mounted.** `AnimatedOutlet` keys the route container by path, except that every `/settings/*` path shares one key (:104). One Settings instance, and its unsaved drafts, survives moves between sub-pages. Scroll position is remembered per path in memory (`lib/routeScroll.ts`).
- **Settings sub-pages** (titles at `Settings.tsx:912-930`):

  | Group | Sub-pages |
  |---|---|
  | Top level | `home`, `account`, `training`, `appearance`, `meals`, `weight`, `about` |
  | Targets | `targets`, `targets/edit`, `targets/calculate`, `targets/coach`, `targets/adaptation` |
  | Food analysis | `analysis`, `analysis/worker` (with `?from=coach`) |
  | Connections | `connections`, `connections/whoop`, `connections/health` |

  - An unknown sub-page shows a "Back to You" row (:2029-2033).
  - `#search-<id>` hashes focus and highlight a row (:131-154).
  - On the web, `?whoop=connected|error` is the WHOOP OAuth landing (:397-412).

### 1.2 App shell and app-wide behaviour

| Piece | What it does | Where |
|---|---|---|
| App root mounts | `useNativeHealthSync(user.id)`, `useWhoopForegroundSync(user.id)`, `useNativeAuthCallback()`, `authStore.initialize()`, glass-surface probe (iOS), theme init, lazy warm-up (web), `watchRestTimerWorkoutEnd(useAppStore)`, `watchRestTimerSignOut(useAuthStore)` | `App.tsx:218-246` |
| Auth gate | `authScreen()` returns `boot` (not initialized), `app` (user), `offline` (reconnecting and the person has not chosen "Sign in instead") or `sign-in` | `lib/authScreen.ts:7-15`; `App.tsx:112-142` |
| Boot / offline splash | "A field journal", wordmark, animated hairline, "Preparing your edition" / "Offline, waiting for a connection". Offline adds **Sign in instead**, which only sets local state (:115, :124) and never signs out, so the saved session survives and the app opens itself on `TOKEN_REFRESHED` | `App.tsx:42-81` |
| Shell | Scroll viewport, `ScrollEdge`, `BottomNav`, `CommandCapsule`, `FxLayer` (celebration particles) | `App.tsx:131-141` |
| Bottom nav | See below | `components/shared/BottomNav.tsx:10-29, 57-59` |
| Command capsule | One floating primary action; the newest registration wins (`lib/commandCapsule.ts:56-93`, `hooks/useCommandCapsule.ts`). Registered by Today, Train, Fuel, Program, Run, Coaching and Settings (Log weight) | `components/metal/CommandCapsule.tsx` |
| Toast | `<Toast show message tone>`, controlled by its parent; no global toast store. iOS 26 draws a native glass pill (`HyperGlassSurfaces.syncToast`); `tone` is not sent to native | `components/shared/Toast.tsx:8-49`; `hooks/useNativeGlassSurfaces.ts:76-111` |
| Route error screen | "Something went wrong / This page couldn't load", **Go to Today** (full load of `/`), **Try again** (reload) | `components/shared/RouteErrorScreen.tsx:11-34` |
| Confirm sheet | `requestConfirm()` plus `ConfirmDialogHost`, mounted **only on Program** (`Splits.tsx:726-734`). With no host mounted it answers "no"; a newer request cancels the older one | `lib/confirmDialog.ts:34-72`; `components/shared/ConfirmDialog.tsx` |
| Sheets | `Modal` closes on the X, a backdrop tap, Escape and swipe-down over 90 px or a fast flick. The background is made inert (`lib/sheetLayers.ts`). `SelectSheet` is the option picker | `components/shared/Modal.tsx:38-133`; `SelectSheet.tsx` |
| Theme | Covered in §2.18 | `stores/themeStore.ts` |

**Bottom nav**
- Today `/`; Train `/train` (also lit on `/workout`, `/splits`); Fuel `/nutrition`; You `/settings` (also lit on `/history`, `/analysis`).
- Hidden on `/train/session*`, on `/train/run*`, and on `/train` or `/workout` while an unfinished workout exists.
- On iOS 26 the native glass dock replaces it (`useNativeGlassNavigation`). A tab change fires `tapHaptic`.

**Browser prompts** (`window.alert` / `window.confirm`) that need a native equivalent:
- **Train:**
  - start failures (`Workout.tsx:728, 964, 968`).
- **Program:**
  - delete failure (`Splits.tsx:125`), mode switch (:134), set active (:239).
  - flexible template start (:152, :158), rename (:174, :188, :192), and the overwrite confirm (:183).
- **Fuel:**
  - delete custom group (`Nutrition.tsx:409`).
  - close the logger during analysis or with an unseen estimate (:753, :755).
  - delete saved meal (`FoodLogger.tsx:692`).
  - replace the AI meal (`FoodLogger.tsx:424`).
- **Settings:**
  - delete saved meal (`Settings.tsx:641`), sign out (:843), and a `beforeunload` guard (:872-891).

### 1.3 Sign-in screen (`components/auth/AuthForm.tsx`)

**What the person sees:** "A field journal / Est. MMXXVI", the wordmark (it plays the login brand intro), a heading that toggles between Sign in and Create account, and these fields:
- Name (sign-up only).
- Email.
- Password: at least 6 characters; autocomplete `current-password` / `new-password` (:146-176).

There is **no** magic link, password reset or account deletion anywhere in `src`.

| Action | Handler | Calls |
|---|---|---|
| Sign in | `handleSubmit` :40-49 | `authStore.signIn` (`authStore.ts:135-149`) → `signInWithPassword`. An unverified email is signed out, then `invalidateExerciseLibrary` + `resetAppData`; error "Please verify your email before signing in." |
| Create account | `handleSubmit` :51-68 | `authStore.signUp` (:151-183) → `auth.signUp({data:{display_name}, emailRedirectTo: getAuthRedirectTo()})`. An existing account is detected by message or by `identities.length===0` → "This email already has an account…" plus **Go to sign in** (:217-234). Success: "Account created. Check your email…", button locked |
| Resend verification | `handleResendVerification` :85-103 | `authStore.resendSignupConfirmation` (:185-199) → `auth.resend({type:'signup'})` |
| Continue with Google | :71-76 | `signInWithOAuthProvider('google')` (`lib/nativeAuth.ts:20-55`). iOS: `NativeAuth.openOAuth` → `parseNativeOAuthCallback` → `exchangeCodeForSession`. Web: `location.assign` |
| Continue with Apple | :78-83 | Same; button shown only when `isNativeIOS()` (:25, :260) |
| Switch sign in / sign up | :280-295 | local state |

### 1.4 Brand intro (`components/intro/*`)

- **Where it plays:** `BrandWordmark` plays it on the sign-in screen (`variant="login"`, `AuthForm.tsx:114`) and on Today (`variant="dashboard"`, `Dashboard.tsx:227`).
- **Once per session per variant:** an in-memory `Set` plus sessionStorage `hyper:intro:<variant>:v2` (`introState.ts:3-23`). Eligibility is captured before commit, so StrictMode cannot use up a second play (`BrandWordmark.tsx:15-31`).
- **Skipped** under reduced motion, or when the Fraunces fonts miss a 700 ms deadline (`brandIntro.ts:205-209`).
- **Animation:** 1,800 ms. The P appears at 1.85× at 40% of screen height, "hy" and "er" join it, and the word flies to the live masthead (`brandIntro.ts:1, 169-200`).
- **Dismissal:** any tap, key, wheel, scroll, resize, visibility change or motion-preference change ends it, and the dismissing tap is swallowed (:49-67).
- While it plays, `<html data-brand-intro="true">` holds back native glass toasts and overlays (`lib/nativeGlassSurfaces.ts:169-189`).

### 1.5 Today (`pages/Dashboard.tsx`, `/`)

**Load** (`load`, :69-90). One function runs on mount and on every refresh:
1. `readTodayDay(day)` reads the day's `nutrition_logs` with `foods` and the `workouts` with `date = day` and `completed = true` (`lib/todayDay.ts:58-80`).
2. In parallel, the store's `fetchSplits`, `fetchMacroTarget`, `calculateWeeklyVolume`, `fetchCurrentWorkout`, `fetchWorkoutMode` and `fetchNutritionProfile`.
3. Then `refreshAdaptiveTargets()`, not awaited.
4. A failed day read throws and keeps the old day on screen.
5. Success calls `rememberTodayDay`, keyed by account, day, live workout id and workout write sequence (`getWorkoutWriteSeq`, read before the request, :71).

Other inputs:
- `usePlanSchedule`: localStorage first, then `plan_schedules`.
- `useScheduleWorkouts`: paged `workouts`, read only when adaptive scheduling is on or the schedule is flexible (`useScheduleWorkouts.ts:13`).
- `useAdaptiveSplitScheduling`.
- `useWeekSessions`: completed `workouts` in the Monday–Sunday week by `date` (`lib/weekSessions.ts:15-26`).
- `useTodayRefresh(load, retrySchedule, seedToday)` (:101).

**Hero states**, checked in this order (:108-160; type in `components/dashboard/todayModel.ts:5-27`; capsule text from `todayCapsule`, todayModel.ts:70-115):

| State | When | What shows | Capsule action |
|---|---|---|---|
| loading | First load before the store is hydrated for this user | Shimmer | none |
| resume | Unfinished live workout | Day name (or "Flexible"); elapsed time; completed of total sets; next set from `getWorkoutResumeSet` (`components/workout/workoutFocus.ts:84-107`). Name falls back from the set's exercise → split day → plan item (:113-117) | **Resume** → `/train`. Sublabel "Name, set N · W × R" or "All sets logged · review and finish" |
| done | `readTodayDay().todayDone` | "Trained today", week figure, banked stamp | **Review session** → `/history` |
| flexible | `workoutMode === 'flexible'` | "Flexible mode", week count with no target | **Start session** → `/train` |
| first-run | No active split | "Build your program", "5 questions" | **Get started** → `/train/program` |
| schedule-error | The completed-workouts read failed | Error note | **Retry** → `retrySchedule` |
| no-schedule | No `plan_schedules` row | "Pick your training days" | **Set plan start** → `/train` |
| planned | `plannedDayForDate(...)` returns a day | Day name, "program · week N", planned sets and exercises | **Start <day>** → `/train`; sublabel "N sets · <first> first" |
| rest | No planned day | "Rest day"; week figure; next session within 14 days ("Tomorrow · Day" / "EEE · Day", :183-192); **Train anyway** → `/train` (:245) | **Log food** → `/nutrition`; sublabel "X kcal left" |

**Sections:**
- **Header:** the eyebrow reads "Session in progress" with a live mark, "Start here", or `EEEE, MMM d`.
- **Fuel** (:251-276):
  - kcal left = `max(0, target − eaten)`. The target falls back to `DEFAULT_MACRO_TARGET` (2000 kcal / 150 g protein) when missing or 0 (:162).
  - Eaten and Protein rails with a `SealMark` (`useTargetSeal`, :470-481).
  - **Set targets** → `/settings` when there is no target. **+ Log food** → `/nutrition` except on rest days.
- **This week** (:279-315):
  - Up to 7 session dots, "N of T sessions". T is the number of fixed-schedule weekdays, else `days_per_week`; flexible mode has none (:172-174). Hidden on rest and done days.
  - "X muscles trained · Y in range · Z under · W over" (`summarizeWeekVolume`), plus a flag line from `pickInsight`.
  - Contents links: Progress → `/analysis`, Program → `/train/program`, History → `/history`.
- **Volume card** → `/analysis` (:318-347): insight headline, compact `VolumeMaquette` focused on that muscle, `VolumeRail` with MEV/MAV/MRV notches.

### 1.6 Train (`pages/Workout.tsx`, `/train`)

**Mount reads** (Workout.tsx:479-691):
- Store: `fetchSplits`, `fetchCurrentWorkout`, `fetchWorkoutMode`, `fetchFlexTemplates`, and `fetchCurrentWorkoutDayPlan` on workout or mode change (`workout_day_plans`).
- Rest preferences: `loadRestPreferencesAsync` (`exercise_rest_preferences`).
- Plan schedule: cache plus background sync (`plan_schedules`).
- Schedule completions: `useScheduleWorkouts`.
- Direct Supabase reads inside the page: the week-strip workouts and last completed workout (:571-611), and "last workout" targets through `fetchPreviousSetTargets` (`workouts` + `sets`, :639-691).
- Warm start vs cold start: a return within the same account renders store data immediately; a cold start or a different account shows a skeleton (:256, :1293-1307; `hydratedForUserId`, Store :538-548).

#### Pre-session, split mode (:1309-1686)

| State | What shows | Action → handler → calls |
|---|---|---|
| No program | "No program yet" | Capsule **Build my program** → `/train/program` |
| loading | Shimmer | — |
| error | "Couldn't load your workout schedule" | **Retry** → `retrySchedule` |
| setup (no schedule) | Inline `ScheduleEditor` (:1533-1556) | Capsule **Save plan setup** (sublabel "Day 1 <date> · Mon / Wed / Fri") → `handleSavePlanSetup` (:734-768) → `savePlanSchedule` (`lib/planSchedule.ts:269-279`; localStorage with `pendingSync`, then `plan_schedules` upsert) |
| planned | Day name, "<program> · week N", planned sets and exercises | Capsule **Start <day>** → `handleStartWorkout` (:721-732) → Store `startWorkout` (:913-1003). Failure → `window.alert` |
| done | "Trained today", banked stamp | — |
| rest | "Rest day" | — |

On every state with a schedule:
- **Run** → `/train/run`.
- **Schedule** → "Edit schedule" modal with `ScheduleEditor` (:1352-1368, :1659-1681).
- "Last trained <date>".
- **Week strip** (:1581-1625): previous / **Now** / next week. Each day shows completed / planned / rest / missed via `plannedDayForDate`.
- **Train a different day** (:1628-1653): a **Start** per split day → `startWorkout(day.id)`. The note text depends on the adaptive setting and the schedule mode (:1629-1633).

#### Pre-session, flexible mode (:1373-1454)
- "What are you training?" (max 40 characters; Return submits).
- Up to 6 **Quick start** template chips, newest first. Typing a different label clears the chosen template.
- Capsule **Start <label>** → `handleStartFlexibleWorkout` (:955-972) → `startFlexibleWorkout(label, templateLabel)` (Store :1005-1140; `workouts`, `flex_day_templates`, `workout_day_plans`, `sets`).
- A `null` result (a split workout is in progress) → alert "You already have an in-progress split workout today…".

#### ScheduleEditor (`components/workout/ScheduleEditor.tsx`)
- **Day 1 start:** Today / Tomorrow / Pick date (:97-122).
- **Style:** Fixed weekly rhythm / Flexible sequence (:124-134).
- **Fixed:** 7 weekday buttons for the first training day, plus "Auto plan · Mon / Wed / Fri" from `buildFixedWeekdays` (:136-161).
- **Flexible:** "Active training day", one button per split day (:162-177).
- Save / Cancel (:179-192); inline setup uses the capsule instead.

#### Live session

| Surface | What shows | Actions → calls |
|---|---|---|
| Pin bar (`SessionPin`, :146-193; once the title scrolls away) | Back to Today, movement or session title, 1 s clock | **Finish** |
| Header (:1688-1732) | "← Today", `SessionClock` from `created_at` (:99-113), `finishError` banner | **Finish** → `handleCompleteWorkout`. Note-save failure adds **Retry** → `settleNoteWrites` (:839-843) |
| Title | Day or session name; "X of Y sets", segmented progress | Flexible: tap → "Workout name" modal; blur → `setFlexibleWorkoutLabel` (Store :1327-1351, `workout_day_plans.day_label`). An empty name reverts |
| Section head | "N movements" | **Rest** (manual, :1030-1036). Flexible: **Add movement** → picker |
| Movement card (`ExerciseCard`, :2196-2350) | Collapsed: name, "Now · 3 sets · 8–10 reps · last 100 × 8" or "Done · N sets", "x / y", drag handle. Expanded: "Movement i of n · Superset A", "Set 2 of 3 · target 8–10 reps", "Last workout W × R", set rows, note, "All movements". Detail lines: "Instead of <planned>", swap progress or error, "Superset A · with <partner>" | Tap → `selectMovement` (:947-953). ⋯ menu: **Adjust sets**; **Swap exercise**; **Switch back to <planned>** (only if swapped). Flexible also: **Add superset** / **Unlink superset**, **Remove exercise** (:1176-1187, :1811-1835, :1990). Collapsed cards stay mounted (`inert`), so drafts survive (:2322-2347) |
| Set row (`components/workout/WorkoutSetRow.tsx`) | Ledger row: position `idx+1`, figures. Tone is done / now / suggested / planned / draft (`ledgerView` :275-300). Side text "Not saved · Retry" / "Draft" / "RPE x"; ink check; ↑ when it beat last time; gain stamp ("+5 lb") | Tap → `chooseSet` (:139-148). Editor: Weight (lb, decimal ≥ 0), Reps (integer ≥ 0), RPE (optional, 1–10 in 0.5 steps). **Save** (or **Retry**) → `handleSave` (:86-137) → Store `logSet` (:1756-1782) → `saveWorkoutSet` (`lib/saveWorkoutSet.ts:68-99`, `sets` UPDATE by `workout_id` and `id`). **Use last set / Use last workout** (`getSetAutofillValues`). **Cancel** (completed sets: revert). **Hide** (keep the draft) |
| Command capsule (`WorkoutCommandCapsule.ts`; model in `workoutCapsule.ts:13-62`) | Target: the open editor's set, else the next set by round-aware order | `saving` → busy; `retry` → row `save()`; `log` → "Log set" with suggested values (they become the row draft); `enter` → "Enter set N" opens the row; `finish` → "Finish workout · x of y sets logged". Value chips open the row on that field. Empty flexible session → "Add first exercise". Capsule and inline check share one save path (`setEntryRegistry.ts`) |
| Adjust sets sheet | Split: "Plan · Target min–max reps · N sets". Flexible: "Target sets" (1–12) | Split: **−** → `removeLastUncompletedSet` (Store :1724-1754), enabled above `minSets` when an unfinished set exists. **+** → `addWorkoutSet` (Store :1283-1325), enabled below `maxSets` (range from `parseSetRangeNotes`). Flexible: target commits on blur or Enter → `updateFlexibleExerciseMeta` (Store :1538-1630; superset partner follows). **−** and **+** call the same add and remove without changing the target |
| Swap sheet (`ExercisePicker`, :2063-2085) | "Swap for this workout"; opens on the source's muscle; excludes exercises already in the workout; intro "Replacing X. Its sets and rep target carry over; your program stays the same." | Select → `runSwap` (:1137-1167): notes flush, then `substituteWorkoutExercise` (Store :1206-1262) with `planExerciseSubstitution` (`lib/exerciseSubstitution.ts:48-137`). **Switch back** → `switchBackWorkoutExercise` (Store :1264-1281) |
| Flexible editing | — | **Add movement** → `addFlexibleExercise` (Store :1353-1422). **Add superset** → `addFlexibleSuperset` (:1424-1505). **Unlink** → `clearFlexibleSuperset` (:1507-1536). **Remove** → `removeFlexibleExerciseFromPlan` (:1632-1686). All run behind `afterNoteWrites` (:844-858) |
| Movement note (`MovementNote`, :2379-2421) | Add / Edit / Hide note; textarea (max 200); "Saving… / Saved"; counter from 160 | Change → debounced 1.2 s; blur → `saveNow`. `createNoteAutosaver` (:334-424) → `updateWorkoutNotes` (Store :2813-2829, `workouts.notes` JSON). Flexible also patches the plan item note |
| Reorder (`MovementReorderList.tsx`) | Drag handle when there is more than one block | Pointer drag with edge auto-scroll; keyboard Space/Enter, arrows, Home/End, Escape (:149-306). Drop → `reorderSessionMovements` (:859-864) → `reorderWorkoutExercises` (Store :3202-3239, `workout_day_plans.items` via `ensureWorkoutDayPlan`) |
| Rest bar (`RestTimerPill.tsx`, portal) | Countdown, Rest / Paused / Rest complete, "Next · Bench Press · set 3", warning tone in the last 10 s | Pause/Resume, **Skip** / **Continue**; tap opens the sheet. iOS 26: native glass dock (`useNativeRestDock` :317-335, actions open / toggle / skip / continue) |
| Rest sheet | Big countdown; presets 1m / 2m / 3m / 5m; **Custom** (m:ss or minutes, 5 s–60 min; `parseRestInput`, `lib/restTimer.ts:207-225`) | Pause/Resume, **Restart** (new full timer, paused, :243-249), **Done resting**. Length change → `saveRestPreference` (localStorage `hyper:rest-preferences:<uid>` + `exercise_rest_preferences` upsert) |
| Finish confirm | Only when sets remain: "Finish workout?" "x of y sets logged… Remaining sets won't be logged. You can always edit this session later in History." | **Keep training** / **Finish** |
| Save as quick start (flexible) | "Save as quick start?" | **Save template** → `saveFlexibleTemplateFromCurrentWorkout` (Store :1688-1722; `flex_day_templates` upsert on `(user_id,label)`, swap markers stripped) → finish → `fetchFlexTemplates`. **Skip** |
| Completion sheet (:2423-2529) | 3D `SessionToken` coin (three.js, flat fallback), "Session banked.", sets x/y, lb moved, duration, "Beat last workout · N sets" (top 5, then "and N more"); `completionHaptic` and ink burst | **Done** |

Errors and toasts on Train:
- No toast component is used.
- Start failures use `window.alert`.
- Shown inline: row save errors, the finish/note banner, swap status, the reorder error line (`MovementReorderList.tsx:316`) and the custom rest-time error.
- Fail silently (console only): `addWorkoutSet`, `removeLastUncompletedSet` (Store :1305-1308, :1740-1743) and a failed template save (:1716-1719).

### 1.7 Run tracker (`pages/RunTracker.tsx`, `/train/run`)

- **Entry points:** Train's **Run** (`Workout.tsx:1393, 1508`), Settings **Start a run** (`Settings.tsx:1155-1159`), app search (`lib/appSearch.ts:45`).
- **Bottom nav** is hidden on this route.

| State | What shows | Actions → calls |
|---|---|---|
| Before start (:560-636) | Back, "Run", a "Run in progress" card when a resumable snapshot exists, mode control **Long run** (`free`) / **Splits** (`intervals`; legacy `sprints` still display, :39-48), auto-split sheet (every 100 / 200 / 400 (default) / 1600 m, manual only, or custom 10–100,000 m, :52-59, :278-279), position source (preview builds only: GPS or simulated scenarios at 10×) | Capsule **Start run** → `tracker.start(mode, splitM, source)`; disabled while custom is invalid or a resumable run exists (:209). **Resume run** → `tracker.resume()`. **Discard** |
| Live (:451-557, full-screen overlay) | Mode eyebrow; status (resting > acquiring GPS > GPS weak > GPS ok); `gpsError`; hero = current-split average pace, else run average pace, "—" while resting (Splits mode shows the rest clock); Time, Distance, Avg pace; Splits mode: current lap and last split (legacy sprints: reps) | **Split** (Splits mode, not resting) → `tapHaptic` + `tracker.split()`. **Rest / Resume** → `tracker.toggleRest()`. **Hold to finish** (800 ms, :124-174) → `tracker.finish()`. Every tick: `NativeRun.syncLiveActivity` (:281-299) |
| Finished (:350-448) | Distance hero, Time, Avg pace; Splits section (more than one split) with `LapPaceChart` and a table including rest rows | **Export private GPS diagnostics** (:97-122: JSON `{schemaVersion:1, exportedAt, summary, trace}`; native → `NativeRun.shareDiagnostics`, web → download). **Discard run**. Capsule **Save run** → `handleSave` (:223-246) → Store `saveTrackedRun` (:2455-2550; `activity_sessions` + `activity_segments`). Success → `tracker.discard()` and `/history`; failure → reason shown, the run is kept |

### 1.8 Program (`pages/Splits.tsx`, `/train/program`) and its sheets

**Ways in:**
- Train "Build my program" (`Workout.tsx:1310-1325`).
- Today's Contents → Program (`Dashboard.tsx:311`) and the capsule action `program` (`todayModel.ts:36`).
- App search (`appSearch.ts:44`).

**On mount** (:77-84): `fetchSplits`, `fetchWorkoutMode`, `fetchCurrentWorkout` and `fetchFlexTemplates`.

| Surface | What shows | Actions → calls |
|---|---|---|
| Header and hero (:271-297) | "Program"; note "Flexible · build each session as you go" / "{name} · active" / "Build your first program · Start here" / "None active"; day and exercise counts, or "5 questions · about 2 minutes" | Capsule: flexible → **Start session** → `/train`; otherwise **Create program** / **New program** → `handleNew` (:109-112) → `splitEditStore.cancelEdit()`, sheet in 'new' mode |
| Training mode (:299-317) | Split / Flexible segmented control; disabled with "Finish the current workout to switch modes." while a workout exists (:129) | `setWorkoutMode` (Store :721-753; `program_preferences` upsert on `user_id` plus localStorage `program:workout-mode`). Error → `window.alert` |
| Programs list (:433-623), newest first | Name, description (2 lines), "Active · N days · M exercises"; one program and one day expanded at a time; exercise rows `sets×repsMin–repsMax` (sets shown as "min–max" when a range is set, :594-601); "No exercises assigned" | ⋯ menu (closes on outside press or Escape, :86-101): **Set active** (inactive only) → `handleSelectSplit` (:236-244) → `setActiveSplit` → `activateSplitRow` (Store :443-471), then `maybePromptPlanStart`. **Edit** → `startEdit(split, {userId})` → sheet in 'edit' mode. **Delete** → `requestConfirm` "Delete program? {name} and its training days will be deleted. Past workouts stay in History." → `deleteSplit` (Store :671-676), then `fetchSplits(force)` |
| Quick-start templates (flexible, :319-432) | "No quick-start templates yet" or rows: label, "N exercises" (non-hidden), expandable `sets×min–max` | **Start** (:363-374) → `tapHaptic` + `startFlexibleWorkoutFromTemplate(label)` → `startFlexibleWorkout` (`null` → alert about the in-progress split workout; an unfinished flexible workout is resumed instead) → `/train`. **Rename** (modal, max 40, :626-664) → `renameFlexTemplate(id, label, false)` (Store :792-859); a case-insensitive clash → `window.confirm("…already exists. Overwrite it?")` → upsert on `(user_id,label)`, then delete the original. **Delete** (modal, :666-685) → `deleteFlexTemplate` (:861-877; errors only logged) |
| Plan-start prompt (:687-724) | Shown after Set active or create when `loadPlanScheduleAsync` finds no schedule and `plan-start-prompt:dismissed:{user}:{split}` is not set | **Later** (writes the dismissed key). **Set now** → `/train` (Train shows the schedule setup) |

**Program sheet** (`components/split/SplitEditorSheet.tsx`):
- **Title:** "New program" or "Edit program".
- **Every close path** (X, backdrop, Escape, swipe-down) calls `cancelSplitEdit(close)` (:109).
- **Contents:** the chooser when the mode is 'new' and there is no draft; otherwise the editor (:103). `useSplitDraftAutosave()` is always mounted (:48).
- **Picker setup** (`handlePickExercise` :77-101):
  - The starting muscle is the source's group for swap and superset, none for add.
  - The day's exercises are excluded.
  - Unsaved custom exercises (`pendingExercises(draft)`) are added as extra rows.

**New-program chooser** (`components/split/NewSplitChooser.tsx`):
- **Unsaved program offer:** "Unsaved program "{name}" · N days, from {time}" with **Discard it** (`clearSplitDraft`) or **Resume** (`restoreDraft`) (:63, :107-130).
- **Guided:** five questions with defaults (:64-70):

  | Question | Choices | Default |
  |---|---|---|
  | Days per week | 3 / 4 / 5 / 6 | 4 |
  | Emphasis | Balanced / Upper / Lower | Balanced |
  | Equipment | Full gym / Dumbbells | Full gym |
  | Session length | 45 / 60 / 75+ min | 60 |
  | Experience | Beginner / Intermediate / Advanced | Intermediate |

  - A live preview shows "{template} · Guided · N days/week · M exercises" (`recommendProgramTemplate` / `buildGuidedTemplate`, `lib/programDesigner.ts:306-459`).
  - **Start from this plan** (:85-99) loads the library (5-minute max age), then runs `templateSplitDraft` (`lib/splitDraftSeed.ts:26-65`).
  - Missing names give the notice "Not in your exercise library, so left out: A, B.". A library failure gives "Couldn't load the exercise library…".
- **Blank:** 1–7 days, default 4 (`blankSplitDraft`, `splitDraftSeed.ts:9-19`). Seeding calls `startNew`, which marks the draft as edited.

**Editor** (`components/split/SplitEditor.tsx`, `editor/*`):

| Element | Behaviour | Store action (`stores/splitEditStore.ts`) |
|---|---|---|
| Restore banner (`RestoreBanner.tsx:19-41`), only while the draft is untouched | "Unsaved edits from {age} are on this device." plus "The program has changed since. Restoring replaces those changes when you save." when the saved program's fingerprint changed | **Restore** → `restoreSaved` (:251); **Discard them** → `dismissRestore` (:257) |
| Program name (max 60) / Description (max 200) | Commit on blur or Enter (`CommitInput.tsx:14-39`) | `renameSplit` :357, `updateDescription` :361 |
| Training days (sortable) | "Add day" adds "Day {n+1}", expanded (:70-75). Days start collapsed except in a one-day program | `addDay` :396, `moveDay` :387 |
| Day card (`DayCard.tsx`) | Handle, "01" index, name or "Day N", exercise summary or "No exercises yet"; name field (max 40); ⋯ **Move day earlier / later**, **Remove day** (no confirm; Undo offered) | `renameDay` :367, `reorderDays` :378, `removeDay` :402 |
| Exercise block (`ExerciseBlock.tsx`) | One exercise, or a superset pair that drags as one unit; "Superset" plus **Unlink** | `moveExerciseTo` :419, `clearExerciseSuperset` :585 |
| Exercise row (`ExerciseRow.tsx`) | Name (tap → swap picker); "Custom · added on save" for pending customs; ✕ remove (Undo); ⋯ **Add superset** (hidden if already paired), **Move earlier / later** (or **Move superset …**) | `swapExercise` :491, `removeExercise` :609, `reorderExercise` :413, `addSupersetExercise` :534 |
| Set range cells (`SetRangeFields.tsx`) | Min sets, Sets, Max sets (1–10), Reps↓, Reps↑ (1–100); focus selects the value; commit on blur or Enter; an unchanged value sends nothing | `updateExerciseTargets` :425 |
| Row menus (`RowMenu.tsx`) | First enabled item focused; outside press or Escape closes only the menu; arrow keys cycle | — |
| Drag (`SortableList.tsx`, `@dnd-kit`) | Touch: 200 ms press-and-hold with 6 px tolerance. Mouse/pen: 4 px. Vertical only. Keyboard Space / arrows / Space with spoken positions. Commits the focused field and fires selection haptics on start (:103-115) | `moveDay` / `moveExerciseTo` |
| Footer (`EditorFooter.tsx`) | Undo bar "Removed {name}"; error text; **Cancel** / **Save** (or **Create program**), disabled while saving | `undoRemoval` :273; save via `editorActions.ts:10-38` → `saveEdit` :283; cancel via `discardSplitEdit` |

**Exercise picker** (`components/split/ExercisePicker.tsx`), shared by Program, Train and History:
- **Header:** the caller's title (default "Choose Exercise"), an optional intro, a deferred search box, and chips "All" plus 14 muscle groups. A muscle filter matches the primary or secondary group (:137-151).
- **List:** gym exercises grouped by primary muscle with counts. Calisthenics sit in one collapsed section, "Bodyweight skills and progressions", which is forced open while searching or when there are no gym results (:156-167, :333-365). Rows show "+Secondary · equipment · Compound".
- **States:** a spinner, or "Couldn't load exercises" with **Retry**, only when nothing is cached; "No exercises found".
- **Data:** cached rows show at once and refresh in the background after 5 minutes. A failed or empty refresh is ignored (:103-129). Extra rows come first, de-duplicated (:76-82).
- **Selection** (:171-206): multi-select shows checks and a footer "Add N exercises"; single-select picks and closes.
- **Custom** (:370-384; `CustomExerciseForm.tsx`):
  - **Create "{query}"** opens a name (max 80) and main-muscle form.
  - `customExercise()` (`lib/customExercises.ts:24-37`) returns a loose library match, or a placeholder `pending-exercise-{normalized name}`.

| Caller | Title | Mode | Result goes to |
|---|---|---|---|
| Program add (`SplitEditorSheet.tsx:125-135`) | Add exercises | multi-select, custom allowed, pending extras, excludes the day | `addExercises` (:519) |
| Program swap / superset | Swap exercise / Add superset exercise | single, custom allowed, source's muscle | `swapExercise` / `addSupersetExercise` |
| Train flexible (`Workout.tsx:1917-1937`) | Add exercise / Add superset exercise | single, excludes active items | `addFlexibleExercise` / `addFlexibleSuperset` |
| Train swap (`Workout.tsx:2063-2085`) | Swap for this workout | single, intro with Switch back, excludes the workout's exercises | `substituteWorkoutExercise` |
| History edit (`History.tsx:2022-2044`) | Add exercise / Add superset exercise | single | `addExerciseToWorkout` / `addSupersetToWorkout` |

### 1.9 Fuel (`pages/Nutrition.tsx`, `/nutrition`) and the food logger

**Loads:**
- `fetchMacroTarget` (:177-179; Store :3241-3260). A failed read keeps the shown targets; a successful empty read clears them.
- `fetchMonthLogs` (:115-175):
  - `fetchNutritionLogsWithFoods` for the month (`lib/nutritionLogQueries.ts:42-80`; `nutrition_logs`, then `foods` in chunks of 200), plus `nutrition_groups` for the range, ordered by `sort_order` (:141-147).
  - A latest-request gate applies (`lib/nutritionMonthLoad.ts:57-68`). The skeleton shows only for a month not yet on screen.
- **Default groups** (:256-318): viewing a day inserts any missing Breakfast / Lunch / Dinner `nutrition_groups` rows for it, then normalizes their order (`persistGroupOrder` :240-254). A day that failed is not retried that session (`shouldEnsureDefaultGroups`, `nutritionMonthLoad.ts:22-36`).

**What the person sees:**

| Element | Behaviour | Lines |
|---|---|---|
| Capsule **Log food** | Past day: "Adds to EEEE, MMM d". Today: "N kcal left · N g protein to go" or "N kcal over target" | :456-466, :779-789 |
| Title "Fuel" | "Today · MMM d" or "EEEE, MMM d" (+ year when not this year) | :475-484 |
| Energy hero | Eaten kcal "of {target}" / "On target"; one hairline segment per 100 kcal; over-target flag | :487-518, :447-455 |
| Seal marks | Calories met at 97–105% of target, protein at ≥ target. Celebration once per day per macro per device, live day only, 700 ms after filling | :437-445; `useTargetSeal.ts:20-36`; `targetSeal.ts:10-17, 40-56` |
| Macro rails | Protein, Carbs, Fat vs target (g). Target fallback uses `||`, so a saved 0 falls back to 2000 / 150 / 200 / 65 | :425-432, :521-547 |
| Week strip | **Sunday-start**; previous / next week; calendar button; "has logs" dot; today marker | :222-226, :550-604 |
| Meals section | Count, **Add meal**, empty text ("Nothing logged yet" / "No entries on MMM d"), ledger | :607-659 |
| Jump to date sheet | Sunday-first month grid with dots; previous / next month; pick selects and closes | :662-724, :69-86 |
| Add meal or snack sheet | Meal / Snack | :726-746 |
| Logger sheet "Log food" / "Edit entry" | Hosts `MealLogger` | :749-773 |
| Toast "Entry saved" | 2 s after any save | :189-195, :472 |

**Actions:**

| Action | Handler | Writes |
|---|---|---|
| Pick a day (strip or sheet) | `pickDate` :216-222 | Local state; a month change refetches |
| Tap an entry | :642-647 | Opens the logger in edit mode |
| Delete an entry (✕, **no confirm**) | `handleDeleteEntry` :197-214 | `nutrition_logs` DELETE by id; 300 ms exit; the row returns on failure |
| Move to a group (grip sheet; mouse drag on web) | `moveEntry` :377-391 | UPDATE `{group_id, sort_order = count in target, meal_type = legacyMealTypeForGroup(group)}`. Failure is console only |
| Move to yesterday | `moveEntryToPreviousDay` :363-375 | `planEntryDayMove(-1)` (`lib/entryDay.ts:41-64`) → UPDATE `{date, logged_at}`, refetch. Offered on every row of today when any of today's entries was logged before 05:00 and it is still before 05:00 (:650-654; `isLateNightEntry`, entryDay.ts:73-86) |
| Add meal / snack | `createGroup` :330-358 | INSERT `nutrition_groups {kind, label:null}`, placed by the **current clock** against 08:00 / 12:00 / 18:00 (`lib/nutritionGroups.ts:5-9, 27-44`) |
| Move group up / down | `reorderGroup` :393-404 | `moveNutritionGroup` refuses to break Breakfast < Lunch < Dinner (`nutritionGroups.ts:83-98`); UPDATE `sort_order` per changed group |
| Delete a custom group | `deleteGroup` :406-425 | `confirm()`; unassign its logs (`group_id`, `meal_type` → null), then delete the group |
| Close the logger | :751-760 | Ignored while saving; confirms if an analysis is running or a photo estimate is unseen |

**Day ledger** (`components/nutrition/NutritionGroupLedger.tsx`):
- **Sections:** "Unassigned" first (only with entries or during a drag), then groups in sort order (:280-287).
- **Group header:** Breakfast / Lunch / Dinner by label, else "Meal N" / "Snack N" (`nutritionGroups.ts:100-106`). Shows a count, up / down, trash (custom groups) and kcal.
- **Entry row:** grip → "Move food" sheet (:289-314); tap → edit. Detail line `h:mm a` · serving label · g protein · source label. Then kcal (`round(calories × servings)`), Move to yesterday and ✕.
  - The time comes from `logged_at`, else `created_at`, else local noon (`nutritionLogUtils.ts:22-26`).
  - A composed meal adds an "N ingredients" disclosure (:171-196).
- **Order** within a section: `sort_order`, then time (:86-88).
- **Source labels** (:45-58):

  | Source | Label |
  |---|---|
  | `meal_builder` | Meal |
  | `manual` or empty | Manual |
  | `usda` | USDA |
  | `cronometer_csv` | Cronometer |
  | `photo_openai` / `photo_anthropic` | OpenAI photo / Claude photo |
  | `gemini_label` | Gemini · label reviewed |
  | `gemini_estimate`, `gemini_trial` | Gemini estimate |
  | `barcode_fatsecret` / `barcode_open_food_facts` / `barcode` | FatSecret / Open Food Facts / Barcode |
  | Anything else, including `barcode_saved` | Manual |

**Logger shell** (`components/nutrition/MealLogger.tsx`):
- Remounts per `${userId}:${entryId | savedMealId | 'new'}` (:48-52).
- What it opens on:
  - A stored draft (`hyper:meal-draft:v1:{user}:{new | edit:id | saved:id}`) opens meal review.
  - A composed-meal entry opens the meal editor.
  - Otherwise: a **Build a meal** row above `FoodLogger`.

**Food logger tabs** (`components/nutrition/FoodLogger.tsx:1880-1907`): **Saved · USDA · Scan · Manual · Photo/AI**.
- New entries open on Saved; edits open on Manual (:170).
- The last tab reads "AI" in hosted (Gemini) mode, and "Photo" plus a dot when an estimate is waiting.
- Leaving Scan drops in-flight lookups (:220-223); leaving Manual drops a pending barcode binding (:1887).

| Tab | What shows | Actions → calls |
|---|---|---|
| **Saved** (:1911-2028) | Count, search (substring on normalized name, :330-334), loading / empty states, rows. First paint from `savedFoodsCache`; always refetches on entering Saved or Manual (:718-727) | Row → `handleLogSavedMeal` (:655-665) → review stage at 1 serving (a composed meal opens the meal builder). **Add** → `handleAddSavedMeal` (:677-689): Manual with "Save as reusable meal" on. **Edit / Done** toggle: pencil → `handleEditSavedMeal` (:667-675); trash → `confirm()` → `retireSavedMeal` (`foods.source = 'manual_entry'`, never hard-deleted, `lib/savedMeals.ts:54-62`). List: `listSavedMealRows` (`foods` with `source in (saved_meal, custom)`, limit 150) → `dedupeSavedMealsByName` |
| **USDA** (:2029-2116) | Search box; "Type at least 2 characters."; results; "No USDA matches."; failure with **Retry** | Enter or arrow → `searchUSDA` (:339-365) → `searchUsdaFoodsSecureStrict` → edge function `food-lookup {action:'search'}` (`lib/usdaClient.ts:12-28`) → `mapUsdaFood` (`components/nutrition/usdaSearch.ts:124-162`). Result without a serving label → `fetchUsdaFoodDetailSecure` (`{action:'detail'}`) → `selectPortionFromDetail` / `applyPortion` → review |
| **Scan** (:2117-2154; `BarcodeScanner.tsx`, lazy) | Starts one frame after mount. Native iOS: `NativeBarcode.getAvailability()` (10 s) then `scanBarcode()` (300 s); `CANCELLED` → idle. Web: rear camera via `getUserMedia` + `barcode-detector` (zxing wasm), every 180 ms, torch, **Stop camera**. **Enter barcode digits** (up to 14; **Look up barcode** enabled once `normalizeFoodBarcode` accepts it). "Looking up…", "Product found — review the details below.", **Scan again**, "No catalog match" with **Create a saved product for this barcode**; Open Food Facts / ODbL credit always visible (:2143-2152) | `resolveBarcode` (:87-119, 45 s timeout) → `handleBarcodeDetected` (:367-417): `findSavedFoodByBarcode` (`lib/savedBarcodeFoods.ts:20-47`), then `resolveBarcodeByPriority` (FatSecret > USDA branded > Open Food Facts, `lib/barcodePriority.ts:9-27`) via `food-lookup` actions `fatsecret-barcode`, `barcode`, `open-food-facts-barcode`; a USDA hit gets a detail fetch. A miss → Manual with a pending binding (:2121-2141) |
| **Manual** (:2155-2388) | **Describe with AI** (textarea up to 1,500 characters, at least 5 to submit); Food name with saved-meal suggestions (starts-with, then contains, max 6, :316-329); Calories / Protein / Carbs / Fat; Servings stepper (0.25 steps, min 0.25); **Save as reusable meal** / **Update saved meal**; When row | Describe (worker mode) → `handleDescribeFood` (:419-463) → `describeFoodWithAi` (`lib/foodDescription.ts:68-110`; worker `/describe`) → `applyDescribeEstimate` (:465-479), or **Fill fields with estimate** if the fields changed meanwhile. Hosted mode → "Review with Gemini" hands off to the AI tab (:421-429). Suggestion → `handleSelectSavedMeal` (:631-653). **Update saved meal** → `handleUpdateSavedMeal` (:1304-1350: insert new, retire old, warn if retiring fails). **Log entry / Save changes** → `handleManualSubmit` (:1352-1475) |
| **Photo**, worker mode (:2389-2540) | Two photo inputs (top view and 45° side; image only, ≤ 10 MB, :825-859), Retake; optional plate diameter (cm), oils and sauces, extra details; review: provider and model, "N foods found", items with name, grams, macros, status "USDA confirmed" / "Match not chosen" / "N% estimate", a **Nutrition source** sheet; **Log as one meal** (on by default, `hyper.nutrition.combine-meal`), plate total | **Analyze** → `handleAnalyzePhoto` (:880-957): JPEG compression (`fileToCompressedJpegBase64` :764-823) → `analyzeFoodPhoto` (`lib/photoAnalysis.ts:156-204`; worker `/analyze`) → USDA grounding per item (gram matches only, top 3, :913-940). **Log 1 meal / Log N items** → `handleSavePhotoItems` (:1199-1302) |
| **AI**, hosted Gemini mode (`FoodTrialLogger.tsx`; stays mounted once visited) | "Your meal" text (≤ 1,500) and/or up to 2 photos (10 MB each; first top, second side); one optional clarification question ("Use an estimate" / "Update estimate"); "Change meal"; review with totals, editable items (name, amount, unit, basis, macros, Remove), sources, When row, Save as reusable meal | **Analyze meal** (:61-84) → `analyzeFoodTrial` (`lib/foodTrial.ts:54-94`: direct POST `${VITE_SUPABASE_URL}/functions/v1/analyze-food-trial`, 110 s). **Log meal / Save changes** (editing requires exactly one item) → `handleSaveTrialItems` (`FoodLogger.tsx:1165-1197`) |

**Review stage for a chosen food** (`FoodLogger.tsx:1691-1871`):
- Shows the name, provider or confidence line, and kcal / P / C / F per basis.
- **Amount** and **Unit** (serving, plus g / oz / lb / kg for weight foods or ml for volume foods, `foodLoggerUtils.ts:79-93`). Unit changes convert the amount; failures read "Can't convert …".
- **Describe amount** (`ServingEntry.tsx`): Gemini `interpret-serving` through `analyze-food-trial`, with **Use this amount**.
- The When row, a "This entry" line, and **Change food**.
- **Log entry / Save changes / Add ingredient** → `handleSaveFromSelectedFood` (:1125-1152) → `upsertFoodIfNeeded` (:959-1085) → `saveNutritionEntry` (:1087-1123) → `persistNutritionEntry` (`lib/saveNutritionEntry.ts:14-38`).

**When row** (:1478-1512):
- **DateField** (no future days), **TimeField**, and an **Add to** sheet (Unassigned plus the page day's groups).
- If the entry date differs from the page's day, the group clears and the row reads "Unassigned on MMM d".

**Pickers** (`components/shared/DateTimePicker.tsx`):
- **DateField** (:37-161): "Today" / "Yesterday" / "EEE, MMM d"; chips; month navigation; Sunday-first grid; days after `max` disabled.
- **TimeField** (:290-366): "h:mm AM"; **Now** chip; three snapping wheels (12-hour hours, minutes 00–59, AM/PM) with a tap haptic per step (`lib/wheelSelection.ts`). Stored as 24-hour "HH:mm" (:263-275).

**Meal builder** (`MealLogger.tsx`):
- **New draft** (`makeDraft` :58-63):
  - Empty name; date = the entry's or selected day; time by the logger rule; group carried over.
  - Method `'barcode'`; `entryId = crypto.randomUUID()`.
  - Saved to localStorage on every change. If that fails: "This device couldn't keep your latest changes…".
- **Capture:** every tab adds ingredients. A composed meal expands into new ingredient ids (:106-118). Tray: "N ingredients · kcal", **Review meal**.
- **Review:**
  - Meal name (≤ 500), totals, ingredient amounts (> 0), Remove.
  - Add ingredients, Date / Time, Add to, Save as reusable meal.
  - **Log meal / Save changes / Retry save**, which requires a name, at least one ingredient, a time and no invalid rows (:163).
- **Save** (:119-146):
  1. `resolveMealDestination` checks the group still exists for the same user and day (`lib/mealDestination.ts:10-26`). If not, the meal goes to Unassigned with an error.
  2. The draft is locked, then `saveComposedMeal` (`lib/saveMealComposition.ts:13-67`):
     - The `getUser` owner check must pass.
     - It upserts a `foods` row with `id = entryId`, `serving_unit 'meal'`, and the description as the encoded ingredient list.
     - It logs `{servings:1, source:'meal_builder'}` by `entryId`.
     - Editing a saved meal retires the old row and logs nothing.
- **Header:** **Discard draft**. After a failed new-meal save, **Back to food logging** pauses the draft, and the logger offers **Resume pending meal**.

### 1.10 History (`pages/History.tsx`, `/history`)

**Ways in:**
- Today's Contents and the done-day capsule.
- After saving a run (`RunTracker.tsx:234`).
- App search (`appSearch.ts:47`).

**Month load** (`fetchMonthWorkouts`, :800-861):
- `fetchWorkoutsByMonth` (Store :1835-1860; `workouts` with nested `sets` and `exercises`, by `date`).
- `fetchActivitySessionsByMonth` (Store :1908-1932; `activity_sessions` where `dismissed_at IS NULL`).
- Direct queries from the page: `split_days(id, day_name)` and `workout_day_plans(workout_id, day_label)` for titles.
- Movement notes are parsed with unsaved drafts merged in. Only the latest month request writes (:711-713).
- `fetchWhoopConnection` runs on mount (:864).

| Surface / action | Handler | Calls |
|---|---|---|
| Month ‹ › | :1343-1364 | Flush notes (`flushAll`), then refetch (:1107-1117) |
| Calendar day tap (an out-of-month day switches month) | :1408-1413 | Local. Grid is **Sunday-first** (`buildCalendarDays` :609-622; header S M T W T F S :1371); cells show the first workout title +N and lift / activity marks |
| Day header "N lifts · M activities" | :1009-1018 | — |
| **Sync** (preview or WHOOP connected) | `handleSyncWhoop` :1135-1165 | `syncWhoop` (Store :2167-2384); clears the segment cache, refetches; toast "Synced • n new • m updated" / "Up to date" / "Sync unavailable" / "Sync failed" |
| **+ Activity** | :1461 | Opens `ActivityEditor` |
| Workout row expand | `handleToggleWorkout` :1314-1320 | `fetchWorkoutDayPlanByWorkoutId` once per workout |
| Row title / subtitle | :1487-1495 | `resolveWorkoutTitle`; `formatWorkoutDuration(getWorkoutDurationMs)`; "x/y sets"; a check or a percentage |
| Activity stats panel: attach / cancel / remove | `WorkoutActivityPanel` :358-465; :902-921 | `attachWhoopToWorkout` / `detachWhoopFromWorkout` (Store :2386-2453); hint from `searchWhoopForWorkout` (:891-900) |
| **+ Add exercise** (picker, excludes current) | :1578-1589, :2025-2041 | `addExerciseToWorkout` (Store :2673-2709) |
| Move earlier / later | :1676-1705 | `reorderWorkoutExercises` (Store :3202-3239). A plain neighbour swap: **superset pairs do not move together** |
| Superset / Unlink | :1722-1736 / :1710-1720 | `addSupersetToWorkout` (:3017-3094) / `clearWorkoutSuperset` (:3096-3110) |
| Remove exercise | `handleRemoveExercise` :1266-1281 | `removeExerciseFromWorkout` (:2711-2757); also cancels its note draft |
| Target sets (1–12, saved on blur) | `handleTargetSetBlur` :1283-1312 | `updateWorkoutExerciseTargetSets` (:3112-3200) |
| **+ Add set** | `handleAddSet` :1253-1258 | `addSetToWorkout` (:2552-2599) |
| Set ✎ → "Edit set" (Weight lbs / Reps / RPE) | `SetEditor` :89-144; `handleUpdateSet` :1231-1251 | `updateSet` (:1784-1801) |
| Set ✕ (no confirm) | `handleRemoveSet` :1260-1264 | `removeSetFromWorkout` (:2601-2671) |
| Movement note (200 characters) | :1085-1105; autosaver :738-789 | `updateWorkoutNotes` (:2813-2829) |
| Delete session (confirm "cannot be undone") | :1864, :1982-2000; `handleDeleteWorkout` :1119-1133 | `deleteWorkout` (:1880-1906) |
| Activity row: expand splits (≥ 2 segments from the activity's own source), edit, delete | `ActivityLedgerRow` :467-603 | Segments loaded per day (`fetchActivitySegmentsBySessionIds`, :954-988); `LapPaceChart`; # / Time / Dist / Pace table |
| **Merge activities** → checkboxes → **Merge** (≥ 2) / **Cancel** | :1883-1920; `handleMergeActivities` :931-951 | `mergeActivitySessions` (:1979-2010) with `planActivityMerge`; selection clears on day change |
| Add / Edit activity modal: type (11), custom name ("other" only, ≤ 40, suggestions), title, Date, Start, Duration (1–1440 min), Notes (≤ 280) | `ActivityEditor` :219-335; `handleSaveActivity` :1167-1199 | `createActivitySession` / `updateActivitySession` (:1934-1973) |
| Delete activity (confirm) | `handleDeleteActivity` :1201-1229 | Hide (`dismissed_at`) or delete, decided by `hasLinkedWhoopSegments` (:2028-2046) |
| Toast | `showToast` :728-736 | 1.5 s: "Saved", "Could not save", "Note not saved", and the sync messages |

History does **not** edit past nutrition: that happens in Fuel by choosing a past day. History also cannot change a workout's date or start time; only activities have editable date, start and duration.

### 1.11 Coaching (`pages/Analysis.tsx`, `/analysis`)

- **On mount:**
  - `calculateWeeklyVolume()`. An empty list counts as loading until the first read finishes (:111-118, :131-133).
  - `fetchTrainingHours`, a direct page query on `workouts`: `date, completed, completed_at, created_at` with `completed=true` and `created_at ≥` the Monday 7 weeks back (:73-109).
  - `WeeklyNutrition` calls `fetchMacroTarget`.
- **Header:** `BackLink` "Today"; "Coaching"; "Week of <Monday>" (:150).
- **Hero:** "in range / trained" muscles, `WeekSegments`, and the insight line. With no volume: "0 muscles trained" and the capsule **Start training** → `/train` (:136-144).
- **Muscle map** (`components/coaching/VolumeMaquette.tsx:61-241`):
  - A three.js figure on capable devices, which can be dragged to turn and tapped by muscle. Otherwise a flat SVG front and back.
  - A readout, Front / Back buttons and a legend.
  - A tapped delt with no row of its own opens "shoulders" (:189-194).
- **By muscle:** rows sorted by coaching priority, then by sets descending (:120-126). `MuscleRow` (:321-409) shows sets, a chip, a headline (`buildCoachingCall` :36-53) and a `VolumeRail`. Expanded: MV, MEV, MAV range, MRV and the `getVolumeRecommendation` message.
- **Training hours:** `TrainingHoursHistogram`, 8 weeks; peak week highlighted; axis max = max(peak, 60 min); drag readout; 8-week total.
- **Nutrition:** `WeeklyNutrition`, calorie and protein bars over the **rolling last 7 days** against a dashed target. The average counts logged days only (`WeeklyNutrition.tsx:35-36`; `useWeeklyNutrition.ts:47-96`).
- **Explainer:** a 4-item landmark accordion (:55-60, :244-276).

### 1.12 You / Settings (`pages/Settings.tsx`, `/settings/*`)

**Loads on every mount:**
- `loadTargets` (:295-312): a direct `macro_targets` select plus `getNutritionProfile`, written with `useAppStore.setState`.
- `fetchWhoopConnection` (:314-316).
- 60-day body-weight history (`getBodyWeightHistorySince`, :255-267).
- Saved meals (:507-546).

**Shared behaviour:**
- **Search** (magnifier): `SettingsSearch` → `searchApp` (`lib/appSearch.ts:16-93`).
  - Curated entries, aliases, one-edit fuzzy matching. Apple Health is listed only on iOS.
  - A result navigates to `#search-<id>`, which focuses, scrolls and highlights for 2.4 s. `#search-log-weight` opens the sheet instead.
- **Focus:** the row that opened a page gets focus back on return (:114-130).
- **Unsaved-change guard** (:855-911):
  - Dirty map: name, targets, worker, meal edit, coach and weigh-in.
  - `useBlocker` with `shouldBlockSettingsExit` (`lib/settingsUx.ts:12-27`) plus `beforeunload`.
  - "Discard unsaved changes?" modal (:2116-2161). While busy it reads "Saving changes / Wait for the current save to finish".
- **Calculator and coach stay mounted** (hidden) after their first visit (:155-158).

| Sub-page | What shows | Actions → calls |
|---|---|---|
| `home` (:1056-1174) | Search; "You" + name or "Your personal space"; **Edit profile** → `account`. Weight block: latest weight, unit, "MMM d · source_name"; 30-day spark and "±x.xx lb/wk · 3-wk rate" when ≥ 2 fitted days (`buildWeightTrend`, `windowDays: 21`, :231-242); **Details ›** → `weight`. Rows: Nutrition targets, Saved meals, Food analysis, Connections ("WHOOP connected/not connected · Health on/off"), Appearance, Training ("Adaptive split scheduling on/off"), **Start a run** → `/train/run`, Account, About | Capsule **Log weight** (:975-991; sublabel "Last X lb · today/MMM d" / "History unavailable" / "First weigh-in") |
| `account` (:1175-1215) | Display name | **Save name** (when changed) → `authStore.updateDisplayName` (`authStore.ts:209-233`, `profiles.update`). **Sign out** → `window.confirm` "Sign out?" / "Sign out and discard unsaved edits?" → `authStore.signOut` |
| `training` (:1216-1220) | `AdaptiveSplitSchedulingSetting` switch (`components/settings/AdaptiveSplitSchedulingSetting.tsx:6-50`) | → `saveAdaptiveSplitScheduling(!enabled)` (`lib/adaptiveSplitScheduling.ts:13-33`, `auth.updateUser({data:{adaptive_split_scheduling}})`); "Saving…"; error "Couldn't save this setting. Your previous choice is still active." |
| `appearance` (:1221-1254) | Follow system / Ivory (light) / Black (dark) | `tapHaptic` + `themeStore.setTheme` |
| `targets` (:1255-1379) | kcal plus P / C / F; "Saved targets · {mode}" / "Starting defaults — not saved"; rows Calculate targets and Get target suggestions; with a profile, "Automatic adjustments": estimated daily burn plus confidence (`expenditureDisplay` :681-700) and "How targets adapt" | **Edit targets** / **Continue editing targets** → `targets/edit`; **Retry targets**; **Resume adaptive targets** (manual source only) → `handleResumeAdaptiveTargets` (:749-773): `updateMacroTarget({source:'calculated'})`, then `refreshAdaptiveTargets({force:true})` |
| `targets/edit` (:1397-1511) | 4 whole-number inputs; any edit makes the draft `manual` (:744-747); drift warning when \|kcal − (4P+4C+9F)\| / kcal > 5% (:1011-1015); latest coach suggestion when manual | **Save targets** → `handleSaveMacros` (:824-839) → `updateMacroTarget` (Store :3262-3286, `macro_targets` upsert on `user_id`). **Review new suggestions** |
| `targets/calculate` (:1512-1525) | `NutritionWizard`, 6 steps: units + sex; body (age, weight, height); optional body fat; activity (5 levels); goal (cut / maintain / lean bulk / bulk) + rate (±0.05; gains per month ×4.345); review (kcal, TDEE, macro % and g, projection, BMR method) | **Save profile & review targets** → `handleApplyCalculatedTargets` (:796-822): `updateNutritionProfile` (Store :3301-3315), `recordManualBodyWeight` if the weight differs by > 0.05 kg, then targets staged as `calculated` |
| `targets/coach` (:1526-1541) | `GoalsCoach`: goals (5–2000 characters, saved as `hyper.coach.goals`), "Include daily-burn estimates and recent weight trend", worker status and setup link | **Get target suggestions** → `askCoach` (`GoalsCoach.tsx:49-99`) → `requestCoachRecommendation` (`lib/nutritionCoach.ts:142-183`; worker `/coach`) → staged as manual targets (:731-741) |
| `targets/adaptation` (:1380-1396) | Explanation, Body weight row | — |
| `meals` (:1542-1679) | Saved meals (de-duplicated): name, "kcal · P · C · F" | Pencil → `beginEditingMeal` (:564-590): composed → `MealLogger` modal (:2034-2055); simple → inline **Save** → `saveMealEdit` (:592-638: `insertSavedMeal` then `retireSavedMeal`, warning if retiring fails). Trash → `confirm()` → `removeSavedMeal` (:640-663). **Retry meals** |
| `analysis` (:1680-1740) | Hosted (Gemini) / Your Mac (worker), stored in `hyper.food-analysis.mode` | `saveFoodAnalysisMode`; **Check analysis usage** → `handleFoodTrialStatus` (:352-372) → `analyze-food-trial {action:'status'}` → `summarizeFoodTrialStatus` |
| `analysis/worker` (:1741-1797) | Worker URL; provider (OpenAI Codex / Anthropic Claude) | **Save & test connection** → `handlePhotoWorkerSave` (:374-395) → `savePhotoWorkerSettings` (localStorage + `auth.updateUser({photo_worker_settings})`) → `checkPhotoWorker` (GET `/health`, 5 s) |
| `connections` (:1798-1820) | WHOOP status; Apple Health (iOS) or "available in the iPhone app" | — |
| `connections/whoop` (:1821-1870) | Connected: "Connected • synced X ago / never synced" | **Connect** → `handleWhoopConnect` (:419-454): `connectWhoop(returnTo)` → `whoop-oauth {action:'start'}` → iOS `NativeAuth.openOAuth({callbackHost:'settings'})` and read `?whoop=`; web `window.location.href`. **Sync now** → `syncWhoop` ("Synced — X new, Y updated." / "Up to date." / "Sync unavailable."). **Disconnect** → `disconnectWhoop` (Store :2154-2165 → `whoop-oauth {action:'disconnect'}`) |
| `connections/health` (:1871-1893) | Apple Health state | **Connect Apple Health** / **Sync now** → `handleHealthWeightSync` (:323-344) → `enableNativeBodyWeightSync` / `syncNativeBodyWeights`. "Imported N Apple Health weight entr(y/ies)." **Stop automatic sync** clears the device flag only (:346-350) |
| `weight` (:1894-2004) | Latest weight with time and source; Trend and 3-week rate; "Trend smoothed over N weigh-ins."; 90-day chart with drag readout (only 60 days are loaded); recent weigh-ins `history[1..5]` | **lb / kg** → `handleToggleWeightUnit` (:244-253); **Retry history**; Health sync row |
| `about` (:2005-2028) | Wordmark; "Built on peer-reviewed research"; build stamp `__BUILD_ID__` (Vite define) | Tap stamp → `tapHaptic` |
| Modals | **Log weight** (:2056-2115; step 0.1; placeholder last weight or 180.5 / 82.0; unit switch) → `handleRecordWeighIn` (:269-293) → `recordManualBodyWeight(userId, kg)`. **Replace your target draft?** (:2162-2205). **Discard unsaved changes?** **Edit saved meal** (MealLogger) | — |

---

## 2. Behaviour rules that must survive

Each rule cites where it lives. Where a rule is in `src/lib` or a store, the native app gets it by calling that code. Where it is in a page or component, Section 3 lists it for extraction. Appendix D lists the tests that protect these rules.

### 2.1 Food logging with time (protected)

**Which day an entry belongs to**
- `date` is the local calendar day chosen for the entry (`format(entryDate, 'yyyy-MM-dd')`).
- `logged_at` is that local date plus the chosen `HH:mm`, stored as a UTC instant (`buildLoggedAt`, `components/nutrition/foodLoggerUtils.ts:158-172`; `FoodLogger.tsx:1095-1110`).
- The day always comes from `date`; it is never recomputed from `logged_at`. Every read filters on `date` (`lib/nutritionLogQueries.ts:51-56`; `lib/todayDay.ts:74`). After crossing a time zone the shown times move, but each entry keeps its day.

**Default time**
- Today: the current clock.
- Past day: the clock time of the page's selected `Date`. That is **00:00** whenever the day came from the week strip or month sheet, because those produce midnight dates (`FoodLogger.tsx:159-166, 204-207` with `Nutrition.tsx:216-226`; the same rule in `MealLogger.tsx:61`).
- Editing: the time comes from `logged_at` in local time, and the date from the entry's `date` at noon. An unreadable time falls back to 12:00 (`foodLoggerUtils.ts:152-156`).

**No future days** (`FoodLogger.tsx:1490`; `MealLogger.tsx:187`).

**Order on screen:** `logged_at`, else `created_at`, else local noon of `date` (`nutritionLogUtils.ts:16-26`). Within a group, `sort_order` comes first (`NutritionGroupLedger.tsx:86-88`).

**Late-night correction** (`lib/entryDay.ts:41-86`):
- "Move to yesterday" is offered only before 05:00, on today, when an entry was logged before 05:00.
- It shifts both `date` and `logged_at` back one local calendar day, and is safe across DST.

**Save payload** `{food_id, servings, meal_type, group_id|null, source, date, logged_at}`:
- `meal_type` mirrors the chosen group: its label for Breakfast / Lunch / Dinner, `snack` for snack groups, otherwise null.
- It never falls back to the entry's old `meal_type` (`FoodLogger.tsx:1099-1110`; `lib/nutritionGroups.ts:108-112`).

**Retry safety**
- Each new entry gets a pending UUID. A retry reuses it through an upsert, and it is cleared after each confirmed save (`lib/pendingEntryId.ts:6-27`; `lib/saveNutritionEntry.ts:26-37`; `FoodLogger.tsx:188, 1113-1115`).
- Edits are an UPDATE by `id` and `user_id`. The meal builder and AI items pass explicit retry ids (`FoodLogger.tsx:1177-1178`; `lib/saveMealComposition.ts:58-66`).
- When an owner is expected, the save checks the account still matches (`saveNutritionEntry.ts:20-24`).

**Failures**
- An entry save failure shows "Could not save this entry. Your changes are still here." and keeps every field (`FoodLogger.tsx:1112-1122`).
- Photo multi-item save: each saved item leaves the list, and the error says to retry the rest (:1281-1298).
- AI items remember item → entry id and item → food id between attempts (:184-185, :1176-1194).

**Destination**
- If the entry's date differs from the page's day, the group is cleared and the row reads "Unassigned on MMM d" (`FoodLogger.tsx:226-230, 1504-1510`).
- The meal builder re-checks that its group still exists for that user and day (`lib/mealDestination.ts:10-26`).

**Meal groups**
- Viewing a day creates its Breakfast / Lunch / Dinner rows (`Nutrition.tsx:256-318`).
- A new meal or snack is placed by the current clock against 08:00 / 12:00 / 18:00 (`nutritionGroups.ts:5-9, 27-44`).
- Breakfast < Lunch < Dinner order is enforced (:83-98).
- Database rules: named groups are unique per user, date and label (migration `20260716120000_*.sql:27-29`); logs reference groups by the composite `(group_id, user_id)`.
- Deleting a custom group unassigns its entries first (`Nutrition.tsx:410-417`).

**Food rows** (`upsertFoodIfNeeded`, `FoodLogger.tsx:959-1085`)
- **USDA:** reuse a row only when `fdc_id`, `serving_size` and `serving_unit` all match (defaults 100 g). Otherwise insert a shared row (`user_id` NULL, source `usda`). Existing rows are never changed, because past logs point at them.
- **Open Food Facts / FatSecret:** `persistExternalFood` reuses by `(user_id, external_source, external_id)` or inserts (`lib/foodPersistence.ts:64-107`). The Open Food Facts id is the barcode; the FatSecret id is `foodId:servingId`.
- **custom / saved_meal / manual_entry:**
  - Reuse by id.
  - Temporary ids (`''` or `photo-…`) insert a new row with `user_id`.
  - If the database lacks the serving columns, the insert retries without them (`shouldDropColumn`).
- **Manual submit** picks the food row in this order (`FoodLogger.tsx:1384-1447`):
  1. The picked saved meal, if its values are unchanged.
  2. With "Save as reusable" on: an existing saved meal with the same name and macros (±0.05).
  3. Otherwise a new `saved_meal` row.
  4. When editing: the original row.
  5. A cached one-off from a failed attempt.
  6. A new `manual_entry` row.
- **An edit that changes neither name nor macros** reuses the original row, so `fdc_id`, basis and saved-meal link survive (:1416-1427).
- **Saved meals:**
  - `foods` rows with source `saved_meal` or `custom`; up to 150, de-duplicated by name with the newest kept.
  - "Delete" retires the row to `manual_entry` and never hard-deletes it (`lib/savedMeals.ts:7-62`).
  - Editing a composed meal writes a new food row, so past logs keep their recipe (`saveMealComposition.ts:12, 31-55`).
  - Worker-photo foods are saved as `custom`, so they appear in Saved (`FoodLogger.tsx:1250, 1276`).

**Sources written to logs:** `manual`, `usda`, `barcode`, `barcode_saved`, `barcode_open_food_facts`, `barcode_fatsecret`, `photo_openai`, `photo_anthropic`, `gemini_label`, `gemini_estimate`, `meal_builder` (`FoodLogger.tsx:1139-1144, 1193, 1219, 1466`; `saveMealComposition.ts:63`).

**Known quirk:** editing one entry and then logging several worker-photo items separately updates the same row each time, so the last one wins (`FoodLogger.tsx:1264-1291` with :1113). The AI tab requires exactly one item when editing (:1175).

### 2.2 Workout start, log and complete; set persistence (protected)

**Start and resume**
- `startWorkout` resumes the newest unfinished workout started within 24 h, **even when a different day was tapped** and even across midnight (Store :918-938; `canResumeWorkout`, `lib/workoutSessions.ts:83-95`).
- An abandoned split start (no sets, no notes) is deleted and recreated (`workoutSessions.ts:105-111`; Store :939-942).
- `workouts.date` is the device-local date at start (Store :944, :1055).
- Placeholder sets 1..`target_sets` are inserted in one request. A failure deletes the new workout (Store :255-287, :962-982).
- **Flexible starts** (Store :1005-1140):
  - A template copies its items and creates sets for the non-hidden ones.
  - An existing flexible session is resumed, and its plan is repaired from saved sets if missing.
  - An unfinished split workout makes the start return `null`.
- Workouts older than 24 h are never shown as live (Store :1165-1202). The mode cannot be switched mid-workout (Store :725-727).

**Save before rest**
- Rest starts only from `onComplete`, which runs after `await logSet` resolves (`WorkoutSetRow.tsx:114-121` → `Workout.tsx:1038-1048`).
- Editing an already-completed set never starts rest (`Workout.tsx:1041`).

**Failed saves keep the numbers and offer Retry**
- The draft stays, with "Couldn't confirm this set was saved. Your numbers are still here…" (`WorkoutSetRow.tsx:130-133`).
- The ledger reads "Not saved · Retry" and the capsule switches to `retry` (`workoutCapsule.ts:52-53`).
- Capsule-supplied values become the row draft before saving, so Retry resends exactly what was shown (`WorkoutSetRow.tsx:86-93`).

**Automatic retry and auth recovery** (`runSaveWithRetry`, `lib/saveWorkoutSet.ts:44-66`)
- 8 s per attempt, 2 attempts. It retries on its own timeout, a thrown `TypeError`, or status 0 / 408 / 429 / 500 / 502 / 503 / 504.
- Both attempts send the same payload and the same `completed_at` (:73).
- A timeout records a diagnostic and starts `recoverAuthSession`. Every attempt first waits for `pendingAuthRecovery()` (`lib/authResume.ts:101-120`). A rejected write records only a code (:84-97).
- `completeWorkout` uses the same wrapper (Store :1812-1821).
- Under Expo's `fetch`, network errors are `FetchError` rather than `TypeError`. PostgREST still turns them into status 0 (`native/node_modules/@supabase/postgrest-js/dist/index.mjs:425-458`), so this retry keeps working. The direct-`fetch` callers in §5 do not.

**Saves address the immutable set id**
- `logSet` finds its target by `set.id`, never by `set_number` (Store :1760-1763).
- The row checks that the live workout still holds that id and exercise. Otherwise it shows "This workout set is no longer active." and records `inactive-local-row` (`WorkoutSetRow.tsx:108-113`).
- A slow response never writes into a different workout (Store :1766-1768).

**Adding and removing sets**
- Concurrent Add taps share one insert per account generation × workout × exercise. Live and History share this guard (`workoutSetAddFlight`, Store :494-500, :1288, :2554).
- The next number is max + 1. The new row is merged unless a read already brought it in (:1313-1322).
- Remove takes the highest-numbered unfinished set (:1724-1754).
- Both fail silently in the live session (console only).

**Set counts**
- Split: add while the count is below `maxSets`; remove only above `minSets` and when an unfinished set exists. With no plan the range is min 1, target = count, max 12 (`Workout.tsx:1953-1956`).
- Ranges come from a `[set-range]{"min","max"}` line in `notes`, clamped 1–10 (`lib/setRangeNotes.ts`).
- Flexible target sets are 1–12, default 3, with default reps 8–12 (`Workout.tsx:61-64`; Store :219-231).
- `planSetCountChange` (`lib/workoutPlanOps.ts:14-43`, shared with History):
  - Growing numbers new sets after the highest existing number.
  - Shrinking removes unfinished sets from the top down, never finished ones and never below the target.

**Drafts survive closing rows**
- Drafts live in each `WorkoutSetRow`. Collapsed rows and movements stay mounted (hidden / `inert`), so drafts survive (`WorkoutSetRow.tsx:33, 197, 231`; `Workout.tsx:2322-2347`). The same holds during a drag (`MovementReorderList.tsx:220`).
- Drafts are lost when Train unmounts or the workout changes. They are not persisted.
- After a save the editor closes, unless the person selected another set meanwhile. A late save never moves the person (`components/workout/workoutFocus.ts:19, 32-36`).

**Supersets move together and log in rounds**
- Pairs are blocks for both pointer and keyboard; a drop never lands inside a pair (`components/workout/movementOrder.ts:8-29`).
- **Round order:** A_n requires B_(n−1); B_n requires A_n ("Complete A2 before logging B2.", `Workout.tsx:1069-1093`). It is checked through `onBeforeComplete` before any write (`WorkoutSetRow.tsx:101-107`).
- **Flow:** A_n → B_n → A_(n+1); eligibility skips sets whose earlier round is unfinished (`workoutFocus.ts:50-81`). Rest starts only after B, or after an unpaired set (`Workout.tsx:1045-1047`).
- **Pairing source:**
  - Split sessions use the session plan items when a day plan exists, otherwise `split_exercises.superset_group_id`.
  - Flexible sessions use plan items.
  - Only groups of exactly 2 pair (`Workout.tsx:195-207, 884-926, 1050-1067`). At most 2 per group (Store :1424-1505).

**Reorder restores on failure**
- The preview order stays until the save settles.
- On failure: "Could not save the order. Your previous order is restored. Drag again to retry." The store is untouched and the scroll position restored (`MovementReorderList.tsx:101-135`; Store :3228-3238).
- One write per drop. It changes the session plan order only, never sets or the program (Store :3221).
- The drag cancels on pointer cancel, window blur, a width change, a hidden page or a membership change (:191-213, :267-273).

**Movement notes** (shared with History)
- 200 characters, trimmed. Stored as JSON `{movementNotes, legacyNote}`; legacy plain text is preserved (`lib/workoutNotes.ts:6-53`).
- Saved after a pause (1.2 s on Train, 1 s on History), on blur, when the page is hidden, on unmount and on workout change (`Workout.tsx:413-433`).
- One write queue per workout. Plan edits run after the flush (`lib/noteAutosave.ts:12-29, 196-202`).
- A failed save keeps the draft and retries on the next edit or flush (:100-102, :161-174). A background refresh never overwrites an unsaved draft (:219-227).
- A cleared note is stored as `''`, so a template note does not come back (`Workout.tsx:703-706`).

**Finish**
- A confirm appears only when sets remain (`Workout.tsx:1249-1252`); flexible sessions also get the template prompt.
- The summary is built before completing, because the store clears the session on success. Pending notes and plan-note patches land first (:1229-1234).
- `completed_at` = the latest completed set's `completed_at`, else now (Store :289-301, :1803-1833).
- On failure the session stays open with `finishError`.
- Weekly volume is recomputed in the background (:1832), and the stored rest timer is cleared.

**Autofill, last time and gains**
- Set 1 takes the previous workout's same `set_number`. Set 2 onward takes this workout's latest completed lower-numbered set (`lib/setAutofill.ts:21-56`).
- The display index is the ledger position, but history matching uses the stored `set_number` (`Workout.tsx:1883-1890`).
- "Last workout" draws on the last 30 workouts dated on or before the session (completed or not), excluding this one, completed sets only, newest per exercise and set (`lib/previousSetTargets.ts:84-121`). A failed lookup is retried on the next log (`Workout.tsx:687-691`).
- **Loggable values:** weight ≥ 0, integer reps ≥ 0, RPE empty or 1–10; zero is valid (`lib/workoutProgress.ts:51-58`).
- Beat / matched / below compares estimated 1RM with tolerances (:72-107). Gain labels at :135-156. Tonnage = completed weight × reps, always in lb (:184-190).

**Read/write ordering and accounts**
- Any workout write bumps `workoutMutationSeq`. A read that overlapped a write throws its result away (Store :476-520, :900, :1163).
- Every account-bound action captures `captureAccountScope()` before its first `await` (`lib/accountScope.ts`; reset in `resetAppData`, Store :3491-3500).
- Store merges add or remove rows instead of refetching, so a set logged meanwhile stays (:1411-1416, :1615-1624).
- The skeleton shows only on a cold start or a different account (`hydratedForUserId`, :538-548).

### 2.3 Rest timer, notifications, Live Activity, keep-awake

- **Storage and restore:**
  - Persisted in localStorage `hyper:rest-timer` as a session with an absolute `endsAt` (`lib/restTimer.ts:1-146`).
  - Restored on Train mount, on visibility and on focus, when it belongs to the current workout (`Workout.tsx:448-477`).
  - The pill restores on remount and starts fresh on a new seed (`RestTimerPill.tsx:50-62`). It syncs every 1 s and on visibility / pageshow (:137-161).
- **Completion:** the chime and haptic fire once and never late after a return (:91-93, :163-170). The chime is an 880 Hz Web Audio tone (`restTimer.ts:227-260`).
- **Duration:**
  - Per exercise; else the most recently used; else **90 s**; clamped 5–3,600 s (`lib/restPreferences.ts:14-16, 73-89`).
  - Local and remote preferences merge, newest per exercise (:92-101, :144-170).
  - Manual Rest uses the open movement's preference; an empty exercise id is never saved (`Workout.tsx:1030-1036`).
- **"Next" label:** "Name · set N" is stored with the timer and renamed after a swap (`Workout.tsx:66-67, 1020-1028, 1154-1162`; `RestTimerPill.tsx:107-118`).
- **Notification** (`lib/restNotifications.ts`):
  - One slot (id 1001), "Rest over", body = next-up label or "Next set".
  - Permission is asked lazily on the first running timer, once per launch. Nothing is scheduled in preview or on the web.
  - Running timers reschedule; paused, completed or dismissed timers cancel (`RestTimerPill.tsx:177-189, 287-294`).
  - Leaving Train keeps alerts armed only while the timer runs for the still-active workout (`shouldKeepRestAlertsOnUnmount`, `restTimer.ts:162-170`).
  - There is no banner while the app is open (`capacitor.config.ts:19-23`).
- **App-wide guards:** when the workout ends elsewhere, or on sign-out, the stored timer is cleared, the notification cancelled and the Live Activity ended (`lib/restTimerWorkoutGuard.ts:21-59`; `App.tsx:241-242`).
- **Workout Live Activity** (`lib/liveActivity.ts`):
  - One per session: exercise name (or session title), "set N · X of Y sets · T lb", a session clock (`Workout.tsx:1104-1128`).
  - The rest window is layered in only when `endsAt` is in the future (:81-84).
  - Calls are serialized, collapse to one queued sync, time out after 10 s each and fail quietly (:32-63).
- **Keep-awake:** native screen keep-awake while Train shows a live workout (`Workout.tsx:243`; `lib/keepAwake.ts`). On the web, a Wake Lock is held while the rest timer runs (`RestTimerPill.tsx:204-234`).

### 2.4 Session-only exercise swap (protected)

`planExerciseSubstitution` (`lib/exerciseSubstitution.ts:48-137`) plus Store `substituteWorkoutExercise` (:1206-1262):
- **What the replacement takes:** the slot's order, superset and rep target, with one new set per unfinished set. Its loads come from its own history (:38-47).
- **What stays:** finished sets stay under the original exercise, whose plan item keeps `target_sets = finished` (:125).
- **Swapping back:**
  - Swapping a swap keeps pointing at the planned movement.
  - Choosing the planned movement switches back, and its sets rejoin (:70-79, :112-130).
  - **Switch back** finds the planned exercise in the workout's sets, then the cached splits, then the library (Store :1264-1281).
- **Set numbers:** inside a superset, moved sets keep their round numbers. Otherwise they start at 1, or continue after the rejoined sets (:84-88).
- **Split sessions:** the replacement's set range becomes 1–10 through a `[set-range]` tag (:99-106).
- **Writes, in order:**
  1. Insert `sets` with client UUIDs (`crypto.randomUUID()`, Store :1230).
  2. Update `workout_day_plans.items` with `substitutes_for`.
  3. Delete the source's unfinished sets.

  On failure the inserted rows are deleted and the plan rolled back. If the rollback also fails, the workout is refetched and the message reads "The swap only partly saved…".
- **Preconditions:** an unfinished set and no swap already pending (`Workout.tsx:1129`). Notes flush first.
- **Program untouched:** `split_exercises` is never changed.
- **History** shows "Instead of <planned>" from `substitutes_for` (`History.tsx:1610, 1641-1643`).

### 2.5 Editing past workouts (protected; History)

- **Edit protocol** (`runMutation`, `History.tsx:1061-1072`; `runWorkoutEdit`, `lib/workoutEdit.ts:6-25`). Every edit:
  1. runs after pending note saves flush, in the same per-workout queue (`runAfterFlush`). A failed note save fails the edit;
  2. reloads the workout and its plan afterwards (`refreshWorkout`, :1020-1056);
  3. runs `syncWorkoutCompletion` only on success;
  4. toasts "Saved" or "Could not save".
- **Completion only moves forward** (`syncWorkoutCompletion`, Store :2759-2811). A workout becomes complete when every set is complete; `completed_at` = the latest set timestamp.
- **Set edits:**
  - A set is completed only when both weight and reps are present (`History.tsx:1232`).
  - `completed_at` keeps the set's own value, else the workout's, else now; it becomes null when no longer complete (`resolveEditedSetCompletedAt`, `workoutSessions.ts:71-81`).
  - A failed save keeps the editor open with the typed values (:1249-1250). Weights are pounds.
- **Add set:** server max + 1, with the shared in-flight guard; merged into the active workout only if absent (Store :2552-2599).
- **Remove set:** deletes by id with workout and exercise (Store :2601-2671).
  - The row leaves the active workout immediately, even when the server reports zero rows deleted.
  - Numbers are compacted to 1..n with one update per row. Only server-confirmed numbers merge back; newer rows keep theirs.
- **Target sets** (1–12; partner follows; Store :3112-3200):
  - Growing inserts new sets. Shrinking deletes only unfinished sets above the target (`.eq('completed', false)`).
  - **Inserted and confirmed-deleted ids are merged into the active workout**, so a set logged meanwhile survives.
  - Re-saving an unchanged value still reconciles, to repair an earlier partial save (`History.tsx:1300-1301`).
- **Plan rows on demand:** any plan edit calls `ensureWorkoutDayPlan` (Store :2857-2985). For a split workout this creates `workout_day_plans` from `split_exercises` plus the existing sets, which is a side effect of editing in History.
- **Exercises:**
  - Add: 1 set plus a plan item (target 1, reps 8–12). A hidden item is un-hidden and its swap cleared (Store :2673-2709).
  - Remove: deletes its sets, hides the plan item and unlinks the partner (:2711-2757).
  - History lists only exercises that have sets: plan order first, then the rest (`History.tsx:1501-1506`).
- **Supersets:** at most 2; the partner is inserted after the base with the base's targets; sets are created only if the partner has none (Store :3017-3094).
- **Reorder** is a neighbour swap that does not keep superset pairs together (`History.tsx:1676-1705`).
- **Delete workout:** one DELETE (sets and plan cascade). On a `23503` error it deletes sets first. The live workout is cleared if it was this one (Store :1880-1906).
- **Display:** set-range tags in plan notes are never shown (`parseSetRangeNotes(...).baseNotes`, `History.tsx:1608-1609`).

### 2.6 Editing past nutrition (protected; Fuel)

- **Getting there:** past days are reached from the week strip or month sheet (`Nutrition.tsx:216-226`). Tapping an entry opens the logger in edit mode on the Manual tab (`FoodLogger.tsx:170`).
- **Edit payload:** the edit writes an UPDATE by `id` and `user_id` with the same payload rules as §2.1. Date, time and group are all editable; a date change clears the group.
- **What the entry keeps:**
  - An edit that changes neither name nor macros keeps the original food row (`FoodLogger.tsx:1416-1427`).
  - A composed meal edit writes a new food row, so past logs are unaffected (`saveMealComposition.ts:31-55`).
- **Other edits:** deleting has no confirm; moving between groups; Move to yesterday (§2.1).
- **Settings → Saved meals** edits and retires `foods` rows. It never changes past log rows (§1.12).

### 2.7 Volume recommendations and status (protected)

**Counting** (Store `calculateWeeklyVolume` :3444-3484 with `computeWeeklyVolume`, `lib/weeklyVolume.ts:32-65`):
- Every completed set counts from workouts whose `date` falls in this Monday–Sunday week, whether or not the workout was finished (Store :3451-3453).
- Primary muscle +1, secondary +0.5. There is no warm-up, partial or RPE filter, and supersets count like any other set.
- A muscle without a landmark gets `below_mev` with no landmark.
- Landmarks come from `volume_landmarks` (mv, mev, mav_low, mav_high, mrv). A failed read keeps the previous list.
- **Recomputed on:** Today load, Coaching mount, and after `completeWorkout`. History edits do not recompute.

**Status thresholds** (`classifyVolume`, `lib/volumeStatus.ts:7-13`):

| Weekly sets | Status |
|---|---|
| below MEV | `below_mev` |
| ≥ MEV and < MAV-low | `mev_mav` |
| MAV-low to MAV-high (inclusive) | `mav` |
| > MAV-high and < MRV | `approaching_mrv` |
| ≥ MRV | `above_mrv` |

Recommendation messages are at `volumeStatus.ts:15-48`.

**Week summary** (`todayModel.ts:129-137`): only muscles with sets > 0. In range = `mev_mav` + `mav` + `approaching_mrv`; under = `below_mev`; over = `above_mrv`.

**Insight** (`pickInsight`, `todayModel.ts:151-204`), first match wins:
1. The `below_mev` muscle with the fewest sets that has a landmark; gap = max(1, ⌈MEV − sets⌉).
2. The over or approaching muscle with the most sets.
3. The first `mav` muscle.
4. Nothing.

**Coaching rows:** priority below 0, above 1, approaching 2, mav 3, mev_mav 4; a missing landmark counts as MEV 0 (`Analysis.tsx:36-53`).

**Muscle map:** general "shoulders" volume shades any delt head with no entry of its own (`lib/maquette.ts:132-148`).

**Target seals:** protein is met at ≥ target; calories at 97–105%. The celebration happens once per local day per macro per device (`hyper:seal:<day>:<macro>`; `lib/targetSeal.ts:10-17, 40-56`; `hooks/useTargetSeal.ts:20-36`).

### 2.8 Active program view, edit and delete (protected)

**Storage** (`supabase/schema.sql:32-83, 356-395`):
- `splits` (`is_active`, `days_per_week`) → `split_days` → `split_exercises` (`superset_group_id` is a UUID).
- `plan_schedules` is unique per user and split. `flex_day_templates` is unique per user and label.
- **Deletes:** deleting a split cascades to its days, exercises and schedule. `workouts.split_day_id` is set to NULL, not deleted (`schema.sql:83`).

**Loading** (Store `fetchSplits` :554-599):
- A nested select, newest first, with days and exercises sorted.
- The store only updates when the result changed. Errors are ignored.
- `activeSplit` is the first active row, so the newest wins if two are active.

**Activating** (`activateSplitRow`, Store :443-471): sets the target active first, then deactivates the rest. A partial failure leaves two active, never zero. Flexible mode hides the active program on Program without changing `is_active` (`Splits.tsx:246-247`).

**Creating** (`splitEditStore.ts:283-353` → Store `createSplit` :601-662):
1. Validation: "Give the program a name." / "Add at least one training day." Empty days are allowed; a blank day name saves as "Day {n}".
2. Custom exercises are inserted.
3. The split is inserted **inactive**.
4. `save_split_snapshot` RPC.
5. Activate (`is_active: true`), then refetch.

If step 4 or 5 fails, the new split is deleted: "Could not create the program. Check your connection and try again." `days_per_week` = number of days.

**Editing:**
- `startEdit` stores an FNV-1a fingerprint of the saved program (`lib/splitDraftStorage.ts:95-112`).
- Save sends existing ids through `save_split_snapshot` (`splitEditStore.ts:191-210, 329-342`). An unchanged program closes without writing (`editorActions.ts:23-27`). The sheet stays open on failure, and a second save is blocked while one runs.
- The RPC (`supabase/migrations/20260221130000_add_superset_groups.sql:7-120`, security definer, checks ownership) updates known ids, inserts new rows and **deletes rows not in the payload**.

**Committing typed values:**
- The focused cell is committed before Save, Cancel, close and drag (`lib/commitFocusedField.ts`; `editorActions.ts:20`; `lib/discardSplitEdit.ts:13`; `SortableList.tsx:105`).
- A blur that changes nothing is not an edit (`splitEditStore.ts:476-485`).

**Discarding** (`discardSplitEdit.ts:11-32`):
- Not allowed while saving. An untouched draft closes without asking.
- Otherwise it confirms "Discard new program?" / "Discard changes?" with Discard / Keep editing.
- After a yes, it does nothing if a save started or the draft changed meanwhile.

**Device draft** (never sent to Supabase):
- Key `hyper:split-draft:v1:{userId}:{splitId|'new'}` (`splitDraftStorage.ts:9-28`).
- Written 600 ms after the last edit, immediately when the app is hidden, on pagehide and on unmount (`useSplitDraftAutosave.ts:5-31`).
- Cleared on save, on discard, on "Discard them" and by the chooser's "Discard it". **Not** cleared on sign-out or program delete.
- The restore banner shows only while the draft is untouched.

**Undo:** only the latest removal of a day or exercise; any other edit drops it (`splitEditStore.ts:150-166, 273-277`).

**Supersets in the editor:**
- At most 2. The partner goes right after the source and copies its set range and reps.
- Changing sets syncs the partner's set range; reps do not sync. Removing one member unlinks the other (:534-635).
- Group id = `crypto.randomUUID()`, falling back to a non-UUID string (`lib/splitDraft.ts:47-58`).
- Only adjacent rows of the same group form a block. Drag and Move earlier/later move the block; a single row steps over a whole pair (`splitDraft.ts:113-169`).

**Defaults and ranges:**
- New exercise: 3 sets (min 3, max 3), 8–12 reps (`splitEditStore.ts:519-532`).
- Sets: min ≤ target ≤ max, each 1–10. Reps: 1–100, but min ≤ max is not enforced (`setRangeNotes.ts:15-34`; `lib/setRangeDraft.ts:7-40`).
- Ranges are stored in `notes` as `[set-range]{"min","max"}`, only when they differ from the target.

**Exercise search** (`lib/exerciseSearch.ts:78-164`):
- Text is lowercased, accents stripped (`normalize('NFKD')`, **verify on Hermes**), and other characters become spaces.
- Every word must match, in any order, with simple singulars.
- Scores and bonuses: +3 / +2 / +1 per word, then +20 / +10 / +5.
- Aliases (:61-76): db, bb, rdl, ohp, hyperextension ↔ back extension, pec deck, fly ↔ flye, pushdown, skull crusher, calf raise, pullup, chinup, pushup.
- **Category** (:13-55): the row's own value, else equipment says gym, else calisthenics name patterns. These match migration `20261012120000`.

**Library cache** (`lib/exerciseLibrary.ts:11-53`):
- In memory; concurrent requests share one fetch; failures and empty results are not cached.
- Cleared on sign-out, on an unverified sign-in and after custom inserts. The picker and chooser accept up to 5 minutes old.

**Custom exercises** (`lib/customExercises.ts:89-109`):
- Inserted into the global `exercises` table at save. Any signed-in user may insert (migration `20260401143000`).
- A loose name match reuses the existing id. A `23505` duplicate rereads and inserts only what is still missing.
- New ids are written back into the draft, so a retry won't insert again (`splitEditStore.ts:306-309`).

**Flexible templates:**
- Rename: a case-insensitive clash asks to overwrite (`window.confirm`), then upserts and deletes the original.
- Delete failures are silent.
- Start can resume a different unfinished flexible session than the one tapped.

**Live workout side effects** (from reading, not tested):
- Nothing blocks editing, activating or deleting a program during a live workout.
- The live plan follows the active program's matching day unless the session has its own plan (`Workout.tsx:791-812`).
- If the live day is removed or its program deleted, `split_day_id` becomes NULL. `fetchCurrentWorkout` then treats the workout as flexible and, with no plan, clears it from Train (Store :1167-1186). The rows stay in the database.

### 2.9 Adaptive scheduling setting and plan schedule (protected)

- **Setting:** `user_metadata.adaptive_split_scheduling !== false`, so it is **on by default**. It is saved with `auth.updateUser`, verified against the returned user and value, and applied only if the same account is still signed in (`lib/adaptiveSplitScheduling.ts:5-33`).
- **What it affects:** whether completions are loaded (`useScheduleWorkouts.ts:13`), the planned-day maths (`Workout.tsx:1344, 1599`) and the copy (`Workout.tsx:1629-1633`).
- **Schedule storage** (`lib/planSchedule.ts`):
  - Local cache `plan-schedule:<user>:<split>` with `pendingSync`, then a compare-and-swap upsert on `updated_at` into `plan_schedules`. Errors 23503 / 23514 are permanent (:172-234, :293-342).
  - The flexible anchor index is stored as a one-element `weekdays` array (:146-148, :204-207).
- **Defaults:** start today, or **tomorrow after 20:00 local** (:27-31). Weekdays by days per week: ≤ 3 → Mon/Wed/Fri; 4 → Mon/Tue/Thu/Fri; 5 → Mon/Tue/Wed/Fri/Sat; else Mon–Sat (:33-38). JavaScript weekday numbers, where 0 = Sunday.
- **`plannedDayForDate`** (:375-439):
  - Completions, not starts, drive the schedule. Completions created before the last schedule edit are ignored.
  - Adaptive fixed mode re-anchors on the nearest cycle occurrence of each completion.
  - Flexible mode follows the last completion.
  - A fixed cycle spans weeks until days and slots both wrap (:358-373).
- **Plan-start prompt** after activate or create: only when no schedule is found and the device-only dismissed key is not set. A failed cloud read counts as "no schedule" (`Splits.tsx:214-228`).

### 2.10 Session restore and sign-in persistence (protected)

- **Supabase client** (`lib/supabase.ts:15-36`):
  - Sessions persist and refresh automatically. On iOS: PKCE, Keychain storage (`nativeAuthStorage`) and `detectSessionInUrl: false`.
  - `global.fetch = withRefreshDiagnostics(timedFetch)`.
  - `installAuthResume(supabase.auth)` runs outside preview.
- **`initialize`** (`stores/authStore.ts:72-111`):
  - A session → set it, `fetchProfile`, `hydratePhotoWorkerSettings` (unless the email is unverified).
  - A retryable fetch error → `reconnecting: true`, which is the offline restore with the refresh token kept.
  - `onAuthStateChange`:
    - While reconnecting, it ignores session-less events other than `SIGNED_OUT`.
    - It compares user **ids**, not event names. `resetAppData` runs only when the id changes, so `TOKEN_REFRESHED` and the `SIGNED_IN` on every foreground keep the live workout.
    - The profile refetch is de-duplicated, and a late profile from a previous account is dropped (:103-129).
- **Keychain storage** (`lib/nativeSecureStorage.ts`):
  - **Timeouts and errors:** get, set and remove each have a 3 s deadline. A timeout or ordinary read error returns this launch's cached value; on a cold start with no cache it falls back to the legacy WKWebView localStorage, then to signed-out (:56-61, :110-128).
  - **Keychain miss:** authoritative. A legacy localStorage session is promoted, then removed (:41-55).
  - **Removal:** leaves a tombstone, so a failed delete or stale read cannot revive the session; a later write replaces it (:28-30, :75-88). Mutation revisions stop an older read overwriting a newer write (:31-35).
  - **Native side:** service `<bundleId>.auth`, account = storage key, `AfterFirstUnlockThisDeviceOnly`, values up to 1 MB (`ios/App/App/HyperAuthPlugin.swift:130-219`).
- **Session user id:** queries use the stored session's user id, never the auth store's (`lib/sessionUser.ts:17-20`). A store id that outlives an expired session would send anon-key queries whose empty results can clear the live workout.
- **Foreground resume** (`installAuthResume`, `lib/authResume.ts:123-152`):
  - Becoming visible (`visibilitychange`) or active (`appStateChange`) runs one `resumeAuth` at a time: stop and start auto-refresh (3 s each), `getSession` (3 s), and `refreshSession` (5 s) if the token expires within 60 s.
  - Hidden or inactive → `pauseAuth`. It never throws.
  - `recoverAuthSession` and `pendingAuthRecovery` serve set saves (§2.2).
- **Request deadlines** (`lib/timedFetch.ts:5-93`):
  - 30 s for `/rest/v1` and `/auth/v1`; 5 s for refresh-token grants; 120 s for `rpc/save_split_snapshot`; none for edge functions.
  - The deadline rejects independently of the transport and includes reading the body. An already-aborted caller is rejected before sending.
- **Diagnostics** (`lib/authDiagnostics.ts`):
  - localStorage `hyper:auth-diagnostics`, last 50 events: refresh start and end, resume and pause, recovery, keychain timeout and error, set-save timeout and error.
  - Never tokens, emails, ids or server messages.
- **OAuth and deep links:**
  - `parseNativeOAuthCallback` requires exactly `app.hyper.mobile://auth/callback` and a `code`, and surfaces provider errors (`lib/nativeOAuthCallback.ts:3-21`).
  - Redirect target: iOS `app.hyper.mobile://auth/callback`, web `<origin>/` (`lib/nativeAuth.ts:14-18`). The same value is the email `emailRedirectTo`.
  - Cold-start and open-URL deep links are buffered natively until JS attaches (`AppDelegate.swift:9-14, 38-44`; `HyperAuthPlugin.swift:7-42`), then exchanged by `useNativeAuthCallback` (errors are silent).
- **Sign-up rules:** existing-account detection (`authStore.ts:16-30, 166-179`). An unverified email is blocked at sign-in (:139-145), and an unverified `SIGNED_IN` does not take over device AI settings (`isUnverifiedEmailUser`, :39-41).

### 2.11 Account scoping and sign-out cleanup

- **Account scope:** `captureAccountScope()` is taken before the first `await` of every account-bound action.
- **`resetAppData`** (Store :3491-3500) does all of this:
  - invalidates the scope,
  - clears adaptive refresh flights,
  - bumps the workout write sequence,
  - invalidates the split / mode / template flights,
  - clears hydration,
  - resets the store.
- **`signOut`** (`authStore.ts:235-240`): `auth.signOut()` (storage removal plus tombstone), `invalidateExerciseLibrary()`, `resetAppData()`, then clears user, session, profile and reconnecting. `watchRestTimerSignOut` clears the rest timer, notification and Live Activity.
- **Kept on the device after sign-out:**
  - theme and weight unit;
  - the device-wide Health flag;
  - per-user Health cursor, WHOOP checkpoint, split and meal drafts;
  - auth diagnostics;
  - the photo-worker URL / provider and coach goals.
- **Account switch:** the photo-worker settings and coach goals are wiped only when a **different** account signs in (`hyper.ai-settings.owner`, `lib/photoAnalysis.ts:82-129`). If local storage is empty, they are restored from `user_metadata.photo_worker_settings`.
- **Saved-foods cache:** module-level, dropped on an account change (`lib/savedFoodsCache.ts:28-31`).

### 2.12 WHOOP connect, sync and merge (protected)

**OAuth** (`supabase/functions/whoop-oauth/index.ts`):
- `start` requires the user JWT and returns an authorize URL: scopes `read:workout offline`, HMAC-signed `state` valid 10 min (:171-181).
- `/callback` verifies the state, exchanges the code, upserts `whoop_tokens` (service role only) and `whoop_connections`, then redirects to `returnTo?whoop=connected|error` (:106-159).
- `allowedReturnTo` (:46-60) accepts only the literal `app.hyper.mobile://settings` or `${APP_BASE_URL}/settings`. **Anything else falls back to the web URL.**
- `disconnect` (:184-213): best-effort remote revoke, then deletes tokens and the connection. Imported activities stay.

**Client** (`handleWhoopConnect`, `Settings.tsx:419-454`):
- iOS opens the URL in the system auth sheet with `callbackHost: 'settings'` and requires `?whoop=connected`.
- `connectWhoop` returns `null` in preview **and when there is no session user** (Store :2130-2132), and Settings shows "WHOOP connected." for any `null` (:445).

**Fetch proxy** (`supabase/functions/whoop-sync/index.ts`):
- Refreshes within 5 min of expiry and saves the rotated pair before fetching. If its own refresh fails, it re-reads the tokens in case a parallel sync rotated them (:62-105).
- Pages of 25; one retry on 401. Errors: `reauth_required` (401), `rate_limited` (429), `whoop_error` (502).
- Stamps `last_synced_at` and `last_sync_status`.

**Client sync** (Store `syncWhoop` :2167-2384):
- One run per `userId:generation` (`whoopSyncFlight`), so manual and automatic syncs join.
- Watermark = the newest WHOOP segment's `started_at`. A failed read throws; it never falls back to the 30-day window.
- Reconciliation checkpoint `hyper:whoop-reconciliation:v1:<userId>`, written before ingest and completed after (`lib/whoopReconciliation.ts`).
- Paged window reads (500 rows, up to 100 pages). Any read or write failure returns `null` ("Sync unavailable"). The account is re-checked between steps.

**`runWhoopSync`** (`lib/whoopSync.ts:95-187`):
- First sync looks back 30 days; later syncs re-read from 7 days before the watermark.
- Page cap 10, and it throws if more remain.
- Writes in phases (create → update → relink → delete, 4 at a time). **Deletes are skipped when the segment window is empty** (:177).

**Grouping** (`lib/whoopImport.ts`):
- Sport mapping (:50-71). An unmapped sport becomes `custom_type`, capped at 40 characters.
- The **date uses the record's own `timezone_offset`**, not the device zone (:101-110). PENDING_SCORE records import without metrics. kJ × 0.239006 = kcal.
- Consecutive runs of 15 min or less with gaps of 6 min or less merge into one `interval_run`.
- A majority vote over existing links picks the target session.
- `user_edited` or `dismissed_at` sessions are relink-only.
- A cluster overlapping a non-WHOOP session by at least 60% only enriches that session's strain, HR and kcal (only empty fields when it is user-edited).
- Orphaned auto-grouped sessions are deleted.

**Foreground auto-sync** (`hooks/useWhoopForegroundSync.ts`; `lib/whoopForegroundSync.ts`): on mount and on every return to visible, `fetchWhoopConnection`, then `syncWhoop` if at least 15 min have passed since this process's last attempt **and** since `last_synced_at`. Errors are only logged.

**Merging and attaching** (History and Run):

| Operation | Rule | Where |
|---|---|---|
| GPS run save | Absorbs an auto-grouped, not user-edited WHOOP session overlapping by at least 60% (searched from start − 6 h): segments move and stats copy, then the WHOOP copy is deleted; a failure here does not fail the save | `whoopImport.ts:312-334`; Store :2503-2547 |
| Manual merge | Same day only. At least 50% overlap means one event: the person's own recording survives and WHOOP supplies physiology. Otherwise the earliest survives with durations, distance and kcal summed, HR duration-weighted, max HR the max, **strain the max (never summed)**. Sets `user_edited`. Segments are relinked first, then the absorbed rows deleted | `lib/mergeActivities.ts:70-178`; Store :1979-2010 |
| Attach to a workout | Workout window from set timestamps plus `created_at` / `completed_at`; one stamp → ±30 min. Hint needs at least 35% overlap and at least 5 min, WHOOP source, not hidden. Attaching copies strain, HR and kcal and hides the session; detaching reverses it | `lib/workoutWhoop.ts:24-152`; Store :2386-2453 |
| Delete an activity | WHOOP-sourced or WHOOP-linked sessions are hidden (`dismissed_at`), not deleted; the linked-segment check errs toward hiding | `History.tsx:1201-1221`; Store :2028-2046 |
| Edit an auto-grouped activity | Sets `user_edited`, so a re-sync won't overwrite it | `History.tsx:1171-1175` |

### 2.13 Apple Health weight sync (protected)

- **Enable** (`lib/healthWeights.ts:155-162`):
  1. `requestBodyMeasurementAccess`. It is read-only for body mass, and Health never reveals a denial. Not available → "Apple Health is unavailable on this device."
  2. `enableWeightUpdates`: an observer query plus best-effort background delivery (`HyperHealthPlugin.swift:95-129`).
  3. Set the device-wide flag `hyper:health-weight-sync-enabled = '1'`.
  4. Sync.
- **Sync** (:107-153):
  - Starts from the per-user cursor `hyper:health-weight-sync-cursor:<userId>` minus 24 h, or from all history. Oldest first, at most 500 per page, up to 20 passes.
  - Upserts `body_weight_measurements` on `(user_id, source, external_id)`, where `external_id` is the Health sample UUID.
  - The cursor only moves forward.
  - Normalization drops samples with no id, implausible weights (not between 0 and 500 kg) or bad dates (`lib/healthWeightCore.ts:35-53`).
- **App-level hook** (`hooks/useNativeHealthSync.ts`): only when signed in, on iOS and with the flag set. Weight-change events plus a sync on mount and on each foreground, one at a time, errors silent. The flag is read when the hook mounts, so a change in Settings takes full effect on the next launch or sign-in.
- **Disable:** clears the flag only. Permission and rows stay.
- **Manual weigh-in:** `external_id = manual:<UTC ISO minute>`, so repeats within a minute collapse (`healthWeightCore.ts:59-77`).
- **Trend** (`lib/weightTrend.ts`):
  - Weigh-ins are bucketed by local calendar day with the median per day, then smoothed with an EWMA (α 0.1).
  - Outliers are readings more than max(1.5 kg, 2%) from the smoothed value. The slope is an OLS fit on non-outliers.
  - Settings loads 60 days, fits the rate over the last 21, and shows 30 days (home) or 90 days (weight page).

### 2.14 Barcode scan (protected)

- **Native scanner** (`ios/App/App/HyperBarcodePlugin.swift`):
  - VisionKit data scanner (iOS 16+) for EAN-13, EAN-8, UPC-E, GS1 DataBar and DataBar Expanded (:18-28); accurate mode, one item, zoom and guidance.
  - Skips codes that aren't 8, 12, 13 or 14 digits (:113-114). UPC-A arrives as EAN-13.
  - Formats `ean_13` / `ean_8` / `upc_e` / `unknown`; rejection codes `CANCELLED` and `SCAN_FAILED`. A new scan cancels a stale one (:94-101, :203-211).
- **Timeouts** (`BarcodeScanner.tsx:18-20`): availability 10 s, scan 300 s, lookup 45 s. A newer scan, or leaving Scan, drops a late result (`FoodLogger.tsx:220-223, 369-376`).
- **Normalization** (`lib/barcodes.ts:44-91`):
  - Digits only, with a valid GTIN-8 / 12 / 13 / 14 checksum. UPC-E expands to UPC-A when the scanner reports `upc_e`.
  - 12-, 13- and 14-digit zero-padded forms count as the same code.
- **Lookup order:**
  1. The saved catalog first (`foods` where `external_id` is any equivalent form and `external_source` is `barcode` or `open_food_facts`; a personal `barcode` row wins, `lib/savedBarcodeFoods.ts:20-47`).
  2. Then FatSecret > USDA branded > Open Food Facts, fetched in parallel. A failing source counts as a miss; `{configured:false}` from FatSecret means skip (`lib/barcodePriority.ts:9-27`).
  3. FatSecret and USDA barcode products are fetched again on every scan, because only `barcode` / `open_food_facts` rows resolve locally (`lib/savedBarcodeCore.ts:22-23`).
- **Miss:** the person creates the product in Manual. It is saved as a reusable meal and bound to the code (`foods` UPDATE `{external_source:'barcode', external_id: code}`, `savedBarcodeFoods.ts:53-65`), and the log source is `barcode_saved`.
- **Attribution:** the Open Food Facts / ODbL credit must stay visible (`FoodLogger.tsx:2143-2152`).

### 2.15 Run tracker with Live Activity (protected)

**Engine** (`lib/runTracker.ts`; a pure function of samples):

| Rule | Value | Where |
|---|---|---|
| Accuracy gate | 30 m | :103 |
| Good fixes before distance counts | 3 | :436-449 |
| Run and first-lap clock start | At GPS lock, not at the Start tap | :441-448 |
| Teleport rejection | > 12.5 m/s with no plausible speed | :492-499 |
| Stationary gate | < 1.2 m/s unless motion confirms movement | :505-512 |
| Noise removal per step | √(step² − σ²), σ = 0.14 × combined accuracy, capped at 1 m | `lib/gpsCalibration.ts:38-70` |
| Coordinates trusted | Fix accuracy ≤ 8 m | :527-528 |
| Multipath rule | Coordinate step > 2 × speed step → use speed | :540-545 |
| Jitter floor without speed | max(2 m, 1.3 × combined accuracy) | :566-574 |
| Displayed speed | 4 s median, 6 s time constant | :344-391 |
| Auto-split | Crossing time interpolated; work laps only | :600-631 |
| Manual split / rest debounce | 700 ms | — |
| Rest | Splits mode: rest lap. Long run: pause and resume, re-anchoring position and pace window | :801-923 |
| Lap pace shown | ≥ 20 m and ≥ 4 s; run average ≥ 5 m | :1002-1039 |
| "GPS weak" | No accepted sample for 8 s | :947-950 |
| Finish | Closes the open lap if ≥ 1 m or no lap exists; active time, minimum 1 s; GPS quality summary | :1088-1131 |
| Pace display | "60:00+ /mi" above 3,600 s/mi | `RunTracker.tsx:65-72` |

**Saving** (`finishedRunToActivity`, :1148-1202; Store :2455-2550):
- Type `run`, `interval_run` or `sprint_session`; source `gps`.
- Segment ids `gps:<runId>:<n>`, upserted on `(user_id, source, external_id)`, so retries don't duplicate.
- A retry reuses a GPS session with the same type and `started_at`. The save fails if fewer segments were saved than sent.
- The run's date is the local date of its start (:1139-1145). **The coordinate trace never goes to Supabase.**

**Crash recovery** (`hooks/useRunTracker.ts`; `runTracker.ts:1206-1377`):
- Snapshot `hyper:run-tracker` at most every 5 s; trace `hyper:run-tracker-trace` at most every 30 s, capped at 18,000 points.
- Resumable for 12 h. A finished run's summary is kept 7 days until saved or discarded.
- After a crash while paused, the web resumes un-paused; native keeps the pause.
- Leaving the screen mid-run on native saves a snapshot, detaches listeners and keeps recording (:539-562). Returning to the foreground re-drains what was recorded while away (:527-534).

**Native recorder** (`lib/nativeRunSource.ts`; `ios/App/App/HyperRunPlugin.swift`):
- Every sample is appended to `ApplicationSupport/HyperRunRecorder/<runId>.jsonl`. Controls are kept in UserDefaults (at most 500).
- Background location: `allowsBackgroundLocationUpdates`, plus `CLBackgroundActivitySession` on iOS 17.
- Shake-to-undo and screen auto-lock are disabled while recording.
- It never auto-resumes at launch. It asks for when-in-use permission, then temporary full accuracy (purpose `RunTracking`).
- Separate sample and control cursors. Replays are filtered by a time cutoff; legacy controls are migrated.

**Live Activity** (`ios/App/App/RunLiveActivity.swift`; `ios/App/HyperWidgets/RunLiveActivityWidget.swift`):
- Updated at most every 3 s, stale after 30 s.
- Lock-screen Split / Rest / Finish buttons run an iOS 17 intent that posts `app.hyper.mobile.run-control`. The recorder stores it and emits `runControl`, and JS applies it at the tap's timestamp (`useRunTracker.ts:330-350`).
- **Finish needs a second tap within 8 s** (`RunLiveActivity.swift:52-63`). Stopping the recording ends the activity.

**Cues** (`lib/runTrackerCues.ts`): lap = a double 880 Hz blip; sprint start rises, sprint end falls; each with `completionHaptic`.

**Discard** stops the source with discard. On native with no source attached, it calls `NativeRun.stopRecording({discard:true})`, which deletes the durable file (`useRunTracker.ts:458-476`).

### 2.16 Nutrition targets, adaptive macro engine, profile, coach

- **Trigger:** each Today load runs `fetchNutritionProfile` and `fetchMacroTarget`, then `refreshAdaptiveTargets()` without forcing (`Dashboard.tsx:72-83`).
- **Single flight:** one refresh per user. An unforced call joins the running one; a forced call waits, then recomputes (Store :3317-3327).
- **Gates:** the profile has adaptive on; due (7 days since the last update) unless forced; the session user matches; a latest weigh-in exists (:3330-3344).
- **Estimator** (`lib/adaptiveExpenditure.ts:65-283`):
  - 21-day window; intake ends yesterday.
  - Needs at least 14 logged days (a day counts if intake ≥ 50% of BMR) and at least 10 weigh-in days.
  - Skips the first 7 days after a goal or rate change.
  - Clamps to 0.7–1.4× the predicted burn and blends from 35% to 100% trust. Moves at most ±5% per update. "Measured" at about 18 days of coverage.
  - Seeded with the predicted burn, never its own last result.
- **Writes:**
  - Only when the target isn't manual and the confidence isn't `predicted`.
  - The database enforces "never overwrite a manual target": an UPDATE with `.neq('source','manual')`, else an insert ignored when a row exists (Store :95-122).
  - The result is thrown away if the profile or target changed meanwhile. The learned burn is saved after the target (:3370-3411).
- **Target sources:**
  - Hand edits and coach suggestions → `manual`.
  - The wizard saves the profile and weigh-in at once and stages targets as `calculated`.
  - "Resume adaptive targets" → `calculated` plus a forced refresh.
- **Profile:** changing goal or rate starts a new phase (`phase_started_on` = local today; Store :3306-3311; `lib/nutritionProfile.ts:170-176`). New profiles have adaptive on.
- **Wizard clamps** (`NutritionWizard.tsx:83-91, 157-237`):
  - Age 13–100; weight 60–700 lb or 30–300 kg; height 3–8 ft + 0–11 in or 100–250 cm; body fat 3–60%; rate step 0.05.
  - Unit defaults 170 lb, 5'10", 77 kg, 178 cm.
- **Calculator:** protein and fat round to 5 g; carbs are the remainder rounded to 5 g; calories recomputed 4/4/9; the percentage split sums to 100 (`lib/nutritionCalculator.ts:301-366`).
- **Coach** (`lib/nutritionCoach.ts:94-183`): clamps kcal 1200–6000, P 50–400, C 0–800, F 25–250. Recomputes kcal when the stated value is more than 2% off the macros. Uses the Mac worker `/coach`.
- **Analysis mode:** a stored choice wins (`hyper.food-analysis.mode`); otherwise `VITE_FOOD_ANALYSIS_MODE === 'gemini'`; otherwise worker (`lib/foodTrial.ts:9-16`).
- **Mac worker requests** (`lib/patientFetch.ts:43-107`):
  - Up to 120 s per attempt, 2 s between attempts, 15 minutes in total; "unreachable" after 5 quick failures past 15 s.
  - It retries only `TypeError` and `DOMException('AbortError')`. With Expo's `fetch` this classification no longer matches (§5).
- **Hosted Gemini quota:** per user per **UTC** day, default 24. Identical input replays the stored result; 409 means pending, 429 means the quota is used (`supabase/functions/analyze-food-trial/gateway.ts:118-214`).
- **Preview:** photo, describe, AI, serving and coach return fixtures with no network.

### 2.17 Today refresh and day rollover

- **When it reloads** (`hooks/useTodayRefresh.ts:26-108`; `lib/todayRefresh.ts`):
  - On returning to the foreground, only on a new local day or after **5 min**.
  - A timer fires **1 s after local midnight** and is re-armed on each foreground and after it fires.
- **Load rules:**
  - One load at a time. A request made during a load runs once afterwards; a load that spans midnight is followed by another.
  - A failed load keeps the old day and does not retry by itself. A failed first load still ends the shimmer.
- **Remembered day** (`lib/todayDay.ts:29-56`): returning to Today shows the last read for the same account and day at once. Any workout write since then, or a different live workout, makes "done today" unknown until the next read.

### 2.18 Theme and units

- **Theme** (`stores/themeStore.ts`):
  - `system | light | dark` in `hyper-theme`, default `system`. `system` follows the OS scheme and is rechecked on change, visibility and pageshow.
  - Dark uses theme colour `#000000`, light `#F5F5F0`. On native, dark gives a light status bar.
  - 560 ms transition unless reduced motion. Labels: Ivory = light, Black = dark.
- **Weight unit:** `hyper:weight-unit`, default lb. 1 decimal; × 2.2046226218; lb → kg × 0.453592 (`lib/weightDisplayCore.ts:5-28`).
- **Workouts:** weights are always lb (`workoutProgress.ts:184-190`; History "Weight (lbs)").

### 2.19 Time zone, day boundary and week rules (all in one place)

| Rule | Where |
|---|---|
| Training week is **Monday–Sunday** (`TRAINING_WEEK = {weekStartsOn: 1}`): weekly volume, Today's session count, training hours, Coaching header, Train week strip, program week number (`differenceInCalendarWeeks + 1`) | `lib/workoutSessions.ts:20-22`; `weeklyVolume.ts:21-26`; `weekSessions.ts:6-9`; `Workout.tsx:580, 1336, 1461-1463`; `Dashboard.tsx:176-180`; `Analysis.tsx:150` |
| Fuel week strip, Fuel month sheet, DateField and the History calendar start on **Sunday** (date-fns default) | `Nutrition.tsx:76, 225`; `DateTimePicker.tsx:49, 115`; `History.tsx:609-622, 1371` |
| Day keys are device-local `yyyy-MM-dd` | throughout |
| `workouts.date` = local date at start; used for done-today, week sessions, weekly volume, History month fetch, schedule | Store :944, :1055 |
| History groups workouts by the **local date of `created_at`** (fallback `date`), while it fetches the month by `date` | `History.tsx:874, 992`; `workoutSessions.ts:65-69` |
| Live-workout resume window 24 h, across midnight | `workoutSessions.ts:83-95` |
| Plan start default: tomorrow after 20:00 local | `planSchedule.ts:27-31` |
| Today refresh: a new local day or 5 min; midnight + 1 s timer | `todayRefresh.ts:4-24` |
| Nutrition entry day = `date` (local); `logged_at` is UTC; past-day default time 00:00; late-night move before 05:00 | §2.1 |
| Weekly nutrition chart: rolling last 7 days (today + 6) by `date` | `useWeeklyNutrition.ts:52-55` |
| Activities: `date`, else the local date of `started_at`; a run's date is the local date of its start | `lib/activitySessions.ts:12-17`; `runTracker.ts:1139-1145` |
| Training hours: query by `created_at`, bucket by the local week of `created_at`; duration capped at 3 h; counted only if `completed_at > created_at` | `workoutSessions.ts:24, 127-193` |
| WHOOP record date uses the record's own `timezone_offset` | `whoopImport.ts:101-110` |
| Seal celebration once per local day; weight trend buckets by local day (DST-safe) | `targetSeal.ts:40-56`; `weightTrend.ts` |
| Adaptive refresh due after 7 × 24 h; profile phase date = local today | `adaptiveExpenditure.ts:275-283`; `nutritionProfile.ts:170-176` |
| Hosted analysis quota resets at UTC midnight; Settings usage summary uses UTC dates | `analyze-food-trial/gateway.ts:145-147`; `Settings.tsx:352-372` |
| Body-weight history window is a rolling millisecond window, not calendar days | `healthWeights.ts:48-62` |

### 2.20 Numeric limits and rounding (all in one place)

| Value | Rule | Where |
|---|---|---|
| Set weight / reps / RPE | weight ≥ 0 (decimal), reps integer ≥ 0, RPE empty or 1–10 (0.5 steps in the field) | `workoutProgress.ts:51-58`; `WorkoutSetRow.tsx:231-264` |
| Flexible target sets | 1–12, default 3; reps default 8–12 | Store :219-231; `Workout.tsx:61-64` |
| Program set range | min / target / max 1–10 each, ordered; reps 1–100 (min ≤ max not enforced); new exercise 3×8–12 | `setRangeNotes.ts:15-34`; `setRangeDraft.ts`; `splitEditStore.ts:519-532` |
| Live session set range with no plan | min 1, target = count, max 12 | `Workout.tsx:1953` |
| History target sets | 1–12 | `History.tsx:1299` |
| Superset size | exactly 2 to pair; at most 2 | Store :1424-1505, :3017-3094; `splitEditStore.ts:534-583` |
| Rest length | 5–3,600 s; default 90 s; presets 1 / 2 / 3 / 5 min | `restPreferences.ts:14-16`; `RestTimerPill.tsx` |
| Movement note | 200 characters; counter from 160 | `workoutNotes.ts:6-19` |
| Flexible session / template label | 40 characters | `Workout.tsx:1399-1421`; `Splits.tsx:626-664` |
| Program name / description / day name / custom exercise | 60 / 200 / 40 / 80 | Program sheet |
| Guided program sets | clamped 1–6 | `programDesigner.ts:359-459` |
| Servings (manual) | stepper 0.25, min 0.25; "Describe amount" rounds to 2 dp; database `DECIMAL(10,2)` | `FoodLogger.tsx:2338-2345`; `ServingEntry.tsx:26-27`; `schema.sql` |
| USDA maths | per-100 g × portion / 100; macros to 0.1; `serving_size` to 0.01; kcal falls back to kJ / 4.184 | `usdaSearch.ts:79-97, 140-150` |
| Units | oz = 28.349523125 g; lb = 453.59237 g; ml converts to ml only | `foodLoggerUtils.ts:7-12, 57-77` |
| Photo maths | item totals = macros × grams / max(1, basis grams), to 0.1; "Log as one meal": kcal whole, P/C/F 0.1, at least 1 g; name "A, B and C" / "…and N more" | `FoodLogger.tsx:1154-1163`; `lib/combineMeal.ts:48-102` |
| Photo upload | image only, ≤ 10 MB; long edge ≤ 2,576 px; JPEG quality 0.82 → 0.6 in 0.08 steps until the data URL is ≤ 4.4 M characters | `FoodLogger.tsx:57-67, 764-859` |
| Describe / AI text | ≤ 1,500 characters (Describe needs ≥ 5); AI ≤ 2 photos | `FoodLogger.tsx:2157-2243`; `FoodTrialLogger.tsx:106-121` |
| Barcode digits | up to 14; GTIN-8/12/13/14 checksum | `BarcodeScanner.tsx:310-339`; `barcodes.ts` |
| Macro targets | integers; drift warning > 5%; seal calories 97–105%, protein ≥ 100% | `Settings.tsx:1011-1015`; `targetSeal.ts:10-17` |
| Default macro target | 2000 kcal / 150 P / 200 C / 65 F (Fuel uses `||`, so a saved 0 falls back; Settings uses `??`) | `types/index.ts:311-316`; `Nutrition.tsx:427-430`; `Settings.tsx:666-669` |
| Weigh-in | step 0.1; unit-switch draft rounds to 0.1; calculator re-records when > 0.05 kg different | `Settings.tsx:244-293, 805` |
| Activity editor | custom name ≤ 40; duration 1–1,440 min; notes ≤ 280 | `History.tsx:219-335` |
| Run auto-split | 100 / 200 / 400 / 1,600 m, or custom 10–100,000 m; hold-to-finish 800 ms | `RunTracker.tsx:52-59, 124, 278-279` |

---

## 3. Logic that lives inside components instead of `src/lib`

These are rules a native screen would otherwise have to copy. The suggested home is a one-line pointer, not a design: moving the code (with its tests) into `src/lib` lets both apps call one implementation while they coexist.

Copies that already exist in `native/`, and where they differ:

| Native file | Shared original | Difference today |
|---|---|---|
| `native/src/lib/fuel.ts:127-163` (`upsertUsdaFood`, marked TODO) | `upsertFoodIfNeeded` USDA branch, `FoodLogger.tsx:959-1085` | Same rule, second copy |
| `native/src/lib/fuel.ts:85-102` (`logFood`) | `saveNutritionEntry`, `FoodLogger.tsx:1087-1123` | As of 02:14 it uses the group, `legacyMealTypeForGroup` and a retry id like the web. It still always logs 1 serving with `logged_at` = now and the store's day, and has no time or amount choice |
| `native/src/lib/meals.ts:7-13` + `fuel.ts:113-116` (`mealForTime`, `suggestedGroup`) | `nutritionGroups.ts` (`insertNutritionGroupByTime` anchors 08:00 / 12:00 / 18:00; default groups created on view) | Suggests a named group by clock bands (breakfast < 10:30, lunch < 15:00, dinner < 21:00); never creates the day's default groups |
| `native/src/lib/sessionModel.ts:38-97` (`buildSessionModel`) | `Workout.tsx:791-946` session model and `workoutFocus.ts` | Orders by split `exercise_order` only; ignores the session plan (swaps, reorder, hidden items), supersets and flexible labels |
| `native/src/app/(tabs)/train/index.tsx:29-40` (`suggestedDraft`) | `lib/setAutofill.ts:21-56` | Uses stored values, else the previous workout's same `set_number`; the web uses this workout's last set for set 2 onward |
| `native/src/app/(tabs)/train/index.tsx:42-45, 103` | `workoutProgress.ts:51-58` | Rounds decimal reps instead of rejecting them; RPE choices 6–10 only |
| `native/src/lib/finished.ts:18-39` (`summarize`) | `Workout.tsx:1203-1218` (`buildCompletionSummary`) | "Best set" instead of tonnage, gains and duration |
| `native/src/lib/rest.ts:8-27` | `lib/restTimer.ts`, `lib/restPreferences.ts` | 120 s default, in memory only, not tied to a workout id |
| `native/src/app/session-done.tsx:20` | `lib/sessionUser.ts:17-20` | Reads the auth store's user id for its week-count query (`fuel.ts` switched to `getSessionUserId` at 02:06) |

### 3.1 Pure logic files that already sit under `src/components`

They can move to `src/lib` as they are. Four `src/lib` modules already import from `src/components`: `foodPersistence.ts:2`, `savedMeals.ts:2`, `saveMealComposition.ts:1` and `usdaClient.ts:8`.

| File | Pure? | Notes | Suggested home |
|---|---|---|---|
| `components/dashboard/todayModel.ts` | Yes (types + `MUSCLE_GROUP_LABELS`) | Hero state types, `todayCapsule`, `summarizeWeekVolume`, `pickInsight`, `plannedSetCount`, `firstExerciseName`, `formatWeight`, `TODAY_ACTION_PATHS`. Native Today already imports it from here | `lib/todayModel.ts` |
| `components/workout/workoutFocus.ts` | Yes (types only) | Expansion reducer, `nextWorkoutSet` (round-aware), `getWorkoutResumeSet` (Today uses it) | `lib/workoutFocus.ts` |
| `components/workout/workoutCapsule.ts` | Yes | Capsule target set and model (`saving` / `retry` / `log` / `enter` / `finish`) | `lib/workoutCapsule.ts` |
| `components/workout/movementOrder.ts` | Yes (no imports) | Superset block moves; the program editor has a parallel rule in `lib/splitDraft.ts` | `lib/movementOrder.ts` |
| `components/workout/setEntryRegistry.ts` | Yes (module state) | Row handle registry shared by the capsule and the inline save | `lib/setEntryRegistry.ts` |
| `components/workout/WorkoutCommandCapsule.ts` | No (React hook binding) | Binds the registry to the capsule | Stays per platform |
| `components/nutrition/foodLoggerUtils.ts` | Yes (date-fns) | Units, `toLocalTimeInput`, `buildLoggedAt`, `shouldDropColumn`, `normalizeFoodName`, `numbersNearlyEqual`, `describeTargetUnchanged` | `lib/foodUnits.ts` + `lib/nutritionTime.ts` |
| `components/nutrition/usdaSearch.ts` | Yes | USDA mapping, portions, search / barcode / detail parsing | `lib/usda.ts` |
| `components/nutrition/nutritionLogUtils.ts` | Yes | `getLogTimestamp`, `getLogDate`, calorie sum | `lib/nutritionLogs.ts` |
| `components/nutrition/foodTrialReview.ts` | Yes, but imports `lib/foodTrial` (which imports `supabase/functions`, §5) | `isValidTrialReview`, `buildClarifiedMealHint` | `lib/foodTrial.ts` |
| `components/split/editor/types.ts` | Yes (types) | `PickMode`, `PickExercise` | `lib/splitDraft.ts` |
| `components/split/editor/editorActions.ts` | Platform-neutral apart from `commitFocusedField` | Save and cancel orchestration | `lib/splitEditActions.ts` with an injected "commit focused field" function |
| `components/split/editor/useSplitDraftAutosave.ts` | No (React + `document` / `window`) | The 600 ms constant and flush-on-hide rule | Constant plus a `bindSplitDraftAutosave` in `splitDraftStorage.ts`; an `AppState` hook on native |
| `components/intro/introState.ts`, `brandIntro.ts` | sessionStorage / DOM | Web intro only | Web only |

### 3.2 Train (`pages/Workout.tsx`, workout components)

| File:line | Logic | Suggested home |
|---|---|---|
| `Workout.tsx:56-64` | `normalizeIndex`, `normalizeFlexibleTargetSets` (1–12 clamp, duplicates Store :219-222) | `lib/workoutPlanOps.ts` |
| `Workout.tsx:89-93, 116-130` | `formatSessionDuration`, `formatRepTarget` ("8–10 / 8+ / Up to 12 reps"), `movementProgressLine` | `lib/workoutFormat.ts` (new) |
| `Workout.tsx:195-207, 884-926, 1050-1067` | Superset flow map, ordered groups, partner map (the same builder is duplicated at `workoutFocus.ts:96-105`) | `lib/supersets.ts` (new) |
| `Workout.tsx:1069-1093` | `validateSupersetOrderBeforeLog` (A/B round rule) | `lib/supersets.ts` |
| `Workout.tsx:791-835, 928-946` | Session model: plan items vs split day, order map, set ranges, ordered sets and groups, exercise map, `focusOrder`, active movement | `lib/workoutSessionModel.ts` (new; replaces `native/src/lib/sessionModel.ts`) |
| `Workout.tsx:1020-1048` | `startRestForExercise`, `handleSetLogged`: next set after a log; rest only after B or an unpaired set and never on edits; duration and "Next" label | `lib/workoutFocus.ts` + `lib/restPreferences.ts` |
| `Workout.tsx:1104-1128` | Live Activity state (detail line "set N · X of Y sets · T lb") | `lib/liveActivity.ts` (`buildWorkoutActivityState`) |
| `Workout.tsx:1129, 1137-1167, 1169-1197` | Swap preconditions, post-swap rest-label rename, expansion move, status text | `lib/exerciseSubstitution.ts` / `lib/restTimer.ts` |
| `Workout.tsx:1203-1218, 1222-1289` | `buildCompletionSummary`; finish order (summary → note flush → complete → clear rest; confirm only when sets remain; template prompt) | `lib/workoutProgress.ts` + `lib/finishWorkout.ts` (new) |
| `Workout.tsx:532-540, 734-776, 1352-1368` | Build a `PlanSchedule` from setup inputs; seed inputs from a schedule | `lib/planSchedule.ts` |
| `Workout.tsx:571-611` | Week-strip workouts and last completed workout (raw Supabase) | `lib/weekSessions.ts` |
| `Workout.tsx:1336-1350, 1456-1472, 1596-1608` | Pre-session state machine, today's planned day and status, program week, planned sets, missed-day status | `lib/trainToday.ts` (new; align with `todayModel.ts`) |
| `Workout.tsx:334-424, 839-864` | Note-session wiring: plan-note patch, `onSaved` / `onFailure`, `afterNoteWrites` / `settleNoteWrites` | `lib/noteAutosave.ts` (a "workout notes session" factory, shared with History) |
| `Workout.tsx:974-1018` | Flexible target-set commit; day-label blur rules | `lib/workoutPlanOps.ts` |
| `Workout.tsx:1794, 1883-1890, 1953-1956, 1968` | "Last" for the first unfinished set; display index vs `set_number`; default set range | `lib/workoutProgress.ts` / `lib/setRangeNotes.ts` |
| `WorkoutSetRow.tsx:86-137` | `handleSave` pipeline: validate → superset check → live-row check → `logSet` → gain | `lib/saveWorkoutSet.ts` (`logSetEntry`) |
| `WorkoutSetRow.tsx:139-148, 179-181, 275-300` | `chooseSet`, draft rules, `ledgerView` tone rules | `lib/setDisplay.ts` (new) |
| `RestTimerPill.tsx:48-75, 177-199, 243-303` | Presets, m:ss format, initial restore, notification and Live Activity mirroring, reset / set / toggle / dismiss transitions | `lib/restTimer.ts` (a timer controller) |
| `MovementReorderList.tsx:101-135` | Optimistic order with restore on failure | `lib/movementOrder.ts` (state machine) |

### 3.3 Fuel (`pages/Nutrition.tsx`, nutrition components)

| File:line | Logic | Suggested home |
|---|---|---|
| `FoodLogger.tsx:959-1085` | **`upsertFoodIfNeeded`**: find or create the `foods` row per source (USDA basis match, external identity, custom by id, temporary ids, column fallback) | `lib/foodPersistence.ts` (`ensureFoodRow`) |
| `FoodLogger.tsx:1087-1123` | `saveNutritionEntry` payload: `buildLoggedAt`, date, legacy meal type, group, source, pending id | `lib/saveNutritionEntry.ts` (`buildEntryPayload`) |
| `FoodLogger.tsx:1139-1144, 1193, 1219, 1466` | Log `source` mapping | `lib/saveNutritionEntry.ts` |
| `FoodLogger.tsx:367-417` | `handleBarcodeDetected`: saved catalog → priority providers → USDA detail portion → result or miss | `lib/barcodeLookup.ts` (new) |
| `FoodLogger.tsx:1352-1475` | `handleManualSubmit`: the six-step food-row choice, barcode binding, source | `lib/foodPersistence.ts` (`resolveManualFood`) |
| `FoodLogger.tsx:572-584, 1387-1393, 1420-1425` | Name + macros match (±0.05) for reuse | `lib/savedMeals.ts` |
| `FoodLogger.tsx:1304-1350`; duplicate `Settings.tsx:592-638` | Replace a saved meal (insert, retire, warn if retiring fails) | `lib/savedMeals.ts` (`replaceSavedMeal`) |
| `FoodLogger.tsx:586-629`; `Settings.tsx:507-542`; `native/src/lib/fuel.ts:167-172` | Saved-meal fetch and row → `Food` mapping (three copies) | `lib/savedMeals.ts` (`loadSavedMeals`) |
| `FoodLogger.tsx:316-334` | Suggestions (starts-with, then contains, max 6) and filter | `lib/savedMeals.ts` |
| `FoodLogger.tsx:491-521, 1775-1811` | Servings from amount and unit, error text, unit-switch conversion | `lib/foodUnits.ts` |
| `FoodLogger.tsx:73-83, 1749-1753, 1875-1876` | `formatMacroInput`, `formatMeasurementAmount`, `foodMacros`, basis label | `lib/nutritionFormat.ts` (new) |
| `FoodLogger.tsx:57-67, 764-859` | Image limits, JPEG compressor (canvas), file checks | Constants and checks → `lib/photoAnalysis.ts`; native compressor per platform |
| `FoodLogger.tsx:880-957` (esp. :901-905, :913-940, :944-950) | Photo hint text, USDA grounding (gram matches, top 3), provider-fallback note | `lib/photoAnalysis.ts` (`buildPhotoHint`, `groundPhotoItems`) |
| `FoodLogger.tsx:1154-1163, 1199-1302` | `photoItemTotals`; combined vs per-item save loop; servings | `lib/photoAnalysis.ts` / `lib/combineMeal.ts` |
| `FoodLogger.tsx:1165-1197` | AI item → food row (description, source by evidence, retry ids) | `lib/foodTrial.ts` (`trialItemToFood`) |
| `FoodLogger.tsx:419-479` | Describe flow, stale-answer guard, `applyDescribeEstimate` | `lib/foodDescription.ts` |
| `FoodLogger.tsx:57, 292-295, 1654` | `hyper.nutrition.combine-meal` preference | `lib/nutritionPreferences.ts` (new) |
| `NutritionGroupLedger.tsx:45-68, 86-88, 280` | `sourceLabel`, `servingLabel`, entry sort, Unassigned split | `lib/nutritionLedger.ts` (new) |
| `Nutrition.tsx:69-86` | `getDateKey`, `buildCalendarDays` (Sunday-first) | `lib/nutritionCalendar.ts` (new) |
| `Nutrition.tsx:115-175, 240-318, 330-425` | Month load, default groups, create / move / reorder / delete group, move entry, move to yesterday, delete entry | `lib/nutritionDay.ts` (new) or a nutrition store |
| `Nutrition.tsx:427-466` | Target fallback, kcal left / over, protein to go, segments, capsule text | `lib/fuelSummary.ts` (new) |
| `MealLogger.tsx:16, 30-37, 57-63, 106-146, 163` | Amount format, ingredient validity, draft key and defaults, ingredient expansion, save orchestration | `lib/mealComposition.ts` / `lib/saveMealComposition.ts` |
| `BarcodeScanner.tsx:12-21, 87-119` | Timeouts, formats, resolve flow and messages | `lib/barcodes.ts` |
| `ServingEntry.tsx:26-27` | 2-decimal servings rounding | `lib/foodTrial.ts` |
| `FoodTrialLogger.tsx:71-73, 106-121` | Photo angle assignment, totals, limits (2 × 10 MB) | `lib/foodTrial.ts` |
| `NutritionWizard.tsx:83-91, 157-237, 312-317, 359-376` | Clamps, rate rounding, profile building, step gate, unit conversions with defaults | `lib/nutritionProfile.ts` (`buildProfileFromWizard`) |
| `GoalsCoach.tsx:41, 49-99, 166` | Coach request flow (preview fixture, 21-day trend, context), goals persistence | `lib/nutritionCoach.ts` (`askNutritionCoach`) |
| `DateTimePicker.tsx:55-60, 263-280` | Disabled-day rule; 12 h ↔ 24 h conversion and label | `lib/timeOfDay.ts` (new) |
| `WeeklyNutrition.tsx:35-36, 62`; `hooks/useWeeklyNutrition.ts:47-96` | 7-day aggregation (the fetch is not exported), average over logged days, % of target | `lib/weeklyNutrition.ts` (new) |

### 3.4 Today, Coaching and Run

| File:line | Logic | Suggested home |
|---|---|---|
| `Dashboard.tsx:69-90` | Today load sequence and "remember the day" rule | `lib/todayDay.ts` (`loadToday`) |
| `Dashboard.tsx:108-160, 113-123` | Hero-state derivation; next-exercise name fallbacks; "Flexible" name | `lib/todayModel.ts` (`deriveHeroState`) |
| `Dashboard.tsx:162-163, 172-174, 466-468` | kcal left (clamped, default target), any-nutrition test, weekly session target, `activeWorkoutIdOf` | `lib/todayModel.ts` |
| `Dashboard.tsx:176-192` | Program week number; next planned session within 14 days | `lib/planSchedule.ts` |
| `TrainingHoursHistogram.tsx:9-18` | `formatMinutes`, peak-week rule | `lib/workoutSessions.ts` |
| `Analysis.tsx:36-60, 120-126` | `buildCoachingCall`, priorities, landmark copy, row sort | `lib/volumeStatus.ts` |
| `Analysis.tsx:73-109` | Training-hours query | `lib/workoutSessions.ts` (`loadWeeklyTrainingHours`) |
| `Analysis.tsx:189-194` | Tapped delt → shoulders row | `lib/maquette.ts` |
| `VolumeMaquette.tsx:25-31, 328-336` | Status words; flat-figure colour rules | `lib/maquette.ts` |
| `shared/TrainingStrip.tsx:157-159, 195` | `VolumeRail` scale and marker rule | `lib/chartGeometry.ts` |
| `charts/LapPaceChart.tsx:27-62`; `charts/BarChart.tsx:59-62, 99` | Lap rows, fastest lap, bar floor and scaling | `lib/activityMetrics.ts` / `lib/chartGeometry.ts` |
| `RunTracker.tsx:65-84` | `formatRunPace`, `formatMeters`, `figure` | `lib/activityMetrics.ts` |
| `RunTracker.tsx:97-108` | Diagnostics payload and file name | `lib/runTracker.ts` (`buildGpsDiagnosticsExport`) |
| `RunTracker.tsx:208-217, 278-279` | Auto-split choice parsing and validation | `lib/runTracker.ts` |
| `RunTracker.tsx:257-272, 453-470` | Live readout; status-label precedence | `lib/runTracker.ts` |
| `RunTracker.tsx:281-299` | Live Activity payload | `lib/runTracker.ts` |
| `RunTracker.tsx:352-363` | Finished split list (sprint reps vs laps with rest) | `lib/runTracker.ts` |
| `RunTracker.tsx:124` | 800 ms hold-to-finish | `lib/runTracker.ts` constant |
| `hooks/useRunTracker.ts:330-350, 438-451` | Control → engine mapping, written twice | `lib/runTracker.ts` (`applyRunControl`) |
| `hooks/useRunTracker.ts:189-191, 255-305, 380-427` | Snapshot throttles and keys; resume orchestration | `lib/runTracker.ts` or a platform-neutral controller |

### 3.5 History

| File:line | Logic | Suggested home |
|---|---|---|
| `History.tsx:179-217` | `parseDateKey`, `getTimeInputValue`, `localDateTimeToIso`, `parseDurationSeconds` (24 h cap), `isDateKeyInMonth` | `lib/activitySessions.ts` |
| `History.tsx:230-249` | Activity editor → `ActivitySessionInput` (custom name only for "other", ≤ 40; `ended_at` = start + duration; source kept or manual) | `lib/activitySessions.ts` (`buildActivityInput`) |
| `History.tsx:94-100, 1231-1247` | Past-set parsing and the "completed" rule | `lib/workoutEdit.ts` (`buildPastSetUpdate`) |
| `History.tsx:605-646` | `buildCalendarDays` (Sunday-first), `groupSetsByExercise`, `progressFromSets` | `lib/historyCalendar.ts` (new) / `lib/workoutSessions.ts` |
| `History.tsx:800-861` | Month load with `split_days` and `workout_day_plans` label queries and note parsing | Store `fetchHistoryMonth` or `lib/historyMonth.ts` (new) |
| `History.tsx:872-876, 990-1018` | Group by local `created_at` day; day summary | `lib/historyCalendar.ts` |
| `History.tsx:1020-1072` | `refreshWorkout` + `runMutation` (edit → refresh → completion sync → toast) | `lib/workoutEdit.ts` |
| `History.tsx:1167-1229` | WHOOP edit guard (`user_edited`); hide-vs-delete rule | Store actions |
| `History.tsx:891-951` | List updates after attach, detach, merge; match suggestions | `lib/workoutWhoop.ts` / `lib/mergeActivities.ts` |
| `History.tsx:1283-1312, 1497-1532, 1595-1621, 1676-1705` | Exercise order from the plan, superset partner maps, name and note fallbacks, 1–12 clamp, neighbour-swap reorder | `lib/workoutPlanOps.ts` |
| `History.tsx:738-798, 1085-1105` | Note-autosave glue (shared with Train) | `lib/noteAutosave.ts` |
| `History.tsx:375-381, 471-491` | Which activities can be attached; row subtitle and metrics; the ≥ 2-segment splits rule | `lib/workoutWhoop.ts` / `lib/activitySessions.ts` |
| `History.tsx:168-172, 1157-1158` | `formatSegmentDistance`; sync result → toast text | `lib/activityMetrics.ts` / `lib/whoopSync.ts` |

### 3.6 Program

| File:line | Logic | Suggested home |
|---|---|---|
| `Splits.tsx:26-27, 246-247` | `plural`, `exerciseTotal`; which program shows as active | `lib/programSummary.ts` (new) |
| `Splits.tsx:214-228, 700-707` | Plan-start prompt rule, dismissed key, latest-request guard | `lib/planSchedule.ts` (`shouldPromptPlanStart`, `dismissPlanStartPrompt`) |
| `Splits.tsx:230-244` | After save or activate: prompt vs forced refetch | Store / `lib/programActions.ts` (new) |
| `Splits.tsx:594-601` | `sets×reps` label with set range | `lib/setRangeNotes.ts` (`formatSetRepLabel`) |
| `Splits.tsx:146-201, 337, 406-409` | Template start messages; rename clash → confirm → overwrite; visible items; `sets×min–max` with '—' | `lib/flexTemplates.ts` (new, with an injected confirm) |
| `SplitEditorSheet.tsx:25-29, 77-103` | Picker setup (starting muscle, exclusions, pending extras), mode routing, titles, chooser-vs-editor rule | `lib/splitDraft.ts` (`pickerTargetFor`) |
| `DayCard.tsx:13-21, 48-64`; `SplitEditor.tsx:42-75`; `ExerciseBlock.tsx:45` | `blockStartIndexes`, "Day N" fallback, summaries, "A and B" labels, which days start expanded, new day naming | `lib/splitDraft.ts` |
| `SetRangeFields.tsx:14-38, 60-82` | Cell limits and commit rules | `lib/setRangeDraft.ts` (`commitSetRangeCell`) |
| `ExercisePicker.tsx:45-56, 76-82, 103-206` | `groupByMuscle`; extra-row merge, exclusions, muscle filter, gym / calisthenics split, forced-open rule; cached-then-refresh; selection modes | `lib/exerciseSearch.ts` (`pickerSections`); `lib/exerciseLibrary.ts` (`loadForPicker`); `lib/exercisePickerSelection.ts` (new) |
| `CustomExerciseForm.tsx:8-9, 29-38`; `ExercisePicker.tsx:374` | Muscle options; default-muscle chain | `lib/customExercises.ts` |
| `NewSplitChooser.tsx:19-48, 64-71, 85-99` | Question config and defaults; blank 1–7 (default 4); guided start with the missing-names notice | `lib/programDesigner.ts` + `lib/splitDraftSeed.ts` |
| `SortableList.tsx:40-42, 70-82, 99-101` | Drag thresholds, spoken strings | Per platform |

### 3.7 You / Settings and the shell

| File:line | Logic | Suggested home |
|---|---|---|
| `Settings.tsx:295-309` | `loadTargets` (direct `macro_targets` select + profile, combined status) | Store action returning a status (merge with `fetchMacroTarget` / `fetchNutritionProfile`) |
| `Settings.tsx:230-253, 941-947, 975-990` | Weekly rate, weight summary and capsule labels; unit-switch draft conversion | `lib/bodyWeightSummary.ts` (new) / `lib/weightDisplayCore.ts` |
| `Settings.tsx:269-293, 323-350` | Weigh-in parsing and recording; Health enable-vs-sync choice and message | `lib/healthWeights.ts` |
| `Settings.tsx:352-395` | Analysis usage check; worker save + health check + message | `lib/foodTrial.ts` / `lib/photoAnalysis.ts` |
| `Settings.tsx:397-454` | WHOOP connect (native vs web, `returnTo`, auth session, `?whoop=` parsing, refetch) | `lib/whoopClient.ts` (`connectWhoopInteractive(openAuthSession)`) |
| `Settings.tsx:470-500`; `History.tsx:1157-1158` | Sync result and status labels (two different wordings today) | `lib/whoopSync.ts` or `lib/whoopStatus.ts` (new) |
| `Settings.tsx:564-638` | Composed vs simple saved-meal edit; insert-then-retire | `lib/savedMeals.ts` |
| `Settings.tsx:665-707, 1011-1015` | `baseMacros`, `expenditureDisplay`, `macrosChanged`, macro drift | `lib/settingsUx.ts` / `lib/nutritionMacros.ts` |
| `Settings.tsx:722-773, 796-839` | Target-draft staging and save (coach → manual, hand edit → manual, resume adaptive, calculator outcome with the 0.05 kg weigh-in rule) | Store actions + a draft reducer in `lib/settingsUx.ts` |
| `Settings.tsx:841-911` | Sign-out copy, dirty and busy map, discard rules | `lib/settingsUx.ts` |
| `BottomNav.tsx:10-23` | Lit-tab paths; when the bar hides | `lib/nativeGlassNavigation.ts` (next to `nativeTabForPath`) |
| `hooks/useWhoopForegroundSync.ts:8-53`; `useNativeHealthSync.ts:9-48`; `useTodayRefresh.ts:26-108` | Foreground reconcile flows (single in-flight run, cadence, triggers), bound to `document` | Pure controllers in `src/lib` driven by `visibilitychange` on the web and `AppState` on native |

---

## 4. Native iOS pieces (`ios/App`)

**Project facts**
- **App target:** `app.hyper.mobile`, iOS 15.0. Capacitor 8.4.2 through Swift Package Manager (`ios/App/CapApp-SPM/Package.swift`), with the `@capacitor/app`, `haptics`, `local-notifications`, `status-bar` and `@capacitor-community/keep-awake` packages.
- **URL scheme:** `app.hyper.mobile` (`Info.plist:17-29`).
- **Background mode:** `location` (:63-66).
- **Usage strings:** camera, photo library, Health share and update (update is unused), location when-in-use and always, temporary-precise purpose `RunTracking`, motion. `NSSupportsLiveActivities` is set.
- **Entitlements:** HealthKit and HealthKit background delivery (`Hyper.entitlements:5-8`). There is no App Group, push, associated domains or background tasks.
- **Widget extension** `app.hyper.mobile.HyperWidgets`:
  - Deployment target **iOS 26.5** (`project.pbxproj:516, 554`) and no entitlements file.
  - `HyperWidgetsBundle.swift` registers only the two Live Activities. `AppIntent.swift`, `HyperWidgets.swift` and `HyperWidgetsControl.swift` are one-line placeholders, so there are **no home-screen widgets or controls** today.

**The Expo app as read** (`native/app.json`, `native/ios`):
- Bundle id `app.hyper.native`, scheme `hyper-native`.
- Empty entitlements, no usage strings, no extension target.
- Installed and usable: `expo-haptics`, `expo-status-bar`, `expo-web-browser` (auth sessions), `expo-linking`, `expo-glass-effect`, `expo-sqlite` (localStorage).
- `expo-keep-awake` exists only as a dependency of `expo`.
- `expo-crypto` was added at 02:06 for the `randomUUID` polyfill.
- **Not installed:** `expo-notifications`, `expo-secure-store`, `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-location`, `expo-sensors`, `expo-audio`, `react-native-svg`.

### 4.1 The pieces

| Piece | Swift | What it does | JS API (method / event) | JS wrapper | Who calls it | Rebuild notes for Expo |
|---|---|---|---|---|---|---|
| **HyperAuth: OAuth sheet** | `App/HyperAuthPlugin.swift:63-128` | System auth sheet (not ephemeral), one at a time; https URLs only; the callback must be `app.hyper.mobile` + `auth/callback` or `settings` with an empty path, and is checked again on return. Errors: `INVALID_URL`, `INVALID_CALLBACK`, `UNAVAILABLE`, `AUTH_IN_PROGRESS`, `CANCELLED`, `AUTH_FAILED` | `openOAuth({url, callbackScheme, callbackHost, callbackPath}) → {callbackUrl}` | `lib/nativeAuth.ts:20-55` | Sign-in Google / Apple (`authStore.ts:201-207`; Apple only when `isNativeIOS()`, `AuthForm.tsx:25`); WHOOP Connect (`Settings.tsx:429`) | `expo-web-browser` `openAuthSessionAsync`. Callback must stay `app.hyper.mobile://…`, or the parser (`nativeOAuthCallback.ts:11`), the WHOOP function (`whoop-oauth/index.ts:46-60`) and Supabase's redirect allow-list must all change |
| **HyperAuth: Keychain** | `HyperAuthPlugin.swift:130-219` | Generic-password items: service `<bundleId>.auth`, account = storage key (≤ 512 bytes), value ≤ 1 MB, `AfterFirstUnlockThisDeviceOnly`; read failure rejects with `KEYCHAIN_READ_FAILED` and a numeric `osStatus` | `getSecureValue({key})`, `setSecureValue({key, value})`, `removeSecureValue({key})` | `lib/nativeSecureStorage.ts` (3 s timeout, cache, tombstone, legacy promotion, diagnostics) | Supabase auth storage on iOS (`lib/supabase.ts:29`), so every signed-in request | `expo-secure-store` is not installed, and its value-size guidance is small (**verify** against session size). Keep the same timeout, fallback and tombstone rules. Existing sessions carry over only under `app.hyper.mobile` with the same service and key |
| **HyperAuth: deep links** | `AppDelegate.swift:9-14, 38-44`; `HyperAuthPlugin.swift:7-42, 196-200` | Routes `app.hyper.mobile://auth/callback` from a cold launch or open-URL; delivers it to a listener or holds it until asked | `getPendingAuthCallback() → {callbackUrl}`; event `authCallback` | `hooks/useNativeAuthCallback.ts` | App root (`App.tsx:224`); email confirmation links (`emailRedirectTo`, `authStore.ts:153, 187`) | `expo-linking` / expo-router plus `Linking.getInitialURL()`; the PKCE verifier must be in the same app's storage |
| **HyperBarcode** | `App/HyperBarcodePlugin.swift` | VisionKit scanner (iOS 16+): EAN-13, EAN-8, UPC-E, GS1 DataBar (+Expanded); accurate mode, one item, pinch zoom, guidance; 8 / 12 / 13 / 14-digit filter; formats `ean_13` / `ean_8` / `upc_e` / `unknown`; a new scan cancels a stale one | `getAvailability() → {available}`, `scanBarcode() → {rawValue, format}` | Called directly in `components/nutrition/BarcodeScanner.tsx:165-183` (10 s / 300 s timeouts) | Fuel → Log food → Scan (`FoodLogger.tsx:2117-2154`) | `expo-camera` (not installed) lacks DataBar and the guidance UI. Either accept its symbologies or write a VisionKit module; keep the length filter and `lib/barcodes.ts` as the checksum authority |
| **HyperHealth** | `App/HyperHealthPlugin.swift` | Body mass, read only; samples oldest-first since a date (limit 1–500, default 250); observer query plus best-effort background delivery that emits a change event | `requestBodyMeasurementAccess() → {available, requested}`, `readWeightSamples({since, limit}) → {samples:[{id, measuredAt, kilograms, sourceBundle, sourceName}]}`, `enableWeightUpdates() → {enabled}`; event `weightSamplesChanged` | `lib/healthWeights.ts:107-162`; `hooks/useNativeHealthSync.ts` | You → Connections → Apple Health (`Settings.tsx:323-350`); app-wide sync (`App.tsx:222`) | No first-party Expo HealthKit module; needs a custom module, entitlements and usage strings. Permission is per bundle id |
| **HyperRun** (GPS recorder) | `App/HyperRunPlugin.swift` (680 lines) | Fitness-grade location without auto-pause; when-in-use, then temporary precise (`RunTracking`); background updates with indicator and `CLBackgroundActivitySession` (iOS 17); disables shake-to-undo and auto-lock while recording; motion state; durable `ApplicationSupport/HyperRunRecorder/<runId>.jsonl` and `hyper.nativeRun.*` defaults; never restarts itself at launch; drains 1000 samples / 100 controls per page; share sheet for diagnostics | `requestPermissions`, `startRecording({runId, resume})`, `stopRecording({discard})`, `getStatus` (unused), `drainSamples({afterSequence})`, `drainControls({afterSequence})`, `syncLiveActivity({...})`, `shareDiagnostics({filename, content})`; events `locationSample`, `locationError` (4 codes), `runControl` | `lib/nativeRunSource.ts` (cursor and merge logic :86-151; detach keeps recording :237-244), chosen in `hooks/useRunTracker.ts:138-148` | Run tracker (`RunTracker.tsx:97-122, 281-299`) | Custom module required; `expo-location` (not installed) cannot provide the numbered durable trace `nativeRunSource.ts` drains. Recorder files and defaults are per bundle id |
| **Run Live Activity + lock-screen controls** | `App/RunLiveActivity.swift`; `HyperWidgets/RunLiveActivityWidget.swift` | One activity per run, updated at most every 3 s, stale after 30 s; Split / Rest-Resume / Finish buttons (iOS 17 intent); Finish needs a second tap within 8 s; taps post `app.hyper.mobile.run-control`, which the recorder stores and emits as `runControl`; stopping the recording ends it | via `NativeRun.syncLiveActivity({runId, mode, distanceM, elapsedS, livePace, averagePace, isResting})` | — | `RunTracker.tsx:281-299` on every tick | Needs a widget-extension target plus a config plugin; the attribute and state types and the intent are duplicated in app and extension and must stay identical |
| **Workout Live Activity** (Swift `RestActivityPlugin`, JS name `WorkoutActivity`) | `App/RestActivityPlugin.swift`; `HyperWidgets/HyperWidgetsLiveActivity.swift` | One activity per workout; rest countdown only when the rest end is in the future; stale at rest end + 60 s, else 8 h; extra activities ended; lock screen and Dynamic Island | `sync({exerciseName, detailLine, sessionStartedAtEpochMs, restStartedAtEpochMs?, restEndsAtEpochMs?})`, `end()` | `lib/liveActivity.ts` (registers its own plugin; serialized calls, 10 s timeout, quiet failure) | `Workout.tsx:1104-1128`; `RestTimerPill.tsx:181-199, 294`; `restTimerWorkoutGuard.ts` (`App.tsx:241-242`) | Same extension requirement. The detail-line format currently lives in `Workout.tsx` (§3.2) |
| **HyperGlassNavigation** (iOS 26) | `App/HyperGlassNavigationPlugin.swift` | Native glass tab dock (Today / Train / Fuel / You); hides for the keyboard, inactive app, presented screens and reloads; light tap haptic | `getCapabilities`, `sync`, `hide` (unused); event `select` | `lib/nativeGlassNavigation.ts`; `hooks/useNativeGlassNavigation.ts` | `BottomNav.tsx:24` | Replaced by Expo Router `NativeTabs` (`native/src/app/(tabs)/_layout.tsx`) |
| **HyperGlassSurfaces** (iOS 26) | `App/HyperGlassSurfacesPlugin.swift` (607 lines) | Rest dock (countdown, pause, Skip / Continue, "Next · …"); toast pill announced once to VoiceOver; device-motion stream at 15 Hz for the lighting effect; registers the Geist and Fraunces fonts | `getCapabilities`, `syncRest`, `syncToast`, `startMotion`, `stopMotion`; events `restAction` (open / toggle / skip / continue), `motion` | `lib/nativeGlassSurfaces.ts`; `hooks/useNativeGlassSurfaces.ts` | `RestTimerPill.tsx:317-335`; `Toast.tsx:19`; `lib/motionLight.ts:129`; probe at `App.tsx:233` | React Native views (`expo-glass-effect`); `AccessibilityInfo.announceForAccessibility` for the toast; motion needs `expo-sensors` (not installed) |
| **Capacitor packages** | `CapApp-SPM/Package.swift` | Haptics; local notifications (id 1001 "Rest over", body = next set, scheduled at rest end, no banner in foreground per `capacitor.config.ts:19-23`); status bar style; keep-awake; app state | `Haptics.impact` / `notification`; `LocalNotifications.check/requestPermissions` / `schedule` / `cancel`; `StatusBar.setStyle`; `KeepAwake.keepAwake` / `allowSleep`; `App.addListener('appStateChange')` | `lib/haptics.ts`, `lib/restNotifications.ts`, `stores/themeStore.ts:53-55`, `lib/keepAwake.ts`, `lib/authResume.ts:134-145`, `hooks/useAppViewport.ts` | Haptics in about 22 files; rest notification from `RestTimerPill` and `restTimerWorkoutGuard`; keep-awake from `Workout.tsx:243` and `useRunTracker.ts:492` | `expo-haptics` and `expo-status-bar` are installed; `expo-notifications` is missing; `expo-keep-awake` is transitive only; use React Native `AppState` for app state |
| **Photo capture** | none | WebView file inputs (`FoodLogger.tsx:2391-2404`; `FoodTrialLogger.tsx:112`) plus canvas JPEG downscaling (`FoodLogger.tsx:764-823`) | — | — | Fuel Photo and AI tabs | Needs `expo-image-picker` and an image manipulator (HEIC → JPEG, the size and quality loop) |

### 4.2 Live Activity data shapes

Each shape is declared twice, once in the app and once in the extension, and both copies must match.
- **Workout:** `ContentState {exerciseName, detailLine, sessionStartedAt, restStartedAt?, restEndsAt?}` (`RestActivityPlugin.swift:9-18`; `HyperWidgetsLiveActivity.swift:8-16`).
- **Run:** attributes `{runID}`; `ContentState {mode, distanceM, elapsedS, updatedAt, livePace, averagePace, isResting, finishArmedUntil?}`. `RunControlIntent` is also duplicated (`RunLiveActivity.swift:5-100`; `RunLiveActivityWidget.swift:6-88`).

### 4.3 What the Expo bridge stub covers today

- **Matched:** `native/src/platform/nativeBridge.ts` exports the same names as `src/lib/nativeBridge.ts`. `isNativeIOS()` returns `false`, and every `NativeAuth` / `NativeRun` / `NativeHealth` / `NativeBarcode` call rejects ("…is not available in the native app yet.").
- **Silent no-ops:** `WorkoutActivity`, `HyperGlassSurfaces` and `HyperGlassNavigation` are registered by their own wrappers through `registerPlugin`. `native/src/platform/capacitorShim.ts` turns them into rejecting proxies, and the `Capacitor.isNativePlatform()` checks make them no-ops.
- **Not shimmed:** the four Capacitor packages (§5.3), the deep-link router, the widget extension, Info.plist and entitlements, and font registration.
- **Effect:** with `isNativeIOS()` false, shared code takes its web or no-op path:
  - Health sync does nothing; enabling it throws "only available in the iPhone app".
  - OAuth returns the stub error.
  - The barcode tab falls through to the web camera path ("This browser does not support camera scanning.", `BarcodeScanner.tsx:185-187`).
  - The run tracker reports "GPS is not available on this device." (`useRunTracker.ts:95-97`).
  - The Apple button and the Health rows are hidden.
  - WHOOP connect tries `window.location.href`.
  - Live Activity, rest notification and keep-awake do nothing.

### 4.4 State tied to the bundle id or the WebView

| State | Where it lives | Carries over to the Expo app? |
|---|---|---|
| Supabase session | Keychain service `app.hyper.mobile.auth` (plus a legacy WebView copy) | Only if the Expo app ships as `app.hyper.mobile` and reads the same service and keys |
| Health permission | Per bundle id | Only as `app.hyper.mobile` |
| Run recorder files and `hyper.nativeRun.*` defaults; Live Activities | App container | Only as `app.hyper.mobile`, and only if the new module uses the same paths |
| Every localStorage key (Appendix C) | WKWebView storage | **Never.** These restart at their defaults. Server-backed values (rest preferences, plan schedules, workout mode, photo-worker settings) reload from Supabase; device-only ones (theme, weight unit, analysis mode, coach goals, drafts, Health flag and cursor, WHOOP checkpoint, run snapshots, diagnostics) are lost |

---

## 5. Browser and Capacitor dependencies in shared modules

### 5.1 What the native runtime provides (read from `native/node_modules`)

- **Globals:**
  - `window` and `self` exist and point at the global object, so `typeof window !== 'undefined'` checks pass. `window.addEventListener`, `matchMedia`, `location`, `visualViewport`, audio and wake lock do not exist.
  - **There is no `document`.**
  - `navigator` is minimal: no `userAgent`, `geolocation`, `vibrate`, `onLine` or `wakeLock`.
  - **There is no `crypto` global** (Hermes has none, and `expo/src/winter/runtime.native.ts` installs none). Since 02:06 `native/src/platform/setup.ts:7-14` adds `crypto.randomUUID` only, from `expo-crypto`. `crypto.subtle` and `crypto.getRandomValues` are still absent.
- **Storage:** `localStorage` comes from `expo-sqlite/localStorage/install` (`native/src/platform/setup.ts`); it is synchronous and persistent. **There is no `sessionStorage`.**
- **Installed by Expo's runtime:** `URL`, `URLSearchParams`, `DOMException`, `structuredClone`, `TextDecoderStream` / `TextEncoderStream`, and Expo's own `fetch`. React Native supplies `AbortController`, `Headers`, `Request`, `Response`, `Blob` and `FileReader`.
  - Expo's `fetch` rejects with `FetchError extends Error` (`expo/src/winter/fetch/FetchErrors.ts`), **not** `TypeError`, unless `EXPO_PUBLIC_USE_RN_FETCH` is set.
  - PostgREST turns any fetch rejection into `status: 0`, so database calls are unaffected. Direct `fetch` callers that test `instanceof TypeError` / `DOMException` are affected.
- **Build settings:** `import.meta.env` is rewritten by `native/babel/vite-env.js` to `DEV: false`, `PROD: true`, `MODE: 'native'` and three keys:
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PHOTO_WORKER_URL`, taken from the matching `EXPO_PUBLIC_*` variables.
  - **Every other `VITE_*` key is undefined.** `__BUILD_ID__` (a Vite define) does not exist.
- **Metro:**
  - Watches `native/` and `src/` only (`native/metro.config.js:38`).
  - Swaps `lib/supabase`, `lib/nativeBridge`, `lib/nativeAuth` and `preview/flag` (by alias or relative path), and the packages `@capacitor/core` and `@capacitor/app`.
  - Resolves packages from `native/node_modules`. Not installed there: every other `@capacitor/*` package, `@capacitor-community/keep-awake`, `three`, `motion`, `react-router-dom`, `lucide-react`, `@dnd-kit/*` and `barcode-detector`. `react-dom` is installed.
- **Preview mode is on by default** (`native/src/platform/previewFlag.ts:6`, unless `EXPO_PUBLIC_HYPER_PREVIEW=0`). The client is then the in-memory mock from `src/preview/mockSupabase.ts`.

### 5.2 Every `src/lib` and `src/stores` file that touches these APIs

"Top level" means the code runs when the module is imported. "Works" means it behaves correctly in React Native today.

| File | What it touches | Top level or in functions | Guarded? | Status in RN / what a replacement must provide |
|---|---|---|---|---|
| `lib/haptics.ts` | **`@capacitor/haptics` import**; `@capacitor/core`; `navigator.userAgent/platform/maxTouchPoints` (:25-28); `document.createElement` switch trick | **Imports and the `isIOS` constant run at top level**; DOM in functions | Navigator read guarded; DOM behind `isIOS` | **Breaks the bundle** (unresolvable package). Replacement maps `tapHaptic` → light impact, `completionHaptic` / `celebrationHaptic` → success notification, `selectionHapticStart` / `selectionHaptic` / `selectionHapticEnd` → selection (`expo-haptics`; `native/src/lib/haptics.ts` already wraps it) |
| `stores/themeStore.ts` | **`@capacitor/status-bar` import**; `@capacitor/core`; `matchMedia`, `document`, `window`, localStorage `hyper-theme` | Imports and **`resolveInitialPreference()` at top level (:78)**; listeners in functions | `isBrowser()` needs `document`, so false in RN | **Breaks the bundle.** Even with a shim the preference is never read and the theme is always `light`. Needs a native theme store: `Appearance` + localStorage + `expo-status-bar` |
| `lib/restNotifications.ts` | **`@capacitor/local-notifications` import**; `window.__HYPER_PREVIEW__` | Import at top level; the rest in functions | Yes | **Breaks the bundle.** Needs `expo-notifications`: one replaceable notification (id 1001), permission asked once per launch, no banner in foreground |
| `lib/restTimerWorkoutGuard.ts` | Imports `restNotifications` and `liveActivity` | Import | — | **Breaks the bundle** through `restNotifications` |
| `lib/keepAwake.ts` | **`@capacitor-community/keep-awake` import**; `@capacitor/core` | Import at top level; hook body in functions | Yes | **Breaks the bundle.** Needs `expo-keep-awake` (install it explicitly; today it is only a transitive dependency) |
| `lib/foodTrial.ts` | **Imports `../../supabase/functions/analyze-food-trial/{model,serving}.ts`** (and `tavily.ts` through them); localStorage `hyper.food-analysis.mode`; `import.meta.env.VITE_FOOD_ANALYSIS_MODE` (**not mapped**), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; `fetch` + `AbortSignal.timeout(110000)`; `structuredClone`; `TypeError` / `DOMException` checks | Imports at top level; the rest in functions | Partly | **Likely breaks the bundle**, because the folder is outside Metro's watched roots (**verify**). The mode setting defaults to worker in native. Expo `FetchError` is misclassified (:89, :114). Needs that folder watched (or its pure parts moved under `src`), the key mapped, and the error check widened. `tavily.ts:26` uses a `\p{L}` regex (**verify on Hermes**) |
| `stores/appStore.ts` | localStorage `program:workout-mode` (:148-165, try/catch); `globalThis.crypto?.randomUUID` (:241, :1441, with fallbacks); **`crypto.randomUUID()` at :1230** | In functions | **No** at :1230 | Without a polyfill the swap throws `ReferenceError`; **covered since 02:06** by `native/src/platform/setup.ts:7-14`. Flexible superset ids would otherwise fall back to a non-UUID string inside JSON, which is accepted |
| `lib/pendingEntryId.ts` | **`crypto.randomUUID()`** as the default generator (:6) | In functions (on first `take()`) | **No** | Without a polyfill every new food entry throws on `take()`; **covered by the native polyfill**. Native `log-food.tsx:92` already uses it |
| `lib/mealComposition.ts` | **`crypto.randomUUID()`** as a default parameter (:100); localStorage meal drafts (:171-197) | In functions | **No** for crypto | Throws without a polyfill when called without an id; **covered by the native polyfill**. Storage works |
| `lib/splitDraft.ts` | `globalThis.crypto?.randomUUID` with a `"{ms}-{random}"` fallback (:47-50) | In functions | Yes, but the fallback is not a UUID | Without a polyfill, **program save fails** when a superset exists: `save_split_snapshot` casts `superset_group_id` to UUID, and the preview mock does not catch it. **Covered by the native polyfill**; keep it installed before shared modules load |
| `lib/requestIdempotency.ts` | `crypto.subtle.digest`, `TextEncoder`, `randomUUID` (:2-9) | In functions | Yes | `crypto.subtle` is absent even with the polyfill. It falls back to a random key, so identical photo, describe and coach requests no longer re-attach to the same worker job across separate taps. Needs a SHA-256 digest (`expo-crypto` `digestStringAsync`) behind the same function |
| `lib/commitFocusedField.ts` | `react-dom` `flushSync` (import); `document.activeElement`, `HTMLInputElement` / `HTMLTextAreaElement` | Import at top level (resolves); DOM in functions | **No** | **Throws when called** (Program Save, Cancel, Discard). Needs a native version that blurs the focused `TextInput` and waits for its commit |
| `lib/discardSplitEdit.ts` | Calls `commitFocusedField` and `requestConfirm` | In functions | — | Throws until the above is replaced; also needs a native confirm host, or `requestConfirm` always answers "no" |
| `lib/fx.ts` | `document.visibilityState` (guarded); `element.getBoundingClientRect()` in `emitBurstFrom` | In functions | Partly | `emitBurstFrom` throws with React Native view refs (via `useTargetSeal`). Native needs its own celebration layer |
| `lib/authResume.ts` | `@capacitor/app`, `@capacitor/core` (shimmed); `document.visibilityState` and listeners | Imports at top level (shimmed); the rest in functions | Yes (`installAuthResume` returns a no-op without `document`) | Imports fine. `resumeAuth`, `pauseAuth`, `recoverAuthSession` and `pendingAuthRecovery` are exported and reusable. Native must call `resumeAuth` / `pauseAuth` from `AppState` itself |
| `lib/authDiagnostics.ts` | `window.localStorage` (guarded); `import.meta.env.DEV/MODE` | In functions | Yes | Works. The trail can no longer be read through Safari Web Inspector, so native needs another way to export it |
| `lib/patientFetch.ts` | `TypeError` and `DOMException('AbortError')` classification (:19-28) | In functions | — | **Misbehaves:** Expo's `FetchError` is neither, so Mac-worker requests (describe, photo, coach) are not retried and "unreachable" is never detected. Classify `FetchError`, or run with React Native's fetch |
| `lib/foodDescription.ts`, `lib/nutritionCoach.ts`, `lib/photoAnalysis.ts` | `DOMException` abort checks (:105 / :173 / :199) | In functions | — | Same misclassification of aborts and timeouts |
| `lib/photoAnalysis.ts` | **`import.meta.env.VITE_PHOTO_WORKER_URL` and `DEV` at top level (:48-49)**; localStorage worker settings; `fetch` + `AbortSignal.timeout(5000)`; `auth.updateUser` | Top level (env); the rest in functions | Mapped | Works (`EXPO_PUBLIC_PHOTO_WORKER_URL`; no localhost fallback because `DEV` is false) |
| `lib/timedFetch.ts` | `DOMException`, `AbortController`, signal listeners | In functions | — | Only the web `lib/supabase.ts` imports it, and that is swapped, so it is **not used by native**. The native client should adopt it to keep the deadlines (§5.5) |
| `lib/nativeSecureStorage.ts` | `window.localStorage` (legacy copy) | In functions | — | Not reached (only the swapped web client imports it). Its rules must be re-implemented over a native secure store |
| `lib/liveActivity.ts` | `registerPlugin('WorkoutActivity')`; `Capacitor.isNativePlatform()` checks | **`registerPlugin` at top level** | Shim returns a proxy | Imports fine; every call is a no-op. Needs an ActivityKit module |
| `lib/nativeGlassSurfaces.ts` | `registerPlugin('HyperGlassSurfaces')`; `document`, `MutationObserver` (:170-195) | `registerPlugin` at top level; DOM in functions | Partly; the DOM calls sit behind `isNativeIOS()` callers | Imports fine; no-op. Web-shell feature; native uses RN views |
| `lib/nativeGlassNavigation.ts` | `registerPlugin('HyperGlassNavigation')` | Top level | Shim | No-op; replaced by `NativeTabs` |
| `lib/motionPolicy.ts` | `window.matchMedia`, `document.createElement('canvas')`, `navigator.connection` / `hardwareConcurrency` | In functions | Yes | Reduced motion always reads as off, and "rich" as false. Needs `AccessibilityInfo.isReduceMotionEnabled` |
| `lib/motionLight.ts`, `lib/litSurfaces.ts` | `window` device orientation, `document` scroll, `HTMLElement` | In functions | Yes (`typeof document`) | No-op; the web lighting effect has no native equivalent |
| `lib/restTimer.ts` | `window.localStorage` (guarded); `window.AudioContext` chime (:227-260) | In functions | Yes | Storage works; the chime is silent. Needs `expo-audio` or a haptic-only signal |
| `lib/runTrackerCues.ts` | `window.AudioContext`, `window.setTimeout`; imports `haptics` | In functions; import at top level | Yes for audio | **Breaks the bundle** through `haptics`; cues silent |
| `lib/three/host.ts` | **`three` import**; `window.devicePixelRatio`, `document` | Import at top level | — | Breaks the bundle if imported. Web 3D only (coin and maquette) |
| `lib/sheetLayers.ts`, `lib/routeScroll.ts`, `lib/appViewport.ts` (`revealSheetField`), `lib/staleChunkReload.ts` | `document.body`, `MutationObserver`, `inert`, `ResizeObserver`, DOM listeners, `getComputedStyle`, `sessionStorage`, `location.reload`, `navigator.onLine` | In functions (`staleChunkReload`'s browser object holds arrow functions) | Mostly no | Web shell only; not needed in native |
| `lib/nativeAuth.ts`, `lib/nativeBridge.ts`, `lib/supabase.ts` | `window.location`; `registerPlugin`; top-level `import.meta.env` | — | — | Swapped by Metro, including relative imports |
| `lib/healthWeights.ts`, `lib/healthWeightCore.ts`, `lib/weightDisplayCore.ts`, `lib/targetSeal.ts`, `lib/whoopReconciliation.ts`, `lib/planSchedule.ts` (also `import.meta.env.DEV` in a function), `lib/restPreferences.ts`, `lib/splitDraftStorage.ts` | localStorage (bare, `globalThis.`, or as a default parameter evaluated at call time) | In functions | Varies | Works with the SQLite polyfill |
| `lib/animations.ts` | `import type` from `motion/react` | Type-only (erased) | — | Safe |
| `lib/nativeOAuthCallback.ts` | `new URL(...)` | In functions | — | Works (Expo URL), but requires the `app.hyper.mobile` callback |

False positives (the word appears only in comments, or names a local variable called `window`): `adaptiveExpenditure.ts`, `confirmDialog.ts`, `todayRefresh.ts`, `whoopSync.ts`, `runTracker.ts`, `whoopImport.ts`, `workoutWhoop.ts`. Every other file in `src/lib` and `src/stores` has no browser or Capacitor use: it is pure, or uses Supabase or React only.

### 5.3 Ranked: what breaks or misbehaves when imported

1. **Breaks the whole bundle** (Metro cannot resolve the import; one occurrence anywhere in a screen's import chain stops the app):
   - `@capacitor/haptics`, via `lib/haptics.ts`. About 22 importers, including `runTrackerCues`, `useTargetSeal`, `useScrub`, `CommandCapsule`, shared buttons, `DateTimePicker`, `BarcodeScanner`, `ServingEntry` and Settings.
   - `@capacitor/status-bar`, via `stores/themeStore.ts`. Imported by App, Toast, ThemeToggle, RestTimerPill, SessionToken, MetalRing, VolumeMaquette, `useNativeGlassNavigation` and Settings.
   - `@capacitor/local-notifications`, via `lib/restNotifications.ts` → RestTimerPill and `restTimerWorkoutGuard`.
   - `@capacitor-community/keep-awake`, via `lib/keepAwake.ts` → Workout page and `useRunTracker`.
   - `supabase/functions/analyze-food-trial/*`, via `lib/foodTrial.ts` → FoodLogger, FoodTrialLogger, ServingEntry, `foodTrialReview` and Settings (**verify**).
   - `three` (`lib/three/host.ts`), plus `motion`, `react-router-dom`, `lucide-react`, `@dnd-kit/*` and `barcode-detector`. These appear only in components, pages and hooks, never in `src/lib` or the stores (except the type-only `motion` import).
2. **Crashes when the code runs:**
   - Missing `crypto.randomUUID` without the native polyfill: `appStore.ts:1230` (swap), `pendingEntryId.ts:6` (new food entries), `mealComposition.ts:100`, plus component copies at `MealLogger.tsx:62, 110` and `FoodLogger.tsx:1168, 1177, 1355`. Covered since 02:06 by `native/src/platform/setup.ts:7-14`.
   - Missing `document` on mount: `useTodayRefresh.ts:77-103`, `useWhoopForegroundSync.ts:43-50` (when signed in), `useAppViewport.ts:13-83` and `useSplitDraftAutosave.ts:21-31`. `useRunTracker.ts:527-534` fails once a run starts.
   - Missing `document` when called: `commitFocusedField` (Program Save / Cancel / Discard); `fx.emitBurstFrom` with a native ref.
3. **Saves fail without the polyfill:** program supersets get non-UUID ids from `splitDraft.ts:47-50`, which the RPC rejects. The native polyfill prevents this, but nothing in the shared code enforces it.
4. **Silently different:**
   - Theme always light and never saved.
   - Food analysis defaults to the Mac worker (`VITE_FOOD_ANALYSIS_MODE` unmapped).
   - Worker requests are not retried (Expo `FetchError`), and duplicate AI requests are not de-duplicated (no digest).
   - Chime and run cues silent; reduced motion never detected.
   - Every `isNativeIOS()` branch takes its web path: Health, OAuth, barcode, GPS, the Apple button.

### 5.4 Import-graph check (static, from the stores)

| Entry | Shared modules reached | Packages reached | Native result |
|---|---|---|---|
| `stores/appStore.ts` | 44 | zustand, date-fns, `@supabase/supabase-js`, `@capacitor/core` + `@capacitor/app` (via `authResume.ts` and `nativeBridge.ts`; both shimmed) | Imports cleanly. Runtime risk only at :1230 |
| `stores/authStore.ts` | 50 | same | Imports cleanly |
| `stores/splitEditStore.ts` | 18 | same (date-fns via `preview/previewData.ts`) | Imports cleanly. Runtime risk: superset UUID fallback |
| `stores/themeStore.ts` | 1 | zustand, `@capacitor/core`, **`@capacitor/status-bar`** | **Breaks** |
| `lib/foodTrial.ts` | 5 | — (reaches `supabase/functions/analyze-food-trial/{model,serving,tavily}.ts`, outside `src/`) | **Likely breaks** |
| `components/dashboard/todayModel.ts`, `components/workout/workoutFocus.ts`, `components/nutrition/foodLoggerUtils.ts`, `components/nutrition/usdaSearch.ts` | 1–2 | none / date-fns | Clean |
| `hooks/useRunTracker.ts` | 9 | react, **`@capacitor/haptics`**, **`@capacitor-community/keep-awake`** | **Breaks** |

Method: a static scan of `import` / `export … from` / `import()` statements, with type-only imports skipped. The shared modules the native app imports today (Appendix E) reach no unresolvable package.

### 5.5 What the swapped modules do not reproduce

| Swap | Web original does | Native replacement does today |
|---|---|---|
| `lib/supabase` → `native/src/platform/supabase.ts` | Keychain storage on iOS with timeouts, cache and tombstones; `timedFetch` deadlines (30 s / 5 s refresh / 120 s snapshot); refresh diagnostics; `installAuthResume`; throws without env outside preview | `globalThis.localStorage` (SQLite) storage, **not** a secure store; no deadlines, diagnostics or resume; preview mock by default |
| `lib/nativeBridge` → `native/src/platform/nativeBridge.ts` | Capacitor plugins | `isNativeIOS() → false`; all plugin calls reject |
| `lib/nativeAuth` → `native/src/platform/nativeAuth.ts` | iOS auth sheet + PKCE exchange; redirect `app.hyper.mobile://auth/callback` | Returns "not available"; redirect `hyper-native://auth/callback`, which the shared parser rejects |
| `preview/flag` → `native/src/platform/previewFlag.ts` | Preview only in dev builds, after visiting `/preview` or `/sandbox` (held for that tab) | **On unless `EXPO_PUBLIC_HYPER_PREVIEW=0`** |
| `@capacitor/core`, `@capacitor/app` → `native/src/platform/capacitorShim.ts` | Platform checks; `appStateChange` | `isNativePlatform() → false`; listeners never fire |

---

## 6. Suggested build order

### 6.1 What the native app has now (as read at 02:14)

| Native route | What it does | Biggest gaps against §1–§2 |
|---|---|---|
| Shell (`native/src/app/_layout.tsx`, `(tabs)/_layout.tsx`) | Native stack; `NativeTabs` (Today, Train, Fuel, You) with a bottom accessory for the live workout and rest countdown; theme follows `useColorScheme`; `maybeSeedPreview()`; dev launch runner; `index.tsx` → `/today` | No `authStore.initialize()`, sign-in, boot or offline splash, deep links, foreground hooks (auth resume, Today refresh, WHOOP, Health), rest-timer guards or theme preference. Preview data only |
| `today` | Date line; live-session card with tally and Resume / Finish; Fuel kcal left / over with Eaten and Protein meters; This week in-range summary and insight (`todayModel`) | No data loading or refresh; none of the nine hero states; no schedule, program week, next session, seals or volume card; no Progress / Program / History routes |
| `train` | Split-day start list; one current-set card (weight / reps fields, ±5 lb / ±1 rep, RPE 6–10 sheet); `logSet` then rest; "Not saved" with Retry; movement focus; Finish confirm → `completeWorkout` → `session-done` | Most of §1.6 and §2.2–§2.4: plan model, supersets, ledger editing, add / remove sets, swap, reorder, notes, flexible mode, schedule, durable rest timer with notification, Live Activity, keep-awake, finish rules |
| `session-done` (full-screen modal) | Tally, sets, volume, minutes, best set, week count from its own query | Web summary rules (tonnage, gains, duration); uses the auth-store user id |
| `fuel` | Today only: kcal and target, macros when a target exists, the day's groups then Unassigned, load error | Day navigation, edit / delete / move, group management, default groups, seals, capsule text |
| `log-food` (form sheet) | Saved and USDA search (350 ms, ≥ 2 characters); destination group; one-tap log of 1 serving with a retry id | Review stage (amount, unit, date, time), Scan, Manual, Describe, Photo, AI, meal builder, saved-meal management |
| `you` | Name, initials, email; targets; program name and days per week; preview note | Every Settings sub-page and action in §1.12 |

### 6.2 Milestones

This keeps the order in [2026-10-26-native-blanc.md](2026-10-26-native-blanc.md), with four changes that follow from the dependencies found here:
- A shared-code readiness step comes first.
- Today is rebuilt together with Train, because both use the same schedule and session logic.
- The exercise picker is built with Train, because swap and flexible add need it.
- The Health and barcode native modules are built with the screens that need them, not with the run tracker.

**M0. Shared-code readiness** (before more screens; no visible UI)
1. **Bundle blockers:**
   - Metro swaps for `lib/haptics` (same six exports over `expo-haptics`), `stores/themeStore` (same API over `Appearance` + `expo-status-bar` + localStorage), `lib/restNotifications` (`expo-notifications`) and `lib/keepAwake` (`expo-keep-awake`, installed explicitly).
   - Make `supabase/functions/analyze-food-trial/*` resolvable for `lib/foodTrial.ts`.
   - Map `VITE_FOOD_ANALYSIS_MODE` in `native/babel/vite-env.js`.
2. **Runtime gaps:**
   - Keep the `crypto.randomUUID` polyfill first in the entry file (in place since 02:06), and add a digest for `requestIdempotency`.
   - Classify Expo `FetchError` as transient in `patientFetch` / `foodTrial` / `photoAnalysis` / `foodDescription` / `nutritionCoach`, or switch to React Native's fetch.
   - Native versions of the `document`-based hooks: `useTodayRefresh`, `useWhoopForegroundSync`, `useNativeHealthSync`, run resync, draft autosave, and the note flush on background. Also a `commitFocusedField` replacement and a native `requestConfirm` host.
3. **Supabase client parity:** `timedFetch` deadlines, refresh diagnostics, `AppState` → `resumeAuth` / `pauseAuth`, and secure session storage with the `nativeSecureStorage` rules (3 s deadline, cache fallback, tombstone, revisions).
4. **Extraction of §3 logic, in the order the next milestones need it:**
   - Train session model, supersets and finish sequence.
   - Today hero state and `todayModel` / `workoutFocus` / `workoutCapsule` / `movementOrder` moved into `src/lib`.
   - `upsertFoodIfNeeded`, the entry payload, barcode lookup and the manual-save rules.

**M1. Real accounts** (the plan's milestone 2)
- **Screens and flows:** sign-in and sign-up (password, name, resend verification, existing-account handling), Google, Apple, the boot splash, and the offline restore with **Sign in instead**. Email-confirmation and OAuth deep links, including the cold start. Sign-out cleanup.
- **Supporting work:** `getSessionUserId` everywhere, and the preview flag off for real builds.
- **Decision needed:** which callback scheme and bundle id to use before cutover. The shared parser, the WHOOP allow-list and Supabase's redirect allow-list all accept only `app.hyper.mobile`.
- **Riskiest:** session restore and offline behaviour must match §2.10 exactly. Set and food saves can only be validated against the real backend: the preview mock checks neither RLS nor UUIDs.

**M2. Today and Train complete** (the plan's milestone 3, plus Today)
- **Today:** all hero states, refresh and day rollover, remembered day, seals, volume card.
- **Train pre-session:** split and flexible modes, schedule setup and edit, week strip, Train a different day, the adaptive-scheduling copy.
- **Live session:**
  - ledger with completed-set editing and kept drafts; autofill and "last workout"; gains;
  - capsule model; adjust sets with ranges; supersets (pairing, round order, rest after B);
  - session swap and switch back; flexible editing; notes autosave; reorder with restore;
  - durable rest timer (per-exercise preferences, presets / custom, notification, guards); keep-awake;
  - finish rules and the template prompt.
- **Exercise picker:** single-select, search, muscle filter, calisthenics section.
- **Riskiest:**
  - set persistence (§2.2: save before rest, Retry with the same payload, id-based saves, the Add guard, `workoutMutationSeq`);
  - multi-step writes with rollback (swap, reorder);
  - the shared note write queue;
  - the rest-timer lifecycle across background and relaunch.

**M3. Fuel complete** (the plan's milestone 4)
- **Day and groups:** day navigation and month sheet; default groups and group add / reorder / delete; ledger move, move to yesterday, delete and edit.
- **Logger:** the review stage with amount / unit / date / time / destination and the time pickers; Saved, USDA, Manual and Describe; Photo and AI (image picker plus the compressor); meal builder and drafts; saved meals; close guards.
- **Barcode:** a VisionKit or camera module with the §2.14 rules.
- **Riskiest:** the time and day rules (§2.1), retry idempotency, and food-row reuse. Both apps write the same rows. The barcode lookup order and GTIN equivalence; the photo size and quality limits.

**M4. History and Coaching** (the plan's milestone 5)
- **History:** calendar and month load; the edit protocol through the existing store actions; activities (create / edit / hide / delete); merge; attaching WHOOP stats; WHOOP Sync; notes.
- **Coaching:** volume rows, the muscle map (a 2D or 3D native replacement), training hours, weekly nutrition charts. `react-native-svg` or an equivalent is needed.
- **Riskiest:** the edit protocol's identity rules (§2.5); the WHOOP hide-vs-delete and `user_edited` rules (§2.12); merge maths.

**M5. Program** (the plan's milestone 6)
- **Programs list:** set active; delete with confirm; training-mode switch; flexible templates (start / rename with overwrite / delete); plan-start prompt.
- **Editor:** days, exercises, supersets, set ranges, drag reorder with blocks, undo, autosave and restore banner, discard confirm on every close path including swipe-down.
- **Chooser and picker:** guided / blank chooser; the picker's multi-select and custom exercises.
- **Riskiest:** drag with superset blocks inside a scrolling sheet; committing typed cells before save; the create path (insert inactive → snapshot → activate → delete on failure); superset UUIDs.

**M6. You** (the plan's milestone 7)
- **Pages:** home with the weight block and Log weight; account; training (adaptive scheduling); appearance; targets (view / edit / calculate / coach / adaptation / resume adaptive); saved meals; food analysis (mode, usage, worker); connections (WHOOP OAuth, Apple Health with a custom HealthKit module); weight page; about; search; unsaved-change guard across sub-pages.
- **Riskiest:** the WHOOP OAuth callback (§2.12); the HealthKit module and entitlements (§2.13); target-source staging (manual vs calculated, §2.16).

**M7. Run tracker and Live Activities** (the plan's milestone 8)
- Port `HyperRunPlugin` as an Expo module with the same JS surface, and the Run screen.
- A widget-extension target (config plugin) with both Live Activities and the `RunControlIntent`.
- Workout Live Activity syncing from Train.
- **Riskiest:** background GPS with a durable trace, crash and relaunch recovery, the two-tap Finish, and Live Activity state shapes duplicated across targets (§4.2). The current extension requires iOS 26.5.

**M8. Parity walk and cutover** (the plan's milestone 9)
- Walk this inventory and `docs/testflight-acceptance-checklist.md` on a device.
- Decide the bundle id and scheme (§4.4): Keychain service and keys, Health permission, recorder files.
- Accept that device-only settings reset (Appendix C).
- Each release or production step needs the owner's approval.

### 6.3 Riskiest flows, ranked

1. **Set persistence and auth recovery** (§2.2, §2.10): save before rest, Retry with the same numbers, the id-based target, the Add guard, and the stall protections that depend on `timedFetch` and auth resume.
2. **Session restore and sign-in persistence** (§2.10): offline restore, secure storage rules, callback scheme, and bundle-id migration.
3. **Food logging with time** (§2.1): the local `date` vs UTC `logged_at`, past-day defaults, retry ids, groups and `meal_type`, food-row reuse. Two apps write the same rows.
4. **Multi-step workout writes** (§2.2–§2.4): supersets, reorder with restore, session swap with rollback.
5. **Editing past workouts** (§2.5): plan-on-demand, set compaction, merging inserted and deleted ids into the live workout.
6. **WHOOP** (§2.12): the fixed callback allow-list; tombstones vs deletes; the GPS-run absorb rule.
7. **Run tracker with Live Activity** (§2.15): background GPS, durable trace, lock-screen controls.
8. **Apple Health** (§2.13) and **barcode** (§2.14): custom native modules and permissions.
9. **Program editor** (§2.8): drag blocks, autosave timing, every close path guarded.

### 6.4 Behaviours to keep or change on purpose

These are current behaviours that look unintentional or inconsistent. They are listed so the rebuild decides on them knowingly rather than copying or dropping them by accident.

| Behaviour | Where |
|---|---|
| Fuel and History calendars and the DateField start on Sunday; training weeks start on Monday | §2.19 |
| A food entry on a past day defaults to 00:00 | `FoodLogger.tsx:204-207` |
| History's Move earlier / later swaps neighbours and ignores superset pairs (Train keeps pairs together) | `History.tsx:1676-1705` |
| Nothing blocks editing, activating or deleting a program mid-workout; removing the live day makes the workout drop off Train | §2.8 |
| `startWorkout` resumes the newest unfinished workout even when a different day was tapped | Store :918-938 |
| Settings shows "WHOOP connected." whenever `connectWhoop` returns `null`, including when there is no session user | `Settings.tsx:445`; Store :2130-2132 |
| Viewing a Fuel day creates its Breakfast / Lunch / Dinner rows | `Nutrition.tsx:256-318` |
| Fuel's target fallback uses `\|\|` (a saved 0 becomes the default); Settings uses `??` | `Nutrition.tsx:427-430`; `Settings.tsx:666-669` |
| Silent failures: live add / remove set, template delete, template save before finish, move-between-groups (console only) | Store :1305-1308, :1740-1743, :1716-1719; `Nutrition.tsx:385-389` |
| No confirm on deleting a food entry or a History set | `Nutrition.tsx:197-214`; `History.tsx:1260-1264` |
| Editing one entry and logging several photo items updates the same row, so the last item wins | `FoodLogger.tsx:1264-1291` |
| Weekly volume counts completed sets from unfinished workouts; History edits don't trigger a recompute | Store :3451-3453 |
| History groups workouts by the local date of `created_at` but fetches the month by `date` | `History.tsx:874, 992` |
| The Health sync flag is device-wide, not per account; turning it off keeps permission and rows; changes take full effect on the next launch | `healthWeightCore.ts:3, 23-33`; `useNativeHealthSync.ts:11` |
| WHOOP sync wording differs between Settings ("Synced — X new, Y updated.") and History ("Synced • n new • m updated") | `Settings.tsx:470-489`; `History.tsx:1157-1158` |
| There is no password reset or in-app account deletion | §1.3 |

---

## Appendix A: backend surface

**Tables** (client callers):

| Table | Called from |
|---|---|
| `activity_sessions`, `activity_segments` | Store |
| `body_weight_measurements` | `lib/healthWeights.ts` |
| `exercise_rest_preferences` | `lib/restPreferences.ts` |
| `exercises` | `lib/exerciseLibrary.ts`, `lib/customExercises.ts` |
| `flex_day_templates` | Store |
| `foods` | `FoodLogger.tsx`, `lib/foodPersistence.ts`, `lib/nutritionLogQueries.ts`, `lib/saveMealComposition.ts`, `lib/savedBarcodeFoods.ts`, `lib/savedMeals.ts` |
| `macro_targets` | Store, `Settings.tsx` |
| `nutrition_groups` | `Nutrition.tsx`, `lib/mealDestination.ts` |
| `nutrition_logs` | `Nutrition.tsx`, `lib/nutritionLogQueries.ts`, `lib/saveNutritionEntry.ts` |
| `nutrition_profiles` | `lib/nutritionProfile.ts` |
| `plan_schedules` | `lib/planSchedule.ts` |
| `profiles` | `stores/authStore.ts` |
| `program_preferences` | Store |
| `sets` | Store, `lib/saveWorkoutSet.ts`, `lib/previousSetTargets.ts` |
| `split_days` | Store, `History.tsx` |
| `split_exercises`, `splits`, `volume_landmarks`, `whoop_connections` | Store |
| `workout_day_plans` | Store, `History.tsx` |
| `workouts` | Store, `Workout.tsx`, `Analysis.tsx`, `lib/planSchedule.ts`, `lib/previousSetTargets.ts`, `lib/todayDay.ts`, `lib/weekSessions.ts` |

`whoop_tokens` is server-only. There are no Storage buckets.

**RPC:** `save_split_snapshot` (Store :622; `splitEditStore.ts:330`). Security definer; updates known ids, inserts new rows, deletes rows missing from the payload, casts `superset_group_id` to UUID (`supabase/migrations/20260221130000_add_superset_groups.sql:7-120`).

**Edge functions** (`supabase/functions/`):

| Function | Called how | Actions | Notes |
|---|---|---|---|
| `food-lookup` | `functions.invoke` (`lib/usdaClient.ts:13`) | `search`, `barcode`, `detail`, `open-food-facts-barcode`, `fatsecret-barcode` | Needs a signed-in token; FatSecret gated by `FATSECRET_ENABLED` |
| `analyze-food-trial` | Direct `fetch` to `${VITE_SUPABASE_URL}/functions/v1/analyze-food-trial` with Bearer + `apikey` (`lib/foodTrial.ts:19-29`) | analyze (default), `status`, `interpret-serving` | Gemini + Tavily; per-user UTC-day quota; replay of identical input |
| `whoop-oauth` | `functions.invoke` (`lib/whoopClient.ts:19, 33`) | `start`, `disconnect`; `/callback` (browser) | `returnTo` allow-list: `app.hyper.mobile://settings` or `${APP_BASE_URL}/settings` |
| `whoop-sync` | `functions.invoke` (`lib/whoopClient.ts:44`) | paged workout fetch | Token refresh and rotation server-side |

**Outside Supabase:** the owner's Mac worker (`scripts/photo-food-worker.mjs`), at the URL set in Settings: GET `/health`; POST `/analyze`, `/describe`, `/coach`, each with a Bearer Supabase token and `X-Idempotency-Key`. USDA, Open Food Facts and FatSecret are reached only through `food-lookup`.

**Auth calls:**
- `signInWithPassword`, `signUp` (`data.display_name`, `emailRedirectTo`), `resend`, `signInWithOAuth` (google / apple, `skipBrowserRedirect`) + `exchangeCodeForSession`.
- `getSession`, `getUser`, `refreshSession`, `startAutoRefresh` / `stopAutoRefresh`, `signOut`.
- `updateUser` with `user_metadata` keys `adaptive_split_scheduling` and `photo_worker_settings`.

**Data formats both apps must read and write identically:**

| Data | Format | Where |
|---|---|---|
| Composed meals | `foods.description` = `hyper:meal-composition:v1:` + JSON `{version:1, ingredients}` | `lib/mealComposition.ts:35, 117-138` |
| Movement notes | `workouts.notes` = JSON `{movementNotes, legacyNote}` | `lib/workoutNotes.ts:21-53` |
| Set ranges | `[set-range]{"min","max"}` line inside `split_exercises.notes` and plan-item notes | `lib/setRangeNotes.ts` |
| Session plans | `workout_day_plans.items` = `FlexiblePlanItem[]` (`exercise_id`, `exercise_name`, `order`, `target_sets`, `target_reps_min` / `max`, `notes`, `hidden`, `superset_group_id`, `substitutes_for`) | `types/index.ts:93-105` |
| Plan schedules | `plan_schedules.weekdays` holds the flexible anchor as a one-element array | `planSchedule.ts:146-148, 204-207` |
| External ids | `activity_segments.external_id` `gps:<runId>:<n>`; `body_weight_measurements.external_id` = Health UUID or `manual:<UTC ISO minute>`; `foods.external_id` = barcode or FatSecret `foodId:servingId` | §2.12–§2.15 |
| Log sources | `nutrition_logs.source` values | §2.1 |

## Appendix B: store action index

**`stores/appStore.ts`** (definition lines):

| Group | Actions |
|---|---|
| Programs | `fetchSplits` 554, `createSplit` 601, `updateSplit` 664 (unused), `deleteSplit` 671, `setActiveSplit` 678 |
| Mode and templates | `fetchWorkoutMode` 688, `setWorkoutMode` 721, `fetchFlexTemplates` 755, `startFlexibleWorkoutFromTemplate` 785, `renameFlexTemplate` 792, `deleteFlexTemplate` 861, `saveFlexibleTemplateFromCurrentWorkout` 1688 |
| Live workout | `fetchCurrentWorkoutDayPlan` 879, `startWorkout` 913, `startFlexibleWorkout` 1005, `fetchCurrentWorkout` 1142, `substituteWorkoutExercise` 1206, `switchBackWorkoutExercise` 1264, `addWorkoutSet` 1283, `setFlexibleWorkoutLabel` 1327, `addFlexibleExercise` 1353, `addFlexibleSuperset` 1424, `clearFlexibleSuperset` 1507, `updateFlexibleExerciseMeta` 1538, `removeFlexibleExerciseFromPlan` 1632, `removeLastUncompletedSet` 1724, `logSet` 1756, `updateSet` 1784, `completeWorkout` 1803 |
| History and past workouts | `fetchWorkoutsByMonth` 1835, `fetchWorkoutById` 1862, `deleteWorkout` 1880, `addSetToWorkout` 2552, `removeSetFromWorkout` 2601, `addExerciseToWorkout` 2673, `removeExerciseFromWorkout` 2711, `syncWorkoutCompletion` 2759, `updateWorkoutNotes` 2813, `fetchWorkoutDayPlanByWorkoutId` 2831, `ensureWorkoutDayPlan` 2857, `updateWorkoutDayPlanItems` 2988, `addSupersetToWorkout` 3017, `clearWorkoutSuperset` 3096, `updateWorkoutExerciseTargetSets` 3112, `reorderWorkoutExercises` 3202 |
| Activities, WHOOP, runs | `fetchActivitySessionsByMonth` 1908, `createActivitySession` 1934, `updateActivitySession` 1952, `mergeActivitySessions` 1979, `deleteActivitySession` 2012, `hasLinkedWhoopSegments` 2028, `fetchActivitySegmentsBySessionIds` 2048, `upsertActivitySegments` 2069, `fetchWhoopConnection` 2108, `connectWhoop` 2130, `disconnectWhoop` 2154, `syncWhoop` 2167, `attachWhoopToWorkout` 2386, `detachWhoopFromWorkout` 2421, `saveTrackedRun` 2455 |
| Nutrition targets and profile | `fetchMacroTarget` 3241, `updateMacroTarget` 3262, `fetchNutritionProfile` 3288, `updateNutritionProfile` 3301, `refreshAdaptiveTargets` 3317 |
| Volume | `fetchVolumeLandmarks` 3429, `calculateWeeklyVolume` 3444 |
| Infrastructure | `writesWorkout` 511 (write-sequence wrapper), `getWorkoutWriteSeq` 507, `workoutSetAddFlight` 496, `whoopSyncFlight` 474, `resetAppData` 3491 |

**`stores/authStore.ts`:** `initialize` 72, `fetchProfile` 113, `signIn` 135, `signUp` 151, `resendSignupConfirmation` 185, `signInWithGoogle` 201, `signInWithApple` 205, `updateDisplayName` 209, `signOut` 235.

**`stores/splitEditStore.ts`:**

| Group | Actions |
|---|---|
| Session | `startEdit` 219, `startNew` 231, `restoreDraft` 241, `restoreSaved` 251, `dismissRestore` 257, `cancelEdit` 264, `discardEdit` 268, `undoRemoval` 273, `dismissUndo` 279 (unused), `saveEdit` 283 |
| Program | `renameSplit` 357, `updateDescription` 361 |
| Days | `renameDay` 367, `reorderDays` 378, `moveDay` 387, `addDay` 396, `removeDay` 402 |
| Exercises | `reorderExercise` 413, `moveExerciseTo` 419, `updateExerciseTargets` 425, `swapExercise` 491, `addExercise` 515 (unused), `addExercises` 519, `addSupersetExercise` 534, `clearExerciseSuperset` 585, `removeExercise` 609, `updateExerciseNotes` 646 (unused) |

**`stores/themeStore.ts`:** `initializeTheme` 84, `setTheme` 108, `toggleTheme` 119.

## Appendix C: device-only state (localStorage keys)

None of these carry over from the WebView to the Expo app (§4.4).

| Key | Owner | Also on the server? |
|---|---|---|
| `hyper-theme` | `stores/themeStore.ts` | No |
| `hyper:weight-unit` | `lib/weightDisplayCore.ts` | No |
| `hyper:rest-timer` | `lib/restTimer.ts` | No (live rest session) |
| `hyper:rest-preferences:<user>` | `lib/restPreferences.ts` | Yes (`exercise_rest_preferences`) |
| `plan-schedule:<user>:<split>` | `lib/planSchedule.ts` | Yes (`plan_schedules`) |
| `plan-start-prompt:dismissed:<user>:<split>` | `pages/Splits.tsx` | No |
| `program:workout-mode` | Store | Yes (`program_preferences`) |
| `hyper:split-draft:v1:<user>:<split\|new>` | `lib/splitDraftStorage.ts` | No |
| `hyper:meal-draft:v1:<user>:<new\|edit:id\|saved:id>` | `lib/mealComposition.ts` | No |
| `hyper:seal:<day>:<macro>` | `lib/targetSeal.ts` | No |
| `hyper:health-weight-sync-enabled` (device-wide) | `lib/healthWeightCore.ts` | No |
| `hyper:health-weight-sync-cursor:<user>` | `lib/healthWeights.ts` | No (a full re-read is safe thanks to the UUID upsert) |
| `hyper:whoop-reconciliation:v1:<user>` | `lib/whoopReconciliation.ts` | No (the repair re-runs safely) |
| `hyper:run-tracker`, `hyper:run-tracker-trace` | `lib/runTracker.ts` / `hooks/useRunTracker.ts` | No |
| `hyper:auth-diagnostics` | `lib/authDiagnostics.ts` | No |
| `hyper.food-analysis.mode` | `lib/foodTrial.ts` | No |
| `hyper.photo-worker.url`, `hyper.photo-worker.provider`, `hyper.ai-settings.owner` | `lib/photoAnalysis.ts` | Worker settings restored from `user_metadata.photo_worker_settings` |
| `hyper.coach.goals` | `lib/photoAnalysis.ts` / `GoalsCoach.tsx` | No |
| `hyper.nutrition.combine-meal` | `FoodLogger.tsx` | No |
| sessionStorage `hyper:intro:<variant>:v2`, `hyper:stale-chunk-reload`, `hyper-preview`, `hyper-sandbox` | intro, stale-chunk reload, preview flag | Web only |

## Appendix D: tests that protect the shared rules

These run against the shared code (`npm run test`, Node environment by default per `vitest.config.ts`; only `commandCapsuleSave` and `useWeekSessions` opt into happy-dom). A native screen that calls the shared code inherits their protection. None of them exercises React Native, Hermes or a device.

| Flow | Test files (`tests/`) |
|---|---|
| Set saving and retry | `workoutSetSave`, `commandCapsuleSave`, `workoutAuthRecovery`, `timedFetch`, `authResume`, `withTimeout` |
| Set identity and counts | `workoutSetAddConcurrency`, `workoutPartialDeleteIdentity`, `workoutTargetSetIdentity`, `workoutPlanOps`, `setRangeNotes`, `setRangeDraft` |
| Session model and focus | `workoutFocus`, `workoutCapsule`, `movementOrder`, `workoutReorderPersistence`, `exerciseSubstitution`, `setAutofill`, `previousSetTargets`, `workoutProgress`, `workoutSessions`, `workoutWarmMount`, `appStore.workoutReadRace`, `previewWorkoutFlows` |
| Notes | `noteAutosave`, `workoutNotes`, `workout.noteHydration` |
| History edits | `workoutEditFailures`, plus the identity suites above |
| Rest timer | `restTimer`, `restPreferences`, `restTimerWorkoutGuard`, `liveActivity` |
| Schedule | `planSchedule`, `schedulePersistence`, `adaptivePlanSchedule`, `adaptiveSchedulingToggle`, `useWeekSessions` |
| Today | `todayCapsule`, `todayDay`, `todayRefresh` |
| Volume | `weeklyVolume`, `volumeRecommendation`, `maquette` |
| Food logging and time | `nutritionLogUtils`, `nutritionLogUtils.dayBoundary`, `entryDay`, `pendingEntryId`, `saveNutritionEntry`, `foodPersistence`, `foodLoggerUtils`, `nutritionGroups`, `nutritionMonthLoad`, `nutrition.monthRace`, `nutritionLogQueries`, `nutritionMacros`, `savedFoodsCache`, `mealComposition`, `saveMealComposition`, `mealDestination`, `combineMeal` |
| Barcode and lookups | `barcodes`, `barcodePriority`, `barcodeScanner`, `savedBarcodeCore`, `usdaBarcode`, `usdaSearch.portions`, `usdaSearch.resilience`, `openFoodFacts`, `fatSecret` |
| AI and worker | `foodTrialGateway`, `foodTrialModel`, `foodTrialReview`, `foodTrialTavily`, `foodTrialTransport`, `foodTrialUsage`, `servingInterpretation`, `foodDescription`, `photoAnalysis`, `patientFetch`, `requestIdempotency`, `nutritionCoach`, `photoWorkerBoot`, `photoWorkerCore`, `foodLogger.aiHandoff` |
| Targets and profile | `adaptiveExpenditure`, `appStore.adaptiveTargets`, `nutritionCalculator`, `nutritionProfile`, `settingsUx` |
| Program | `splitEditStore`, `splitEditSave`, `splitDraftStorage`, `splitDraftSeed`, `customExercises`, `exerciseLibrary`, `exerciseSearch`, `programDesigner`, `programDesigner.seedCoverage`, `confirmDialog` |
| Auth and session | `authStore.session`, `authStore.workoutIsolation`, `nativeSecureStorage`, `nativeAuth`, `sessionUser`, `authDiagnostics`, `appStore.sharedReads`, `appStore.mustWork` |
| WHOOP and activities | `whoopSync`, `whoopImport`, `whoopForegroundSync`, `workoutWhoop`, `mergeActivities`, `activitySessions`, `activityMetrics`, `activityTypeLabel` |
| Health and weight | `healthWeights`, `healthWeightsSync`, `weightTrend`, `weightDisplayCore`, `targetSeal` |
| Run | `runTracker`, `gpsCalibration`, `deviceMotion`, `nativeRunSource`, `nativeLegacyControls`, `useRunTracker.native` |
| Pickers and charts (pure helpers) | `wheelSelection` (time wheels), `chartGeometry` |
| Native app (pure helpers) | `nativeSessionModel` (untracked, added by the native session) |
| Web-shell modules native screens won't reuse | `splitEditor.focusedDraft`, `sheetLayers`, `appViewport`, `routeScroll`, `staleChunkReload`, `brandIntro`, `introState`, `motionLight`, `motionPolicy`, `litSurfaces`, `useLitSurface`, `fx`, `themeStore`, `nativeGlassNavigation`, `nativeGlassSurfaces`, `threeSpring` |

## Appendix E: shared modules the native app imports (as read at 02:14)

| Kind | Modules |
|---|---|
| Stores | `@/stores/appStore`, `@/stores/authStore` |
| Types | `@/types` |
| Libraries | `@/lib/supabase` (swapped), `@/lib/nutritionGroups`, `@/lib/nutritionMacros`, `@/lib/nutritionLogQueries`, `@/lib/saveNutritionEntry`, `@/lib/savedMeals`, `@/lib/sessionUser`, `@/lib/pendingEntryId`, `@/lib/usdaClient`, `@/lib/setAutofill`, `@/lib/previousSetTargets` |
| Components folder | `@/components/dashboard/todayModel` (pure) |
| Preview | `@/preview/previewSeed`, `@/preview/mockSupabase` |

None of these reaches an unresolvable package. The bundle blockers in §5.3 appear as soon as a native screen imports a shared component, hook, `themeStore`, `haptics`, `restNotifications`, `keepAwake` or `foodTrial`.
