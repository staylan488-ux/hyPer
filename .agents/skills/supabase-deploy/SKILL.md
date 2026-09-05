---
name: supabase-deploy
description: Prepare or perform a requested hyPer Supabase function or migration deployment, or diagnose backend deployment configuration.
---

# hyPer Supabase deployment

Read the reference matching the task:

- [Functions and configuration](references/functions.md): edge-function changes,
  deployment targets, authentication settings, and worker configuration.
- [Migrations](references/migrations.md): inspect and apply an explicitly requested
  schema change without assuming every migration can be replayed.

Resolve the target project from the user's request, existing authorization, and
verified configuration. Do not infer production from the current contributor or
a sample command. Inspect and prepare changes before an external mutation;
deploy only when the requested scope covers it. Ask only if the necessary target
or authorization remains unresolved.
