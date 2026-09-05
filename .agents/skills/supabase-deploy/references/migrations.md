# Migrations

[supabase/migrations](../../../../supabase/migrations/) contains migrations with
different replay characteristics. Some use unconditional `CREATE POLICY`, so
they are not all idempotent. Inspect the exact pending migration and target state;
do not replay the directory or assume an existing object can safely be replaced.

For an explicitly requested schema change, prepare the scoped migration and
verify its effects on the relevant queries, constraints, and row-level security.
Establish which migrations the target has already applied before choosing the
appropriate migration runner or reviewed SQL application method. Preserve that
deployment history when applying SQL outside the migration runner.

[prod-cutover-pr66.sql](../../../../scripts/prod-cutover-pr66.sql) is a historical
transaction-wrapped cutover for particular changes. It demonstrates some
re-runnable SQL patterns; it is not the current migration queue or a general
instruction to apply production SQL through the dashboard.

Apply only to the verified authorized target. If an application fails or its
result is uncertain, inspect the transaction and migration state before retrying.
Do not assume partial application or blindly rerun a non-idempotent migration.
