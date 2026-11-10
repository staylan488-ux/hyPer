# Security policy

hyPer holds people's training, nutrition and body-weight records, so reports
about anything that could expose or change someone's data are welcome.

## Supported versions

Only the newest hyPer 2.0 build on TestFlight and the current `main` branch
get security fixes. Older builds are replaced, not patched.

## Reporting a vulnerability

Please report privately, not in a public issue or pull request:

1. Open the repository's **Security** tab and choose **Report a
   vulnerability**, or go straight to
   <https://github.com/staylan488-ux/hyPer/security/advisories/new>.
2. Say what you found, where it is (a file, screen, Edge Function or table),
   the steps to reproduce it and what someone could do with it.

You can expect a reply within seven days. If the report holds up, the fix
is worked out with you in the private advisory, and you are credited in it
when it is published unless you would rather not be.

## What is in scope

- The iPhone app in `native/` and the shared logic in `src/`.
- The Supabase schema, row-level security policies and Edge Functions in
  `supabase/`.
- The ship pipeline and workers in `scripts/` and `deploy/`.
- Secrets or personal data committed to this repository by mistake.

Faults in the services hyPer runs on (Supabase, Apple, Google Gemini, Tavily,
WHOOP, FatSecret) belong with those providers, unless the problem is how
hyPer uses them.

## Testing

Test with your own account, or with a development build, which starts in
preview mode on sample data and needs no account. Do not read, change or
delete other people's data, and do not run tests that slow the service down
for others.
