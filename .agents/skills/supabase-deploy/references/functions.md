# Functions and configuration

Function sources live in [supabase/functions](../../../../supabase/functions/).
Inspect the relevant source and [config.toml](../../../../supabase/config.toml)
before deployment. `food-lookup` and `whoop-sync` validate the signed-in user;
an anon/publishable key alone does not substitute for user authentication.
`whoop-oauth` disables gateway JWT verification for the browser callback and
performs user/state validation in code. Preserve those distinct auth contracts.

For a requested deployment, verify the target project and deploy only the named
function. Use an explicit `--project-ref` resolved for that task, rather than
relying on a stale linked project. Check required secret names in the function
source and their presence on the target without printing values. Never assume
secrets configured on one project are available on another.

[src/lib/supabase.ts](../../../../src/lib/supabase.ts) requires the Supabase URL
and anon/publishable key in production build-time variables; `.env` is one input
mechanism. Dev `/preview` uses fixtures.

Photo analysis currently uses [photoAnalysis.ts](../../../../src/lib/photoAnalysis.ts)
and [the private worker](../../../../scripts/photo-food-worker.mjs), not the legacy
`process-food-photo` edge function. The worker URL comes from saved Settings or
`VITE_PHOTO_WORKER_URL`; dev also supports localhost. Production can launch without
a worker URL and request configuration when analysis is used. No particular host
or tailnet is a universal build prerequisite. Inspect the configured endpoint
and reachability when troubleshooting that feature.
