// Retired 2026-07-21 (PR #66): this guard locked iOS builds to the Hyper-Dev
// staging Supabase while the big feature branch was developed against it.
// With the branch merging to main and the schema applied to production, iOS
// builds follow .env/.env.local like every other build. File kept as a no-op
// because history: delete freely once the merge has settled.
console.log('ios env guard retired — building against the configured Supabase project.')
