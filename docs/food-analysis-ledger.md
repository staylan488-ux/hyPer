# Food analysis ledger and account deletion

New `analyze-food-trial` records use `public.food_analysis_ledger`, not Storage.
The service-only table stores the existing path and JSON value for **all**
claims, quota slots and results. Its `auth.users` FK makes deletion atomic with
late inserts: a committed insert is cascaded; an insert after deletion fails.
The analysis pipeline, request hashes, daily limits and replay format are unchanged.
The app never receives service-role credentials or direct table access.

The old private bucket is a **read-only fallback**. Existing results still replay;
legacy claims/slots still prevent duplicate paid calls. Database or Storage errors
fail closed, with no automatic provider retry or fallback Storage write.

`delete-account` removes and verifies the legacy prefix **before** deleting auth.
A failed list, remove, or final empty-prefix check returns 503 while the account can
still retry. WHOOP revocation remains best-effort. New database rows are removed by
the auth cascade even when an analysis is still running. A crash before auth deletion
does not report success; a crash after it cannot strand already-cleared legacy data.

## Coordinated cutover (requires separate deployment authorization)

Do not deploy these functions independently and assume old executions have stopped.
The new deletion function defaults to unavailable until explicitly enabled.

1. Pause access to account deletion and food analysis on the authorized target
   (including old app clients). Keep deletion disabled throughout cutover.
2. Inspect migration history; apply only
   `supabase/migrations/20261108220000_add_food_analysis_ledger.sql`. It is a one-time
   migration, not a replay of `schema.sql` or the entire migrations directory.
3. Deploy `analyze-food-trial` with the database adapter. Keep `FOOD_ANALYSIS_BUCKET`
   pointing to the **same original private bucket**; don't create a replacement that
   hides the old records/quota. Do not dual-write or fall back to Storage uploads.
4. Establish that every old Storage-writing execution **and outstanding Storage
   operation** has settled using the target's operational controls/logs. A deploy,
   an empty listing, the client's ten-second timeout, or an Edge worker lifetime is
   not proof that an already-dispatched remote upload cannot still commit. If this
   cannot be established, keep deletion disabled and resolve the drain with the
   backend operator; do not certify cleanup complete on a guessed grace period.
5. Deploy `delete-account`. It requires the existing `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, the original `FOOD_ANALYSIS_BUCKET`, and
   `FOOD_ANALYSIS_DATABASE_LEDGER_READY=true`. Set the last flag **only after** the
   migration, new writer and old-write drain are verified. Missing bucket/flag fails
   closed; there is no "skip legacy cleanup" mode.
6. On a non-production target, verify replay/quota across the old/new ledger, delay
   an analysis across deletion, and force/retry a cleanup failure. Then re-enable
   access. Even a target without old analyses needs the configured empty private
   bucket for these checks.

Rollback: disable deletion first. Never restore Storage writers while the new
deletion path is enabled. Keep the database table/data and read compatibility;
dropping the table or blindly reverting the writer loses quotas and replay safety.

## Local checks

`npx vitest run tests/deleteAccount.test.ts tests/foodAccountDeletion.test.ts tests/foodDatabaseLedger.test.ts tests/foodTrialGateway.test.ts`

On a disposable **local** PostgreSQL/Supabase database with the migration applied:

```sh
psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -d hyper_ledger_test \
  -f tests/sql/foodAnalysisLedger.sql
python3 tests/sql/foodAnalysisLedgerRace.py
```

The SQL regression rolls back its fixtures and checks real FK cascades, late-write
rejection, ownership constraints, unique reservations, grants and deny-by-default
RLS. The Python check uses `psql` on PATH and two real transactions: insert first,
delete first, and deletion rollback. It observes the FK lock before releasing the
first transaction, then verifies the outcome and removes its unique fixtures.
A minimal PostgreSQL fixture needs `auth.users(id uuid primary key)` and the
`anon`, `authenticated`, and `service_role` roles (the latter with `BYPASSRLS`).
This does not substitute for testing hosted Storage/API behavior before rollout.
