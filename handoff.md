# Handoff

Updated: 2026-07-16 (rev 10: production-like app sandbox; rev 9: dynamic nutrition groups, Cronometer import, and local subscription photo worker; rev 8: food-inbox design; rev 7: photo/subscription research)

## Rev 10 — production-like sandbox entry (implemented; browser-verified)

- Added dev-only `/sandbox`: it latches the existing in-memory Supabase backend, redirects directly to the normal Dashboard, and renders the real app routes without the `/preview` gallery/banner. Sandbox mode hides preview-only Cronometer/photo samples and GPS simulator controls, so the visible UI matches the app. `/preview` remains the fixture/simulator laboratory.
- Sandbox photo logging calls the real configured local worker instead of the mock result. Start with `npm run photo-worker:sandbox` (explicitly enables the preview-token bypass for private testing only) plus `npm run dev -- --host 127.0.0.1`. Settings health verified both OpenAI and Anthropic installed/authenticated. On iPhone, replace localhost worker URL with its private Tailscale HTTPS URL.
- Integration boundary: real Codex/Claude inference, a real user-exported Cronometer Servings CSV, and real iPhone GPS for Free/Intervals/Sprints can be tested in `/sandbox` while writes stay in memory. WHOOP/Strava buttons use the real UI but fixture transports in sandbox; real OAuth/account imports still require isolated Supabase staging because they need genuine JWTs, deployed callbacks/functions, secrets, and remote token tables.
- Browser verification: `/sandbox` redirected to the normal Dashboard; Fuel contained no sample buttons; worker health reported both providers signed in; Run showed only Free/Intervals/Sprints with no simulator selector; 390×844 viewport had no horizontal overflow; no console errors. Final validation remains 313/313 tests PASS, lint PASS, build PASS.
- Phone setup verified: Mac Tailscale is running; `https://alexanders-macbook-air.taileaf222.ts.net/sandbox` returns HTTP 200 through the private app route; `https://alexanders-macbook-air.taileaf222.ts.net:8443/health` proxies to the worker and reports OpenAI + Anthropic installed/authenticated. Keep both terminals and Tailscale running, set the in-app worker URL to the port-8443 origin, and keep this on private Serve, never public Funnel.

## Rev 9 — nutrition groups, Cronometer CSV, and local photo worker (implemented; sandbox-verified)

- Product constraint: iPhone web app/PWA is the primary runtime, with a possible future native wrapper/app. Preserve touch-first controls, iOS Safari camera/file input compatibility, safe-area and responsive behavior, HTTPS-only phone features, and portable provider/data interfaces. The private Codex/Claude subscription worker runs on the owner's Mac and must be exposed to the iPhone through an authenticated HTTPS route for testing; never assume `127.0.0.1` on the phone reaches the Mac. Keep nutrition capture/domain logic separate from browser transport so a future native camera/barcode client can reuse it.
- Added additive migration `20260716120000_add_nutrition_groups_and_imports.sql`: owner-scoped `nutrition_groups` and `nutrition_import_batches`, nutrition-log group/order/source/external-id provenance, food external identities, RLS, legacy breakfast/lunch/dinner/snack backfill, and idempotency indexes. Mirrored in `supabase/schema.sql` and client types. Migration is local only and has not been applied to any remote project.
- Fuel now supports unlimited day-scoped named groups (Breakfast, Lunch, Dinner) plus independently numbered Meal 1/2/… and Snack 1/2/…. Foods can be moved by desktop drag/drop or the accessible move sheet used on mobile; source badges distinguish Cronometer, OpenAI photo, Claude photo, and barcode entries.
- Added idempotent Cronometer **Servings CSV** import. Parser handles quoted CSV, current underscore-style headers, dates/times, embedded units, diary-group mapping, duplicate files/rows, and retry cleanup after a failed batch. Imported foods preserve exported macros/serving quantities and map to named/numbered groups.
- Reworked photo logging into a multi-food review: the model returns separate foods with editable grams/confidence/notes; the client best-effort resolves each component through USDA when configured, otherwise clearly retains the model estimate. Users may remove items, choose a group/date/time, and log all items with provider provenance.
- Added private local worker `scripts/photo-food-worker.mjs` plus strict JSON schema and `npm run photo-worker`. It verifies the app's Supabase JWT, restricts origins, stores each photo in a private temporary directory, invokes local Codex or Claude in safe/read-only mode, and deletes the job directory afterward. The app stores only worker URL/provider selection in local storage; provider credentials remain in their CLIs.
- Actual worker verification: health reports both CLIs installed and authenticated through the owner's subscriptions. The same 512×512 synthetic plate completed through both providers and returned valid separate rice/chicken/broccoli JSON. Claude correctly treated the illustration as low-confidence (0.20 each); OpenAI returned moderate confidence (0.58–0.62). Fixed Claude CLI compatibility by removing only the unsupported Draft 2020 `$schema` metadata from its strict schema argument; Codex continues using the original schema. This verifies worker/auth/schema wiring, not real-photo portion accuracy; the next model test must use an actual iPhone meal photo.
- Browser verification in `/preview`: created Meal 1 and Dinner while preserving Breakfast/Lunch/Snack 1; moved oats into Meal 1; imported the 4-row Cronometer sample with provenance; analyzed a preview plate into 3 editable items and logged all to Meal 1 with OpenAI provenance; changed/restored provider; checked the Fuel ledger at 390×844. No browser console errors.
- Final validation after all edits: `npm run test` PASS (27 files, 313 tests), `npm run lint` PASS, `npm run build` PASS. Existing warnings only: bundle >500 kB and stale Browserslist data. `git diff --check` PASS. `supabase db push --dry-run` PASS and lists exactly the four activity/integration migrations plus the new nutrition migration; nothing was pushed.
- Nutrition/photo safety checkpoint committed locally as `5a78c734 feat(nutrition): add grouped imports and subscription photo logging`. Unrelated pre-existing changes remain untouched: `supabase/.temp/cli-latest` and `.claude/launch.json`.
- Test readiness: preview/sandbox is ready now. Real signed-in nutrition, WHOOP, and Strava E2E still require an isolated remote Supabase staging project, applying the five pending migrations there, deploying the four OAuth/sync functions, configuring provider app credentials/callbacks, and starting the local photo worker. Do not push these migrations to production first.

## Rev 8 — unified food inbox, dynamic meals, and barcode-source decision (research/design only)

- Proposed nutrition UX: every captured item enters a day-scoped food inbox with source/provenance (`photo_openai`, `photo_anthropic`, `cronometer_csv`, `barcode`, `manual`). Users can create unlimited ordered containers labeled Meal 1, Meal 2, … and Snack 1, Snack 2, …, then move/reorder items between containers; unassigned items remain visible in the inbox.
- Current `nutrition_logs.meal_type` only supports a single text tag and cannot represent dynamic containers or ordering. Implementation requires an additive meal-container table plus nullable container/order/source/external-id fields on nutrition logs, with backward-compatible mapping for breakfast/lunch/dinner/snack.
- Photo analysis must return multiple editable components (food candidate, estimated grams/range, confidence, notes), not the current single aggregate with model-invented macros. Resolve each component against USDA/FNDDS or another licensed food source before saving totals.
- Subscription-backed OpenAI and Anthropic adapters can share a local Mac worker/provider interface. OpenAI Codex subscription auth supports trusted private automation, local image inputs, and JSON-schema output, but OpenAI still recommends API keys for normal automation. Anthropic technically supports subscription OAuth for scripts, but its current legal guidance says developers building products/services should use API authentication; keep any subscription adapter owner-only and experimental.
- Cronometer Basic provides free barcode scanning, curated CRDB entries, Nutritionix/USDA branded results, diary groups, and raw CSV export, but no normal live consumer API. Therefore Cronometer capture can initially sync through idempotent CSV import, not real-time OAuth.
- Free barcode alternatives: MyNetDiary advertises more than 2 million staff-verified foods and free scanning, but its commercial API is expensive and unsuitable for this integration. fatsecret advertises 2.3 million human-verified foods, free scanning, and an official developer API; eligible startups can apply for free Premier access including barcode lookup, with attribution. For hyPer-native scanning, fatsecret Premier Free primary plus USDA fallback is a stronger integration path than routing every scan through Cronometer.
- Recommended implementation sequence in isolated staging: (1) dynamic meal/snack containers + inbox, (2) Cronometer CSV importer/dedupe, (3) multi-item photo draft/review with OpenAI local worker first, (4) optional Anthropic local adapter, (5) native hyPer barcode scanner via fatsecret/USDA.

## Rev 7 — photo nutrition, barcode, and Cronometer research (read-only product decision)

- Photo logging already exists in both clones. `src/components/nutrition/FoodLogger.tsx` captures/compresses an image and calls the deployed `supabase/functions/process-food-photo`; the function currently uses Google Vertex/Gemini and directly estimates name, serving, calories, and macros. USDA text search is already implemented.
- Recommended accuracy change: use the vision model to identify meal components and estimate portions, then resolve nutrients from a canonical database and require user confirmation. Do not treat model-generated macro values as authoritative. Research consistently identifies food quantity/portion scale as the difficult part; database-grounded multimodal pipelines outperform relying only on model memory.
- Barcode scanning does not require Cronometer. Add an HTTPS camera scanner with a cross-browser decoder fallback, then query USDA FoodData Central by GTIN/UPC. Cronometer itself documents USDA and Nutritionix as barcode sources. Open Food Facts is a possible fallback, but its ODbL attribution/share-alike requirements need a deliberate licensing decision before mixing its data into hyPer's food database.
- Normal Cronometer accounts have CSV export, including timestamped food/recipe entries, but no public self-service user API was found. API access is described for Cronometer Pro Plus/partners. Android offers a better future bridge because Cronometer explicitly exports Food/Water to Health Connect; iOS HealthKit access requires a native iOS target and Cronometer's public documentation does not clearly promise nutrition export.
- Subscription-funded model execution is feasible for a private single-user prototype, not the correct basis for a public hosted product:
  - Anthropic is the clearest supported personal automation route: Claude subscriptions can authenticate `claude -p`/Agent SDK with OAuth, including a long-lived inference token and a separate Agent SDK credit allowance. Anthropic explicitly prohibits third-party products from routing users through consumer subscription credentials.
  - OpenAI Codex supports ChatGPT subscription auth, structured output, and image inputs through its local SDK. Official guidance frames this as local/coding-focused trusted automation and says API-key auth is the normal automation/product path; consumer terms also restrict programmatic extraction.
  - Kimi membership provides a subscription-scoped, OpenAI/Anthropic-compatible Kimi Code API key with image support, but Kimi explicitly directs product integration and multimodal applications to its separate pay-as-you-go Platform.
- Best private-beta architecture: phone uploads a short-lived photo job to staging; a trusted Mac worker authenticated to the owner's subscription processes it; structured candidates return to hyPer for database grounding and confirmation. This requires the Mac to be online and inherits subscription quotas, latency, auth, and policy limits. For multiple users or reliable production, use a normal provider API/business plan or an open-weight model hosted under hyPer's control.

## Rev 6 — release-readiness audit (read-only; no live changes)

- `/Users/alex/Desktop/hyPer-current-ui` is the correct promotion source: branch `codex/activity-sessions-current-ui` is based on `origin/main` at `0da91009`. Feature safety checkpoint: `330994ff feat(activity): add multi-source activity hub and GPS tracking`.
- `/Users/alex/Desktop/hyPer` is a stale, separate clone on `codex/activity-sessions-mvp`, based on older commit `f0f3ebba`, with overlapping uncommitted Phase 1 activity edits. Do not merge or copy that work back into the current branch.
- Fresh validation on 2026-07-16: `npm run test` PASS (25 files, 303 tests), `npm run lint` PASS, `npm run build` PASS. Existing warnings only: bundle >500 kB and stale Browserslist data.
- Preview smoke check: `/preview` loads; Settings shows WHOOP and Strava rows; WHOOP preview Connect changes status to `Connected • never synced` and exposes Sync/Disconnect. The existing handoff remains the evidence for the fuller fixture lifecycle.
- Linked Supabase project `nnwfaaxmyvqsdnfcdxom`: the four activity/WHOOP/Strava migrations are still pending; only `process-food-photo` is deployed. No WHOOP, Strava, or `APP_BASE_URL` secrets are configured. No production mutation was performed.
- Remote schema lint reports two pre-existing warnings in `public.save_split_snapshot` (text to `uuid[]` assignment); unrelated to this branch.
- No CI workflow, hosting config, or staging environment is declared in the repository. Supabase Branching or a separate staging project is the safest place for real OAuth E2E before production.
- Tailscale is stopped and has no serve config. Phone GPS testing needs Tailscale started, the IPv4 Vite server, and HTTPS serve restored.
- Cronometer/Cronometer import is not implemented in either clone. Current public material does not expose a normal self-service user-data API comparable to WHOOP/Strava; treat this as a separate discovery/import project, likely beginning with supported export formats or a partner-access request.
- Current Strava disconnect uses the legacy `/oauth/deauthorize` endpoint. It remains supported during the transition, but Strava now recommends `/oauth/revoke`; update/test this before broad release.

## Rev 5 — stationary GPS drift fix + pause/resume (sandbox-verified; 303 tests PASS, lint PASS, build PASS)

User field-tested the tracker and hit "distance increases without moving" + wanted pause buttons. Root cause: a flat 2 m jitter floor let standing GPS drift (±several m) accumulate. Fix + pause both in `runTracker.ts` (pure), exposed via hook + UI.

- **Drift fix** (`advanceTracker`): new config `stationarySpeedMps=0.6` and `driftAccuracyFactor=0.75`. When the device reports speed (`coords.speed`, Doppler-based, reliable on iOS/Android) below the stationary threshold → re-anchor, bank NO distance (kills standing drift). When speed is absent → jitter floor becomes `max(minStepM, accuracy*0.75)` so a step must clear the fix's own uncertainty. Real movement with reported speed uses the normal 2 m floor. Also fixed: after re-anchor (`lastPoint=null`, from pause or resume), the first sample now becomes the anchor instead of the `if(!prev) return` dead-ending.
- **Pause/resume**: state adds `pausedAtMs`, `totalPausedMs`, `lapPausedMs`; `Lap` gains `pausedMs` + `lapActiveSeconds(lap)`. `pauseTracker`/`resumeTracker`/`isPaused`. While paused, `advanceTracker` ignores samples (distance+clock freeze); `elapsedSeconds`/`currentLapSeconds`/`finishTracker` subtract paused time (saved `duration_seconds` = active/moving time); resume re-anchors so the gap (or being carried) never counts; manualSplit no-ops while paused. Crash-recovery `restoreTracker` closes an open paused span and defaults new fields (back-compat).
- Hook `useRunTracker`: `paused` + `togglePause()`. RunTracker page: Pause/Resume button beside Hold-to-finish in ALL modes; status shows "paused"; pace shows "—" paused; interval screen-tap-split disabled while paused; summary uses `lapActiveSeconds`.
- New sim scenario `stationaryDrift` ("Standing still (drift)") in gpsScenarios + preview source picker — reproduces the bug and proves the fix on-screen.
- Tests (+5, 21 total in runTracker): standing drift <5 m over 120 s; noisy-but-real movement still tracks; pause freezes dist+clock and resume excludes paused span; resume-after-carry banks no gap; split ignored while paused.
- Sandbox e2e (shipped module, in /preview): standing-still 120 s → **0 m**; real 5k → 5027 m; pause: 203 m/60 s frozen through 45 s pause, then 413 m/120 s after resume (45 s excluded). Live UI shows Pause↔Resume + "PAUSED".
- Answer to "is this feasible in a web app": YES — geolocation gives lat/lon/accuracy/speed; drift is a filtering problem every GPS app (incl. Strava) solves the same way. Thresholds remain exported constants for field tuning.

## Rev 4 — Strava importer + shared OAuth (sandbox-verified; 298 tests PASS, lint PASS, build PASS)

Full Strava integration mirroring WHOOP, plus the cross-source merge extended so a run recorded in-app OR imported from Strava carries WHOOP strain/HR/kcal as ONE event. NO live changes — still gated; remote has zero new migrations.

- Shared `supabase/functions/_shared/oauth.ts`: CORS, jsonResponse, HMAC-signed OAuth state. `whoop.ts` re-exports these (dedup); `strava-oauth`/`strava-sync` import them directly.
- Migration `20260711093000_add_strava_connections.sql`: `strava_connections` (owner-read metadata) + `strava_tokens` (zero policies + REVOKE, service-role only) — identical security model to WHOOP. Mirrored in schema.sql + supabase.ts Database type + `StravaConnection` in types.
- `config.toml`: `strava-oauth` verify_jwt=false (browser callback), `strava-sync` true.
- Edge Functions: `strava-oauth` (action=start → authorize URL scope `read,activity:read_all`; GET /callback → code exchange → service-role upsert tokens+connection → 302 `${APP_BASE_URL}/settings?strava=connected|error`; action=disconnect → deauthorize + delete). `strava-sync` (dumb proxy: load tokens, refresh if <5min — Strava ROTATES refresh tokens, persist new pair BEFORE fetch; GET /api/v3/athlete/activities per_page=50 with after/before epoch; 401→refresh+retry, 429→rate_limited; returns raw {records, nextPage}).
- Pure libs: `stravaImport.ts` (mapStravaSport, stravaLocalDateKey via utc_offset, normalizeStravaActivity → moving_time as duration, elapsed→ended_at, id→external_id; groupStravaSegments: per-activity, membership-first-else-create, carries Strava `name` as title, buildStravaPatch never overwrites HR that Strava didn't record so WHOOP-filled HR survives, no orphan deletion). `stravaSync.ts` (runStravaSync orchestrator; after creating a session, absorbs an overlapping auto WHOOP session via findAbsorbableWhoopSession — relink segments + fill-only metric copy + delete).
- `stravaClient.ts` prod transport; `stravaFixtures.ts` (batch1: long run 06:50 3d-ago [SAME window as WHOOP fixture wf-run-1] + ride; batch2 dup; batch3 fresh run ~30min-ago). Store: stravaConnection state + fetch/connect/disconnect/syncStrava (preview→fixtures, prod→edge fn).
- Settings: Strava row added under Connected services (WHOOP row + hairline + Strava row); `?strava=` return handling. History Sync button now runs BOTH providers (Strava first as hosts, then WHOOP enriches) — renamed `handleSyncSources`, gate `syncAvailable = preview || whoopConnection || stravaConnection`.
- Tests: stravaImport (11: sport map, tz date-key, normalize, per-activity create, no-op, HR-preserve update, user_edited skip), stravaSync (3: import+idempotence, WHOOP absorption into Strava run, non-overlap no-absorb).
- Sandbox e2e verified via store's own supabase client (NOT direct previewTables import — that reads a stale module instance in the embedded browser; always read back through `supabase.from()`): syncStrava + syncWhoop → the shared 06:50 long run is ONE session, `source:strava`, distance 8210m (Strava GPS), strain 12.5 / 158bpm / 621kcal (WHOOP), segSources ["strava","whoop"]. Both connectors render in Settings.
- Go-live for Strava (Gate B'): register Strava API app at strava.com/settings/api (Authorization Callback Domain = the Supabase functions host `nnwfaaxmyvqsdnfcdxom.supabase.co`), then `supabase secrets set STRAVA_CLIENT_ID STRAVA_CLIENT_SECRET STRAVA_STATE_SECRET=$(openssl rand -hex 32)` (+APP_BASE_URL already set for WHOOP), `supabase functions deploy strava-oauth strava-sync`.

## Rev 3 — cross-source merge (sandbox-verified; 284 tests PASS, lint PASS, build PASS)

User requirement: a run recorded in-app (or later via Strava) + the same run recorded by WHOOP must become ONE hyPer event carrying GPS pace/splits AND whoop strain/HR/kcal. NO live changes made — user explicitly re-gated: everything sandbox-first; the interrupted `supabase db push` never ran (remote still has zero new migrations; verified via `supabase migration list`).

- `whoopImport.ts`: `OVERLAP_MERGE_RATIO = 0.6` (share of the shorter window), `overlapRatioOfShorter`, `findEnrichmentHost` (best-overlap non-whoop session), `buildEnrichmentPatch` (strain/avg_hr/max_hr/energy_kcal ONLY — never type/times/GPS distance; user_edited hosts are fill-only), `findAbsorbableWhoopSession` (whoop auto, not user_edited). `groupSegments`: membership vote first; unmatched clusters try enrichment host before creating; membership pointing at a non-whoop session takes the enrichment branch (metrics-only) instead of the full whoop patch.
- `whoopSync.ts` port renamed `fetchSessionsInWindow` (ALL sources — hosts needed); store impl dropped the `source=whoop` filter.
- `appStore.saveTrackedRun`: after create+link, absorbs the best-overlap auto whoop session (relink its segments → copy metrics → delete it), so save-after-sync also converges to one event.
- History `ActivityLedgerRow`: splits table renders only `segment.source === activity.source` (foreign-source segments contribute metrics, not rows); chevron count uses the filtered list.
- Fixtures batch 5 (`wf-live-run`): whoop record spanning [now−40m, now−1m], strain 11.3 / 168 / 190 / 1850 kJ, no distance — overlaps any just-saved sandbox run.
- Tests: enrichment (create-suppression, metrics-only patch, idempotence, user_edited fill-only, sub-ratio → create), absorption finder, overlap math, FakeData e2e both syncs.
- Sandbox e2e verified BOTH directions via store calls in /preview: run-then-sync → `updated:1, created:0`, gps session gains strain/HR/kcal, keeps 5200m/1200s, whoop segment linked, 0 duplicates; sync-then-save → whoop auto session absorbed (deleted), segment relinked, metrics copied. Calendar shows "Run • GPS • 3.23 mi • 168 bpm • strain 11.3".
- Strava note: no Strava importer exists yet; when built, its sessions (source 'strava' with start/end) get the same enrichment for free.
- To demo on phone: save a tracked run in /preview, then press Sync 5× (batches clamp at 5); the 5th enriches the run.

## Rev 2 changes (validated: 277 tests PASS, lint PASS, build PASS)

- Pace now defaults to time per MILE everywhere (user request): `activityMetrics.ts` exports `MILE_M`, `paceSecondsPerMile`, `formatPace` → "7:32 /mi", `formatDistanceMi` (replaces km variants); `runTracker.ts` `rollingPaceSecPerMile`; History metrics/splits + RunTracker live/summary updated; sub-mile lap/segment distances stay in meters ("400 m"), aggregate distances in miles ("2.50 mi"). Verified in preview: seeded interval run shows "2.50 mi • 175 bpm", splits "7:03 /mi".
- Phone testing path (user has Tailscale installed, currently stopped): `tailscale serve --bg 5173` over the dev server gives an HTTPS ts.net URL — required because iOS Safari blocks geolocation + wake lock on insecure origins (plain LAN http URL cannot run the GPS tracker). Field-test via `/preview` → Run → "Real GPS" source (in-memory sandbox, real GPS, prod DB untouched).

## Current goal

Prepare the combined Activities Hub and unified nutrition workflow for isolated staging. Activities, WHOOP, Strava, GPS tracking, dynamic meal groups, Cronometer CSV import, and local subscription-backed photo review are code-complete and sandbox-verified. No new migration or OAuth/sync function has been applied/deployed remotely; staging E2E gates production changes.

## Verified state

- Worktree `/Users/alex/Desktop/hyPer-current-ui`, branch `codex/activity-sessions-current-ui`, base `origin/main` @ `0da91009` (unchanged upstream).
- Full plan: `/Users/alex/.claude/plans/compressed-forging-fog.md` (user-approved).
- **Current validation: `npm run test` 313/313 PASS, `npm run lint` PASS, `npm run build` PASS (2026-07-16).** Activity safety checkpoint exists at `330994ff`; nutrition/photo checkpoint exists at `5a78c734`. No new migration applied and no function deployed; the four activity/integration migrations plus the nutrition migration remain staging-only candidates.
- The detailed rev sections ABOVE (rev 5 drift+pause, rev 4 Strava, rev 3 merge, rev 2 miles) are the current source of truth; the per-phase notes BELOW are the original rev-1/2 record and predate those changes (e.g. they say km/277 tests and lack Strava — superseded).
- Phone testing: `npm run dev -- --host 127.0.0.1` (must bind IPv4 — the tunnel proxies IPv4; default is IPv6-only), then Tailscale serve exposes `https://alexanders-macbook-air.taileaf222.ts.net/`. HTTPS is required for iOS geolocation + wake lock. `vite.config.ts` `server.allowedHosts` allows the `.taileaf222.ts.net` domain (dev-only). Sandbox = `/preview` (fresh Safari tab; preview mode latches per-tab). Real GPS test: Run → Position source → "Real GPS".
- Sandbox note: the in-app browser pane throttles timers/animations (document reports hidden) — modal exits stick, 10× sim timing drifts; NOT app bugs. Read sandbox results back through the app's own `supabase` client (`supabase.from(...).select()`), NOT a direct `import('previewData')` — that reads a stale module instance.

### Phase 1 — segments data layer (verified in sandbox)
- `supabase/migrations/20260710090000_add_activity_segments.sql`: `activity_segments` (UNIQUE user_id+source+external_id, owner RLS) + `activity_sessions` aggregate columns (strain/avg_hr/max_hr/energy_kcal/distance_m) + flags (`auto_grouped`, `user_edited`, `dismissed_at` tombstone). Mirrored in `supabase/schema.sql` + `src/lib/supabase.ts` Database type.
- `src/preview/mockSupabase.ts` upgraded: mutations now PERSIST into previewTables; `upsert` honours `onConflict`; `.is()` treats undefined as null. This was a prerequisite — previously inserts/updates were dropped.
- `src/lib/activityMetrics.ts` (+tests): aggregateSegments (duration-weighted HR, strain=max documented approximation), formatPace/formatDistanceKm/formatClockDuration.
- History: activity rows show metrics line (km • bpm • strain) + expandable splits ledger (lazy segment fetch); chevron only when ≥2 segments; month fetch excludes dismissed.
- Verified: seeded 8-lap interval run renders metrics + 8 splits; added activity persists across month-nav re-fetch.

### Phase 2 — WHOOP grouping engine (verified in sandbox + 25 unit tests)
- `src/lib/whoopImport.ts`: normalize (kJ→kcal ×0.239006, tz-aware date key, PENDING_SCORE null metrics), clustering (running only, gap ≤ 360s, lap ≤ 900s), classification (≥2 reps: sprint if median ≤90s & ≥5 m/s else interval_run), membership-based reconciliation (majority vote via segment.session_id), user_edited/dismissed never patched or resurrected, orphan auto sessions deleted. Constants exported for tuning.
- `src/lib/whoopSync.ts`: port-injected orchestrator (paginate ≤10 pages → upsert segments → window re-read [since−7d, now] → apply plan).
- `src/preview/whoopFixtures.ts`: 4 sequential Sync batches (import / duplicates / late 9th lap / sprint day).
- Store `syncWhoop()` wires fixture transport in preview, Edge Function transport in prod. History gets quiet "Sync" action; delete of auto-grouped whoop session = soft dismiss; edit sets user_edited.
- BUG FOUND+FIXED via sandbox: segment upsert row must NOT include `session_id` (conflict update nulled links → sessions churned every re-sync). `upsertActivitySegments` omits it; linking owned by explicit updates only.
- Verified end-to-end in preview: batch1 "3 NEW" (8 laps→ONE interval_run 4.08km/173bpm + tennis + run), batch2 "UP TO DATE", batch3 "1 UPDATED" (9 splits, same session), batch4 sprint_session (6 reps), delete→re-sync stays gone (skippedUserEdited=1, verified via store call).

### Phase 3 — WHOOP OAuth (sandbox-verified UI; deploy gated)
- `supabase/migrations/20260710091000_add_whoop_connections.sql`: `whoop_connections` (owner SELECT only) + `whoop_tokens` (RLS zero policies + REVOKE ALL — client can never read tokens; not in client Database type).
- `supabase/config.toml` (new): `whoop-oauth` verify_jwt=false (callback is a browser redirect; auth in-code), whoop-sync/process-food-photo true.
- `supabase/functions/whoop-oauth/index.ts`: action=start (JWT → authorizeUrl w/ HMAC-signed state, 10-min expiry), GET /callback (verify state → code exchange → service-role upsert tokens+connection → 302 `${APP_BASE_URL}/settings?whoop=connected|error`), action=disconnect (best-effort revoke + delete). `_shared/whoop.ts` holds CORS/state/token helpers.
- `supabase/functions/whoop-sync/index.ts`: dumb proxy — loads tokens (service role), refreshes if <5min left (WHOOP ROTATES refresh tokens; new pair persisted BEFORE fetch), GET `/developer/v2/activity/workout?limit=25`, 401→refresh+retry once, 429→rate_limited, returns raw `{records, nextToken}`, stamps last_synced_at on final page. Endpoints/fields re-verified against developer.whoop.com 2026-07-11.
- `src/lib/whoopClient.ts` transport; Settings "Connected services 05" group (status line, Connect/Sync now/Disconnect, handles ?whoop= return); Session renumbered 06. History Sync gated on preview OR connection.
- Verified in preview: Connect→"Connected • never synced", Sync now→"Synced — 3 new, 0 updated.", Disconnect→"Not connected".

### Phases 4+5 — GPS run tracker (verified in sandbox + 16 unit tests)
- `src/lib/runTracker.ts`: pure wall-clock reducer. Accuracy gate ≤30m, 3-fix warm-up, teleport filter (>12.5 m/s, re-anchor after 3), 2m jitter floor that still accrues slow progress, 60s rolling pace clipped to current lap, auto-splits with interpolated crossing times, manual split w/ 700ms debounce, sprint hysteresis (≥5.0 m/s held 2s → rep; ≤3.0 m/s held 3s → end; discard <30m/<4s), stable runId for idempotent saves, localStorage snapshots (12h resume window). `finishedRunToActivity` → session(source gps) + per-lap/rep segments.
- `src/lib/gpsScenarios.ts`: deterministic scripts (steady 5k, 8×400, 6×sprints) shared by tests AND preview simulator.
- `src/hooks/useRunTracker.ts`: injectable PositionSource (real watchPosition vs simulator with CONSISTENT compressed clock), 1s tick, wake lock w/ visibility reacquire, throttled snapshots, cue playback. Bugs found+fixed via sandbox: tick effect must depend on isRunning boolean not state; simulator clock bases must init at creation (else startedAt = Date.now()×10); discard must clear `resumable`.
- `src/lib/runTrackerCues.ts`: WebAudio double-blip lap / rising sprint-start / falling sprint-end + vibrate (no-op iOS).
- `src/pages/RunTracker.tsx` at `/train/run` (chromeless; BottomNav hides; entries: Train header "Run" links ×2, preview gallery 08). Pre-start: mode tabs, auto-split SelectSheet, preview-only source picker. Live: hero pace/time/distance, lap/sprint panels, whole-screen tap-split, hold-to-finish 800ms. Summary: totals + splits table → Save/Discard. Resume banner on interrupted runs.
- Store `saveTrackedRun`: create session → upsert segments (stable ids) → link.
- Verified in preview: free run pace exactly 4:46/km, saved run appears in History ("Run • 5m • GPS • 0.94 km"); intervals: manual tap split resets live pace to "—", auto split exactly 400m, summary table correct incl. open final lap; sprints: 2 reps detected hands-free (89m, 7.5 m/s peak); resume banner after reload.

## Known risks / notes
- iOS PWA: GPS only tracks screen-on foreground (wake lock keeps it on); thresholds need field tuning (constants exported).
- Strain aggregation = max (non-additive) — documented approximation.
- v1 has no manual merge/split UI for wrongly-grouped sessions (type/title editable; delete tombstones work).
- Preview sim at 10× shows "gps weak" flickers in the throttled embedded pane only.
- App hosting still unknown → WHOOP redirect designed via Edge Function callback + APP_BASE_URL secret (set at deploy time).
- Cronometer import deliberately future: reuse source/external_id/raw-jsonb patterns (comment in segments migration).

## Complete file inventory (rev 5 — everything in this change)

Project ref `nnwfaaxmyvqsdnfcdxom`. All project changes are included in the local safety checkpoint on branch `codex/activity-sessions-current-ui`.

New migrations (unapplied, additive only):
- `supabase/migrations/20260630120000_add_activity_sessions.sql`
- `supabase/migrations/20260710090000_add_activity_segments.sql`
- `supabase/migrations/20260710091000_add_whoop_connections.sql`
- `supabase/migrations/20260711093000_add_strava_connections.sql`

New Edge Functions (undeployed) + config:
- `supabase/config.toml` (verify_jwt flags)
- `supabase/functions/_shared/oauth.ts` (CORS, jsonResponse, HMAC signed state — shared)
- `supabase/functions/_shared/whoop.ts` (WHOOP endpoints + token exchange/refresh; re-exports _shared/oauth)
- `supabase/functions/whoop-oauth/index.ts`, `whoop-sync/index.ts`
- `supabase/functions/strava-oauth/index.ts`, `strava-sync/index.ts`

New client libs:
- `src/lib/activityMetrics.ts` — aggregate/format (miles, pace /mi, clock)
- `src/lib/activitySessions.ts` — session title/duration helpers
- `src/lib/whoopImport.ts` — normalize + group + cross-source enrich/absorb
- `src/lib/whoopSync.ts` — WHOOP sync orchestrator (injected ports)
- `src/lib/whoopClient.ts` — prod WHOOP transport (edge fn)
- `src/lib/stravaImport.ts` — normalize + per-activity group
- `src/lib/stravaSync.ts` — Strava sync orchestrator + WHOOP absorption
- `src/lib/stravaClient.ts` — prod Strava transport (edge fn)
- `src/lib/runTracker.ts` — pure GPS engine (drift gate, pause, laps, sprints, persistence)
- `src/lib/runTrackerCues.ts` — WebAudio + vibrate cues
- `src/lib/gpsScenarios.ts` — sim scripts (steady5k, 8×400, 6×sprints, stationaryDrift)
- `src/hooks/useRunTracker.ts` — React wiring (PositionSource port, wake lock, pause)
- `src/pages/RunTracker.tsx` — chromeless tracker at `/train/run`
- `src/preview/whoopFixtures.ts`, `src/preview/stravaFixtures.ts` — sandbox transports

New tests (all passing): `tests/activityMetrics.test.ts`, `activitySessions.test.ts`, `whoopImport.test.ts`, `whoopSync.test.ts`, `runTracker.test.ts`, `stravaImport.test.ts`, `stravaSync.test.ts`.

Modified files:
- `src/App.tsx` (route `/train/run`), `src/components/shared/BottomNav.tsx` (hide on `/train/run`)
- `src/lib/supabase.ts` (Database types: activity_sessions cols, activity_segments, whoop_connections, strava_connections)
- `src/types/index.ts` (ActivitySession/Segment/Input, WhoopConnection, StravaConnection, activity types/labels)
- `src/stores/appStore.ts` (activity CRUD, segments, syncWhoop/syncStrava, connect/disconnect both, saveTrackedRun)
- `src/pages/History.tsx` (calendar activities, splits ledger, Sync both providers, soft-dismiss/user_edited)
- `src/pages/Settings.tsx` (Connected services: WHOOP + Strava rows, ?whoop=/?strava= return)
- `src/pages/Workout.tsx` (Run entry links), `src/preview/Preview.tsx` (gallery 08 Run)
- `src/preview/mockSupabase.ts` (mutations persist + onConflict upsert), `src/preview/previewData.ts` (seeded segments, empty connection tables)
- `supabase/schema.sql` (mirror all new tables/cols), `vite.config.ts` (allowedHosts for tailnet)
- `.claude/launch.json` (dev server launch config — untracked)

## Sign-off gates (nothing done yet — all gated on user approval)

1. **GATE A** (after isolated-staging sign-off) — apply the 4 activity/integration migrations plus the nutrition migration to production project `nnwfaaxmyvqsdnfcdxom`. Additive only. Do not use production as the first migration target.
2. **GATE B — WHOOP go-live**: user registers WHOOP dev app (redirect URL exactly `https://nnwfaaxmyvqsdnfcdxom.supabase.co/functions/v1/whoop-oauth/callback`, scopes `read:workout offline`) → `supabase secrets set WHOOP_CLIENT_ID=… WHOOP_CLIENT_SECRET=… WHOOP_STATE_SECRET=$(openssl rand -hex 32) APP_BASE_URL=…` → `supabase functions deploy whoop-oauth whoop-sync` → phone E2E + verify `whoop_tokens` unreadable as `authenticated`.
3. **GATE B′ — Strava go-live**: user registers Strava API app at strava.com/settings/api (Authorization Callback Domain = `nnwfaaxmyvqsdnfcdxom.supabase.co`) → `supabase secrets set STRAVA_CLIENT_ID=… STRAVA_CLIENT_SECRET=… STRAVA_STATE_SECRET=$(openssl rand -hex 32)` (APP_BASE_URL shared with WHOOP) → `supabase functions deploy strava-oauth strava-sync` → phone E2E, verify `strava_tokens` locked.
4. **GATE C — iOS field test**: permission prompt from Start gesture, wake lock stowed, pace stability, sprint threshold reliability, interval tap-split, cue audibility, kill→resume, Low Power Mode degradation, standing-still banks no distance, pause freezes clock. Tune exported threshold constants from real traces.

## Next action

Create an isolated Supabase staging environment, apply the four activity/integration migrations plus `20260716120000_add_nutrition_groups_and_imports.sql`, deploy/configure the four OAuth/sync functions, run the local photo worker, then test signed-in Cronometer/photo/WHOOP/Strava flows before any production push.
