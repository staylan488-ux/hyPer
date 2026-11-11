# Sign-up and limits: who can use hyPer, and what it may spend

The server decides who can sign up and how much each account may use. The app
only shows the answer. Two migrations set it up, applied in this order:

- `supabase/migrations/20261109120000_private_beta_and_ai_caps.sql`: the
  approved list, and a restrictive row-level-security policy on every app table.
  It approves every account that exists when it runs.
- `supabase/migrations/20261111120000_public_signup_hardening.sql`: open
  sign-up with brakes. Private custom exercises, per-person foods, the daily AI
  budget, lookup limits, Sign in with Apple revocation and size limits.

Every switch below lives in one row, `public.app_config`, and takes effect on
the next request. No redeploy. Run the one-liners in Supabase dashboard → SQL
Editor. Emails are always **lower case**.

## How it works

- **Sign-up.** A trigger on `auth.users` checks every new account (email,
  Google, Apple, or one added in the dashboard). It refuses an account without
  an email and any email in `public.blocked_emails`. In `open` mode it lets
  everyone else in; in `invite_only` mode only emails in `public.beta_invites`.
  Everyone it lets in is added to `public.approved_users` on the way in.
- **Approval.** An account without a row in `approved_users` reads and writes
  nothing in any app table, and `analyze-food-trial`, `food-lookup`,
  `whoop-sync` and WHOOP connect refuse it (`supabase/functions/_shared/approval.ts`).
  Signing in and out, password reset, Delete account and WHOOP disconnect
  still work, so anyone can leave. Signed-out callers have no table access at all.
- **Own data only.** A custom exercise or a USDA food someone saves is theirs:
  nobody else sees it, and nobody can point their own sets, splits or food logs
  at it. Clients can no longer add to the shared exercise list or the shared
  foods. Shared rows that existed before stay shared.
- **AI.** Paid food analysis (meal analysis, serving interpretation and target
  suggestions) has three brakes:
  - a daily dollar budget across everyone (UTC day). Each paid call reserves
    its worst case before it starts (meal $0.40, serving $0.05, targets $0.10)
    and is settled to its recorded cost afterwards, so the day can only pass the
    budget by the amount one call costs over its reservation. A call with no
    recorded cost keeps its full reservation;
  - each account's daily number of requests;
  - an off-switch for everyone.

  Replays of a saved result and the usage check are free and never counted.
- **Food lookups.** Search, details and barcode lookups are limited per account
  per minute and per day. Open Food Facts calls share one per-minute limit
  (every account's calls leave from the same address), and barcode answers are
  cached for a day (a "not found" for an hour).
- **Sign in with Apple.** The app hands the server Apple's refresh token after
  sign-in (`apple_sign_in_tokens`, service-only). Delete account revokes it with
  Apple after deleting the account. That needs the Apple secrets below; without
  them the revoke is skipped and logged, and the deletion still succeeds.
- **Sizes.** Notes, names and other free text have length limits, and the
  larger JSON columns have byte limits. They apply to new and changed rows only.

## Switches

What's set now:

```sql
select * from public.app_config;
```

Sign-up:

```sql
update public.app_config set signup_mode = 'invite_only'; -- emergency: invited emails only
update public.app_config set signup_mode = 'open';        -- back to open
```

AI:

```sql
update public.app_config set ai_enabled = false;              -- off for everyone, at once
update public.app_config set ai_enabled = true;
update public.app_config set ai_daily_budget_usd = 5;         -- dollars a day, everyone together (0–500)
update public.app_config set ai_daily_requests_per_user = 8;  -- each account a day (0–40)
```

One account's own AI limit (0–40; `null` goes back to the default) and the
early features (WHOOP and the Mac food worker, once the app reads it):

```sql
update public.approved_users set ai_daily_limit = 24, early_access = true
where email = 'friend@example.com';
```

The accounts that existed before public sign-up get 24 and the early features
when the migration runs.

`FOOD_ANALYSIS_MAX_DAILY_REQUESTS` (Edge Functions → Secrets, default 40) is a
hard ceiling over every account's limit. It is optional.

Food lookups:

```sql
update public.app_config set lookups_per_minute = 30, lookups_per_day = 600, open_food_facts_per_minute = 12;
```

Oldest app version allowed (the app asks older builds to update once it reads
this; `null` allows all):

```sql
update public.app_config set min_app_version = '2.0.1';
```

## People

Invite someone (needed only in `invite_only` mode):

```sql
insert into public.beta_invites (email, note) values ('friend@example.com', 'tester');
```

Sign in with Apple's "Hide My Email" makes a relay address that won't match an
invite. Ask them to use email or Google, or invite the relay address.

Suspend an account (they see "Not on the list yet"), and keep the email from
signing up again in either mode:

```sql
delete from public.approved_users where email = 'friend@example.com';
insert into public.blocked_emails (email, note) values ('friend@example.com', 'why');
```

Approve an account that exists but isn't on the list:

```sql
insert into public.approved_users (user_id, email, note)
select id, lower(email), 'tester' from auth.users where lower(email) = 'friend@example.com';
```

Who has access:

```sql
select email, note, ai_daily_limit, early_access, approved_at from public.approved_users order by approved_at;
```

To remove someone completely, delete the user in Authentication → Users.

## Spend

Today's and recent days (micro-dollars: 1,000,000 is $1):

```sql
select usage_date, committed_micros / 1e6 as dollars, requests
from public.ai_spend_daily order by usage_date desc limit 7;
```

Calls still holding their full reservation (no recorded cost):

```sql
select feature, count(*), sum(reserved_micros) / 1e6 as dollars
from public.ai_spend_claims where cost_micros is null group by feature;
```

## Sign in with Apple secrets

Edge Functions → Secrets, used by `delete-account`:

- `APPLE_TEAM_ID`: the Apple developer Team ID.
- `APPLE_KEY_ID`: the ID of a Sign in with Apple key.
- `APPLE_PRIVATE_KEY`: that key's `.p8` contents (newlines may be written as `\n`).
- `APPLE_CLIENT_ID`: the first client ID in Supabase → Authentication →
  Providers → Apple. Apple's token belongs to that ID, so the revoke must use it.

## Checks on the hosted database, right after the migrations

The migrations cover the tables in `supabase/schema.sql`. The hosted database
also holds things the repo doesn't: a `coach` schema of views, the
`coach_reader` role and the `coach-data` function. The views are owned by
`postgres` (which bypasses row-level security), so they keep working. Ask
`coach-data` for one view after the cutover and confirm it still returns rows.
The queries below only read.

Any table the approval policy missed (expect no rows):

```sql
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and c.relname not in ('approved_users', 'beta_invites', 'food_analysis_ledger', 'app_config',
                        'blocked_emails', 'ai_spend_daily', 'ai_spend_claims', 'rate_limit_windows',
                        'food_lookup_cache', 'apple_sign_in_tokens')
  and not exists (select from pg_policy p where p.polrelid = c.oid
                  and p.polname = 'Private beta: approved users only');
```

Any table a signed-out caller can still touch, and any `TRUNCATE` grant left
to clients (expect no rows):

```sql
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and (grantee = 'anon'
  or (grantee = 'authenticated' and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')));
```

Functions that skip row-level security (expect only `handle_new_user`,
`save_split_snapshot` and the two migrations' own; anything else that reads or
writes app data needs its own approval check):

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef order by 1;
```

## Checks on a local database

On a disposable **local** Supabase database (for `auth.uid()` and its roles)
with both migrations applied:

```sh
psql -X -v ON_ERROR_STOP=1 <local database> -f tests/sql/privateBeta.sql
psql -X -v ON_ERROR_STOP=1 <local database> -f tests/sql/publicSignup.sql
HYPER_TEST_DATABASE_URL=<local database> python3 tests/sql/aiBudgetRace.py
```

`privateBeta.sql` covers invite-only mode and the approval gate.
`publicSignup.sql` covers open sign-up, a second account against the first,
signed-out callers, size limits, the Apple token and the AI and lookup limits.
`aiBudgetRace.py` races many real claims and settles against the budget. The
SQL files roll back their fixtures; the race restores the config and removes its
own. A new public table without the approval policy fails `privateBeta.sql`:
add it to the migration's list (and to `supabase/schema.sql`) when you add one.
