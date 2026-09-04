# Approved Studio — app-wide implementation

Status: implemented and verified; ready for review. Base: f711882 (adaptive workout calendar, PR #104).
Branch: codex/studio-app-wide. No merge, deployment or TestFlight upload authorized.

## Design contract

Source of truth is the user's approved consolidated concept, not its earlier iterations:
`/Users/sinan/.codex/visualizations/2026/09/04/01a06e39-a754-7840-8249-079fbb0f3481/hyper-pitch/studio-type.css`, `studio-refinement.html`, and `studio-consolidated.png` in the same directory.

- Fraunces and Geist only. Shared roles: 40px/1.06 Fraunces 340 headings, 44px/1 Fraunces 340 key figures (optical size 144); Geist 14px/1.45 body, 12px/1.4 support, 11px/1.4 500 labels with consistent tracking. Scale or wrap for accessibility, don't truncate meaningful names. Compact metrics are tabular Geist, not a third mono voice. Large timer may use 60px.
- Existing Paper #F4F0E7, Ink #1A1612, muted #5A5249, well #ECE6D9, Lacquer #A8352A; preserve corresponding Ink palette.
- 24px page gutters, coherent 12/16/20/24/30px grouping. Neutral rules separate records. No card with a colored accent edge, regardless of color or meaning. Progress bars are data, not card decoration.
- Solid ink primary actions; quiet filled secondary actions; unboxed contextual row actions. 11px tracked labels, 44px minimum meaningful touch targets, approximately 11px action corners. Content remains editorial, not a grid of rounded/shadow cards.
- Anchored, unoutlined lower set-entry/rest surface with 20px top corners; entry fields become rest only after confirmed save. Full history/editability, supersets, flexible workflows and rest controls remain available.
- Stable four-destination navigation with larger readable labels; consistent safe areas, sheet structure, scroll memory, keyboard treatment and focus. No native glass rewrite.
- Immediate contact, short restrained local transitions (~120ms contact, 250–350ms state movement), reduced-motion support. Remove repeated decorative entrances/accents; preserve meaningful native haptics and integrations.

## Execution lanes

1. Root: shared typography/tokens, controls, navigation/sheets, Today, Analysis, integration and visual verification.
2. Training: workout start/resume, active movement, set composer/save/rest, completion, supersets/flexible mode; meaningful regression checks. Preserve save deadlines/retries/IDs/error values.
3. Other app flows: Fuel/food entry and edits, History, Programs/Splits, Settings and related components. Apply shared roles/control hierarchy; preserve time logging, past edits, program actions and integrations.
4. Shell investigation: establish and fix status-area scrolling overlap; route/scroll continuity, safe-area/keyboard foundation. Preserve auth and native/run behavior.

Delegation follows repository AGENTS.md's explicit Understand → Delegate → Split/Parallelize workflow. Agents share this worktree with disjoint file ownership; shared CSS changes stay with root.

## Verification / completion

- Baseline and final `npm run test`, `npm run lint`, `npm run build`.
- Mock preview only: Today start/resume, save/pending/failure/retry/rest/complete, Fuel logging with time, past edits, history, programs view/edit/delete, volume state, settings and shared sheets.
- Phone widths, Paper/Ink, readable names, scroll/safe-area geometry, reduced motion and keyboard focus. Device haptics/physical iPhone frame pacing and actual system keyboard behavior remain explicitly unverified unless a device becomes available.
- Compare actual screenshots with the approved consolidated reference, not an intermediate exploration.
- Audit all accent-edge cards and remaining third-font/direct outline-button uses. Do not touch auth flow, database schema, personal records, scanner/photo/run integrations, unrelated saved-checkout changes or secrets.
- Finish with scoped reviewable branch/draft PR if available, screenshots, current handoff in AGENTS.md and a concise report to the originating task. No source changes in the saved checkout.

## Delivered / verification evidence

- Shared typography now uses Fraunces and Geist only; compact data uses tabular Geist. Filled primary/secondary actions and contextual row controls replace recurring hollow outlines. Accent-edge cards are removed. Paper and Ink share the same roles, geometry and spacing.
- Active training uses one anchored set/rest surface, retained drafts, saved-set editing, confirmed-save progression and ordered superset-aware resume cues. Existing store save deadlines/retries and native callbacks remain in place.
- Safe-area padding is stationary outside the main scroll container. Route ancestors no longer transform fixed surfaces. Tab position is captured before navigation. Sheets isolate background portals, retain focus and follow the visible viewport.
- Fixed a time-wheel race that could overwrite a tapped minute after Done. Shared semantic color defaults allow explicit selected/destructive foregrounds; button states maintain readable contrast.
- DEV preview now exercises actual store and editor snapshot paths for program saves, past edits, new sessions and save recovery. It remains an in-memory approximation, not a backend emulator.

Final required checks: `npm run test` **PASS — 62 files / 668 tests**; `npm run lint` **PASS**; `npm run build` **PASS**. Build retains existing chunk-size and Browserslist-data warnings.

Browser verification: Paper/Ink at 390×844, program editing/date controls at 320px, actual food logging with a selected time and edited servings, past set 60→62.5 on refetch, program rename through snapshot save, workout completion/new Lower A session with 14 named placeholders, retained workout drafts, saved-set edits without rest, and failure→Retry→one saved set→rest. Nested sheet focus/background isolation and exact tab scroll restoration (955→955) checked. Console error was the deliberate injected save failure.

Safe-area simulation: temporarily supplied 59px top / 34px bottom insets, scrolled 844px, verified main remains clipped at y=59 and status region hits the stationary shell. Temporary test styles removed before final build. This does **not** substitute for iPhone validation; actual system keyboard, status bar, native haptics/frame pacing and camera/scanner integrations remain device checks. Reduced-motion branches are preserved in source; no operating-system preference was changed for this pass.

Screenshots are in the local task artifact directory:
`/Users/sinan/.codex/visualizations/2026/09/04/01a06e39-a754-7840-8249-079fbb0f3481/hyper-pitch/implementation/`

Representative files: `today-paper.png`, `workout-paper.png`, `fuel-paper.png`, `settings-paper.png`, `today-ink.png`, `set-save-retry-ink.png`, `set-saved-rest-ink.png`, `program-edit-320-ink.png`, `coaching-ink.png`, `safe-area-scroll-ink.png`.

Review preview: `http://127.0.0.1:5175/preview`. Recovery scenario: `/preview?previewSetSave=fail` → Train → Save set (both automatic attempts fail) → Retry. Full reload resets mock records.
