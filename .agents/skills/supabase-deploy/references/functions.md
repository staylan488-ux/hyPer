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
