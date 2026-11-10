# Private beta: who can use hyPer, and the daily AI ceiling

hyPer is invite-only. The server enforces it; the app's "Not on the list yet"
screen is only the friendly face of it.

- **`public.beta_invites`**: the emails allowed to create an account. A trigger
  on `auth.users` refuses every other sign-up (email, Google, Apple, or a user
  added in the dashboard) and approves invited accounts as they sign up.
- **`public.approved_users`**: the accounts that may use the app. Every app
  table has a restrictive row-level-security policy, so a signed-out caller or
  an account without a row here reads and writes nothing, the shared exercise
  library and shared foods included. `analyze-food-trial`, `food-lookup`,
  `whoop-sync` and WHOOP connect refuse it too
  (`supabase/functions/_shared/approval.ts`). Signing in, signing out,
  password reset, Delete account and WHOOP disconnect still work, so anyone
  can leave.
- **`public.ai_usage_daily`**: one counter for all accounts together. Paid food
  analysis (meal analysis, serving interpretation and target suggestions)
  stops for everyone once `FOOD_ANALYSIS_MAX_GLOBAL_DAILY_REQUESTS` is reached
  for the UTC day (default 50, allowed 1 to 1000). That is on top of each
  account's own `FOOD_ANALYSIS_MAX_DAILY_REQUESTS` (default 24). Replays of a
  saved result and the usage check are free and never counted.

Migration: `supabase/migrations/20261109120000_private_beta_and_ai_caps.sql`.
It approves every account that exists when it runs.

## Invite someone

Supabase dashboard → SQL Editor, with their email in **lower case**:

```sql
insert into public.beta_invites (email, note) values ('friend@example.com', 'tester');
```

They can then create an account in the app with that email, or with Google
on that email. TestFlight access is separate: invite them there too.

Sign in with Apple's "Hide My Email" makes a private relay address that won't
match. Ask them to use email or Google, or invite the relay address once you
know it.

## Set the daily ceiling

Supabase dashboard → Edge Functions → Secrets: add or change
`FOOD_ANALYSIS_MAX_GLOBAL_DAILY_REQUESTS` (a whole number from 1 to 1000).
It applies from the next request; no redeploy needed. A value outside 1–1000
turns food analysis off (it fails closed) rather than removing the ceiling.

Today's and recent use:

```sql
select * from public.ai_usage_daily order by usage_date desc limit 7;
```

## Other one-liners

Who has access:

```sql
select email, note, approved_at from public.approved_users order by approved_at;
```

Approve someone who already has an account:

```sql
insert into public.approved_users (user_id, email, note)
select id, lower(email), 'tester' from auth.users where lower(email) = 'friend@example.com';
```

Remove access (they see "Not on the list yet"; delete the invite too so they
can't sign up again after deleting their account):

```sql
delete from public.approved_users where email = 'friend@example.com';
delete from public.beta_invites where email = 'friend@example.com';
```

To remove someone completely, delete the user in Authentication → Users.

## Checks on a local database

```sh
psql -X -v ON_ERROR_STOP=1 <local database> -f tests/sql/privateBeta.sql
```

It needs a local Supabase database (for `auth.uid()` and its roles) with the
migration applied, and it rolls back its fixtures. It fails if a new public
table is added without the approval policy: add the table to the migration's
list (and to `supabase/schema.sql`) when you add one.
