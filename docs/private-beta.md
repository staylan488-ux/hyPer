# Private beta: who can use hyPer

hyPer is invite-only. The server enforces this; hiding things in the app is
only for a friendly message.

- **`public.approved_users`**: accounts that may use the app. Every app table
  has a restrictive row-level-security policy, so an account without a row here
  can read or write nothing. The paid Edge Functions (`analyze-food-trial`,
  `food-lookup`, `whoop-sync`, and `whoop-oauth` connect) refuse it too.
- **`public.beta_invites`**: email addresses allowed to create an account. A
  trigger on `auth.users` rejects every other sign-up (email, Google, Apple or
  dashboard-created), and approves invited accounts automatically.
- **`public.ai_usage_daily`**: a project-wide daily counter. AI meal analysis
  stops for everyone once `FOOD_ANALYSIS_MAX_GLOBAL_DAILY_REQUESTS` (default 50)
  is reached for the UTC date. That's on top of the per-user
  `FOOD_ANALYSIS_MAX_DAILY_REQUESTS` (default 24).

Migration: `supabase/migrations/20261007120000_private_beta_and_ai_caps.sql`.
It approves every account that exists when it runs.

## Common tasks (Supabase dashboard → SQL Editor)

Invite a new tester. They can then sign up with that exact email, or with
Google using that email:

```sql
insert into public.beta_invites (email, note) values ('friend@example.com', 'tester');
```

Approve someone who already has an account:

```sql
insert into public.approved_users (user_id, email, note)
select id, lower(email), 'tester' from auth.users where lower(email) = 'friend@example.com';
```

See who has access:

```sql
select email, note, approved_at from public.approved_users order by approved_at;
```

Remove access:

```sql
delete from public.approved_users where email = 'friend@example.com';
```

Check today's AI usage across everyone:

```sql
select * from public.ai_usage_daily order by usage_date desc limit 7;
```

Notes:
- Invite emails must be lowercase. The table rejects anything else.
- Sign in with Apple's "Hide My Email" creates a private relay address that
  won't match an invite. Ask testers to use email or Google, or invite the
  relay address once you know it.
- Removed accounts can still disconnect WHOOP, but they can't use anything else.
