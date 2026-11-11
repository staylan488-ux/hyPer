# Functions and configuration

Function sources live in [supabase/functions](../../../../supabase/functions/).
Inspect the relevant source and [config.toml](../../../../supabase/config.toml)
before deployment. `food-lookup` and `whoop-sync` validate the signed-in user;
an anon/publishable key alone does not substitute for user authentication.
`whoop-oauth` disables gateway JWT verification for the browser callback and
performs user/state validation in code. `analyze-food-trial` and
`delete-account` also disable it and verify the bearer token themselves. Preserve those distinct auth contracts.

For a requested deployment, verify the target project and deploy only the named
function. Use an explicit `--project-ref` resolved for that task, rather than
relying on a stale linked project. Check required secret names in the function
source and their presence on the target without printing values. Never assume
secrets configured on one project are available on another.

Secret names each function reads (as of 2026-11-10; the source is the
authority, and `SUPABASE_*` values are provided by the platform):

| Function | Required | Optional |
|---|---|---|
| `whoop-oauth` | `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_STATE_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | |
| `whoop-sync` | `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | |
| `food-lookup` | `USDA_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (approval, lookup limits and the barcode cache) | `FATSECRET_ENABLED` (`1` turns the provider on), `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`, `FATSECRET_SCOPE` |
| `analyze-food-trial` | `GEMINI_API_KEY`, `TAVILY_API_KEY`, `FOOD_ANALYSIS_BUCKET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `FOOD_ANALYSIS_ALLOWED_ORIGINS` (browser origins; the app sends none), `FOOD_ANALYSIS_MAX_DAILY_REQUESTS` (ceiling over every account's own limit, default 40) |
| `delete-account` | `FOOD_ANALYSIS_BUCKET`, `FOOD_ANALYSIS_DATABASE_LEDGER_READY` (must be `true`; see [the ledger notes](../../../../docs/food-analysis-ledger.md)), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY` (Sign in with Apple revocation; see [sign-up and limits](../../../../docs/sign-up-and-limits.md)) |

The app's client ([native/src/platform/supabase.ts](../../../../native/src/platform/supabase.ts))
requires `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` unless
it runs in preview mode, which uses the in-memory sample backend in `src/preview`.
Release and phone builds fill them from the root `.env`'s `VITE_SUPABASE_*`
values ([scripts/ship.sh](../../../../scripts/ship.sh),
[build-phone.sh](../../../../native/scripts/build-phone.sh)).

Food AI defaults to the hosted `analyze-food-trial` edge function (Gemini). A
device set to the worker uses [photoAnalysis.ts](../../../../src/lib/photoAnalysis.ts)
and [the private worker](../../../../scripts/photo-food-worker.mjs) instead. The
worker URL comes from You → Food analysis → Mac worker, else `EXPO_PUBLIC_PHOTO_WORKER_URL`
at build time; a build can launch without one and asks for it when analysis is
used. No particular host or tailnet is a universal build prerequisite. Inspect
the configured endpoint and reachability when troubleshooting that feature.
