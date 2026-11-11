-- Private beta regression. Run with psql -X -v ON_ERROR_STOP=1 against a
-- disposable LOCAL Supabase database (it needs auth.uid() and the Supabase
-- roles) after applying 20261109120000_private_beta_and_ai_caps.sql and
-- 20261111120000_public_signup_hardening.sql. Covers invite-only mode and the
-- approval gate; tests/sql/publicSignup.sql covers open sign-up and the limits.
-- All fixtures roll back.
BEGIN;

-- The emergency switch: invite-only for this file.
UPDATE public.app_config SET signup_mode = 'invite_only';

-- Every public table is either service-only or carries the approval policy,
-- so a table added later without it fails here.
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND c.relname NOT IN ('approved_users', 'beta_invites', 'food_analysis_ledger', 'app_config', 'blocked_emails', 'ai_spend_daily', 'ai_spend_claims', 'rate_limit_windows', 'food_lookup_cache', 'apple_sign_in_tokens')
    AND NOT (c.relrowsecurity AND EXISTS (
      SELECT FROM pg_policy p
      WHERE p.polrelid = c.oid AND p.polname = 'Private beta: approved users only'
        AND NOT p.polpermissive AND p.polcmd = '*' AND p.polroles = '{0}'
    ));
  ASSERT missing IS NULL, 'Tables without the private beta policy: ' || missing;
  ASSERT NOT has_table_privilege('authenticated', 'public.approved_users', 'SELECT,INSERT,UPDATE,DELETE'), 'Clients cannot touch approved_users';
  ASSERT NOT has_table_privilege('anon', 'public.approved_users', 'SELECT,INSERT,UPDATE,DELETE'), 'Signed-out callers cannot touch approved_users';
  ASSERT NOT has_table_privilege('authenticated', 'public.beta_invites', 'SELECT,INSERT,UPDATE,DELETE'), 'Clients cannot touch beta_invites';
  ASSERT NOT has_function_privilege('anon', 'public.my_beta_access()', 'EXECUTE'), 'Signed-out callers do not get an approval answer';
END $$;

-- Sign-up: only invited emails, approved on the way in.
INSERT INTO public.beta_invites (email, note) VALUES ('invited.fixture@example.com', 'fixture');
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Invited.Fixture@Example.com');
DO $$
BEGIN
  ASSERT EXISTS (SELECT FROM public.approved_users WHERE user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'Invited sign-up is approved';
  ASSERT (SELECT used_at IS NOT NULL FROM public.beta_invites WHERE email = 'invited.fixture@example.com'), 'Invite marked used';
  BEGIN
    INSERT INTO auth.users (id, email) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stranger.fixture@example.com');
    RAISE EXCEPTION 'Uninvited sign-up accepted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', NULL);
    RAISE EXCEPTION 'Sign-up without an email accepted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END $$;

-- An unapproved account: an invited one removed from the list.
INSERT INTO public.beta_invites (email) VALUES ('removed.fixture@example.com');
INSERT INTO auth.users (id, email) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'removed.fixture@example.com');
DELETE FROM public.approved_users WHERE user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
INSERT INTO public.workouts (user_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
INSERT INTO public.splits (user_id, name) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Removed fixture split');
INSERT INTO public.foods (name, calories, protein, carbs, fat, source) VALUES ('Shared fixture food', 1, 0, 0, 0, 'usda');

-- Approved: works as before.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
DO $$
BEGIN
  ASSERT (SELECT (public.my_beta_access()->>'approved')::boolean), 'Approved account reads approved';
  ASSERT (SELECT count(*) = 1 FROM public.workouts), 'Approved account reads its workout';
  ASSERT (SELECT count(*) >= 1 FROM public.foods WHERE user_id IS NULL), 'Approved account reads shared foods';
  INSERT INTO public.exercises (name, muscle_group) VALUES ('Fixture approved move', 'chest');
  -- A USDA food is the account's own now (the default fills in the owner).
  INSERT INTO public.foods (name, calories, protein, carbs, fat, source) VALUES ('Fixture approved USDA', 1, 0, 0, 0, 'usda');
  ASSERT (SELECT user_id FROM public.foods WHERE name = 'Fixture approved USDA') = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'USDA food is owned';
  INSERT INTO public.workouts (user_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
END $$;

-- Unapproved: reads nothing, writes nothing, in every table.
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
DO $$
DECLARE t TEXT; n BIGINT;
BEGIN
  ASSERT NOT (SELECT (public.my_beta_access()->>'approved')::boolean), 'Removed account reads not approved';
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind = 'r'
             AND c.relname NOT IN ('approved_users', 'beta_invites', 'food_analysis_ledger', 'whoop_tokens', 'app_config', 'blocked_emails', 'ai_spend_daily', 'ai_spend_claims', 'rate_limit_windows', 'food_lookup_cache', 'apple_sign_in_tokens')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    ASSERT n = 0, format('Unapproved account read %s rows from %s', n, t);
  END LOOP;
  BEGIN
    INSERT INTO public.workouts (user_id) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    RAISE EXCEPTION 'Unapproved workout insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.exercises (name, muscle_group) VALUES ('Fixture junk move', 'chest');
    RAISE EXCEPTION 'Unapproved exercise insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.foods (name, calories, protein, carbs, fat) VALUES ('Fixture ownerless junk', 1, 0, 0, 0);
    RAISE EXCEPTION 'Unapproved ownerless food insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.save_split_snapshot((SELECT id FROM public.splits WHERE name = 'Removed fixture split'), 'Hacked', NULL, 3, '[]'::jsonb);
    RAISE EXCEPTION 'Unapproved split save accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Not authorized' THEN RAISE; END IF;
  END;
  UPDATE public.workouts SET notes = 'hacked';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'Unapproved account cannot edit workouts';
  DELETE FROM public.workouts;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'Unapproved account cannot delete workouts';
END $$;

-- Signed out: reads nothing, writes nothing (20261111120000 also takes away
-- every table grant from anon, so each attempt is refused outright).
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE n BIGINT;
BEGIN
  BEGIN
    PERFORM count(*) FROM public.foods;
    RAISE EXCEPTION 'Signed-out caller read foods';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.exercises;
    RAISE EXCEPTION 'Signed-out caller read exercises';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.foods (name, calories, protein, carbs, fat) VALUES ('Fixture anon junk', 1, 0, 0, 0);
    RAISE EXCEPTION 'Signed-out ownerless food insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.exercises (name, muscle_group) VALUES ('Fixture anon move', 'chest');
    RAISE EXCEPTION 'Signed-out exercise insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

ROLLBACK;
