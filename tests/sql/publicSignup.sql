-- Public sign-up regression. Run with psql -X -v ON_ERROR_STOP=1 against a
-- disposable LOCAL Supabase database (it needs auth.uid(), auth.identities and
-- the Supabase roles) after applying 20261109120000_private_beta_and_ai_caps.sql
-- and 20261111120000_public_signup_hardening.sql. All fixtures roll back.
--
-- Two strangers (A and B) sign up in open mode. B must not see or change
-- anything of A's, must not add to any shared list, and a signed-out caller
-- gets nothing. Then the AI budget, lookup limits, Apple tokens and size limits.
BEGIN;

UPDATE public.app_config
SET signup_mode = 'open', ai_enabled = TRUE, ai_daily_budget_usd = 1.00,
    ai_daily_requests_per_user = 8, lookups_per_minute = 2, lookups_per_day = 3,
    open_food_facts_per_minute = 1;

-- ─── Grants: clients reach none of the new tables or service functions ───
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_config', 'blocked_emails', 'ai_spend_daily', 'ai_spend_claims',
                           'rate_limit_windows', 'food_lookup_cache', 'apple_sign_in_tokens'] LOOP
    ASSERT NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE'), 'Clients cannot touch ' || t;
    ASSERT NOT has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE'), 'Signed-out callers cannot touch ' || t;
  END LOOP;
  ASSERT to_regclass('public.ai_usage_daily') IS NULL, 'The request counter is replaced';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_ai_spend(text, uuid, text, date, bigint)', 'EXECUTE'), 'Clients cannot claim AI spend';
  ASSERT NOT has_function_privilege('authenticated', 'public.settle_ai_spend(text, bigint)', 'EXECUTE'), 'Clients cannot settle AI spend';
  ASSERT NOT has_function_privilege('authenticated', 'public.ai_access(uuid)', 'EXECUTE'), 'Clients cannot ask about other accounts';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_rate_limit(text, integer, integer)', 'EXECUTE'), 'Clients cannot spend rate limits';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_food_lookup(uuid)', 'EXECUTE'), 'Clients cannot spend lookups';
  ASSERT NOT has_function_privilege('anon', 'public.save_apple_refresh_token(text)', 'EXECUTE'), 'Signed-out callers cannot store Apple tokens';
  ASSERT has_function_privilege('anon', 'public.app_public_config()', 'EXECUTE'), 'The sign-up screen can read the public switches';
END $$;

-- ─── Sign-up ─────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'Stranger.A@Example.com'),
  ('b0000000-0000-4000-8000-00000000000b', 'stranger.b@example.com');
INSERT INTO public.blocked_emails (email, note) VALUES ('blocked.fixture@example.com', 'fixture');
DO $$
BEGIN
  ASSERT (SELECT note FROM public.approved_users WHERE user_id = 'a0000000-0000-4000-8000-00000000000a') = 'open sign-up', 'Open sign-up approves a stranger';
  ASSERT (SELECT email FROM public.approved_users WHERE user_id = 'a0000000-0000-4000-8000-00000000000a') = 'stranger.a@example.com', 'Email kept in lower case';
  ASSERT (SELECT ai_daily_limit IS NULL AND NOT early_access FROM public.approved_users WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'), 'A stranger gets the default AI limit and no early features';
  ASSERT (public.ai_access('a0000000-0000-4000-8000-00000000000a') = '{"approved": true, "daily_limit": 8}'::jsonb), 'Default limit from app_config';
  ASSERT (public.ai_access('c0000000-0000-4000-8000-00000000000c') = '{"approved": false, "daily_limit": 0}'::jsonb), 'Unknown account gets nothing';
  BEGIN
    INSERT INTO auth.users (id, email) VALUES ('d0000000-0000-4000-8000-00000000000d', 'Blocked.Fixture@example.com');
    RAISE EXCEPTION 'Blocked email signed up';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%not available%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES ('d0000000-0000-4000-8000-00000000000d', NULL);
    RAISE EXCEPTION 'Sign-up without an email accepted in open mode';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%needs an email%' THEN RAISE; END IF;
  END;
  -- The emergency switch closes the door at once.
  UPDATE public.app_config SET signup_mode = 'invite_only';
  BEGIN
    INSERT INTO auth.users (id, email) VALUES ('d0000000-0000-4000-8000-00000000000d', 'late.stranger@example.com');
    RAISE EXCEPTION 'Uninvited sign-up accepted in invite-only mode';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%invite-only%' THEN RAISE; END IF;
  END;
  -- A missing config row fails closed (invite-only).
  DELETE FROM public.app_config;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES ('d0000000-0000-4000-8000-00000000000d', 'late.stranger@example.com');
    RAISE EXCEPTION 'Sign-up accepted without a config row';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  INSERT INTO public.app_config (id, signup_mode, ai_daily_budget_usd, lookups_per_minute, lookups_per_day, open_food_facts_per_minute)
  VALUES (TRUE, 'open', 1.00, 2, 3, 1);
END $$;

-- Shared rows the strangers start with.
INSERT INTO public.foods (id, name, calories, protein, carbs, fat, source, fdc_id)
VALUES ('f0000000-0000-4000-8000-0000000000f0', 'Fixture legacy shared USDA', 100, 1, 2, 3, 'usda', '999999');

-- ─── A's account ─────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
DECLARE v_ex UUID; v_food UUID; v_workout UUID; v_split UUID; v_day UUID;
BEGIN
  ASSERT (public.my_beta_access() ->> 'approved')::boolean, 'A is approved';
  ASSERT (public.my_beta_access() ->> 'ai_daily_limit')::int = 8, 'A sees its AI limit';
  ASSERT NOT (public.my_beta_access() ->> 'early_access')::boolean, 'A has no early features';
  ASSERT (SELECT count(*) > 0 FROM public.exercises WHERE user_id IS NULL), 'A reads the shared exercise list';
  -- A custom exercise, sent the way the app sends it (no owner).
  INSERT INTO public.exercises (name, muscle_group) VALUES ('Fixture A secret move', 'chest') RETURNING id INTO v_ex;
  ASSERT (SELECT user_id FROM public.exercises WHERE id = v_ex) = 'a0000000-0000-4000-8000-00000000000a', 'Custom exercise is private to A';
  BEGIN
    INSERT INTO public.exercises (name, muscle_group) VALUES ('Fixture A secret move', 'chest');
    RAISE EXCEPTION 'Duplicate private name accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- A private exercise may share a shared row's name.
  INSERT INTO public.exercises (name, muscle_group) SELECT name, muscle_group FROM public.exercises WHERE user_id IS NULL ORDER BY name LIMIT 1;
  BEGIN
    INSERT INTO public.exercises (name, muscle_group, user_id) VALUES ('Fixture A shared junk', 'chest', NULL);
    RAISE EXCEPTION 'Client added to the shared exercise list';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- A USDA food, sent the way older app builds send it (no owner): A's own.
  INSERT INTO public.foods (name, calories, protein, carbs, fat, source, fdc_id)
  VALUES ('Fixture A USDA', 100, 1, 2, 3, 'usda', '123') RETURNING id INTO v_food;
  ASSERT (SELECT user_id FROM public.foods WHERE id = v_food) = 'a0000000-0000-4000-8000-00000000000a', 'USDA food is private to A';
  -- B will try these ids as an attacker who learned them somehow.
  PERFORM set_config('fixture.a_exercise', v_ex::TEXT, false);
  PERFORM set_config('fixture.a_food', v_food::TEXT, false);
  BEGIN
    INSERT INTO public.foods (name, calories, protein, carbs, fat, source, user_id) VALUES ('Fixture A shared food', 1, 0, 0, 0, 'usda', NULL);
    RAISE EXCEPTION 'Client wrote a shared food';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT count(*) = 1 FROM public.foods WHERE id = 'f0000000-0000-4000-8000-0000000000f0'), 'A still reads legacy shared foods';

  -- A's diary and training, all pointing at A's private rows.
  INSERT INTO public.nutrition_logs (user_id, food_id) VALUES (auth.uid(), v_food);
  INSERT INTO public.nutrition_logs (user_id, food_id) VALUES (auth.uid(), 'f0000000-0000-4000-8000-0000000000f0');
  INSERT INTO public.workouts (user_id, notes) VALUES (auth.uid(), 'A workout') RETURNING id INTO v_workout;
  INSERT INTO public.sets (workout_id, exercise_id, set_number, weight, reps) VALUES (v_workout, v_ex, 1, 100, 5);
  INSERT INTO public.splits (user_id, name) VALUES (auth.uid(), 'A split') RETURNING id INTO v_split;
  INSERT INTO public.split_days (split_id, day_name, day_order) VALUES (v_split, 'A day', 0) RETURNING id INTO v_day;
  INSERT INTO public.split_exercises (split_day_id, exercise_id, target_sets, target_reps_min, target_reps_max, exercise_order)
  VALUES (v_day, v_ex, 3, 5, 8, 0);
  INSERT INTO public.exercise_rest_preferences (user_id, exercise_id, rest_seconds) VALUES (auth.uid(), v_ex, 120);
  INSERT INTO public.macro_targets (user_id) VALUES (auth.uid());
  INSERT INTO public.profiles (id, display_name) VALUES (auth.uid(), 'A') ON CONFLICT (id) DO NOTHING;

  -- Size limits apply to new rows.
  BEGIN
    INSERT INTO public.workouts (user_id, notes) VALUES (auth.uid(), repeat('x', 4001));
    RAISE EXCEPTION 'Oversized workout note accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.exercises (name, muscle_group) VALUES (repeat('x', 121), 'chest');
    RAISE EXCEPTION 'Oversized exercise name accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

-- ─── B: sees and changes nothing of A's ──────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
DO $$
DECLARE
  t TEXT; col TEXT; n BIGINT;
  a CONSTANT UUID := 'a0000000-0000-4000-8000-00000000000a';
  v_b_workout UUID; v_b_split UUID; v_b_day UUID;
BEGIN
  -- Every public table: no row of A's is visible, and none can be changed.
  FOR t, col IN
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND (c.column_name = 'user_id' OR (c.table_name = 'profiles' AND c.column_name = 'id'))
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', t, col) INTO n USING a;
    EXCEPTION WHEN insufficient_privilege THEN n := 0; -- service-only table
    END;
    ASSERT n = 0, format('B read %s of A''s rows in %s', n, t);
    BEGIN
      EXECUTE format('UPDATE public.%I SET %I = %I WHERE %I = $1', t, col, col, col) USING a;
      GET DIAGNOSTICS n = ROW_COUNT;
      ASSERT n = 0, format('B changed %s of A''s rows in %s', n, t);
      EXECUTE format('DELETE FROM public.%I WHERE %I = $1', t, col) USING a;
      GET DIAGNOSTICS n = ROW_COUNT;
      ASSERT n = 0, format('B deleted %s of A''s rows in %s', n, t);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  -- Tables owned through a parent.
  ASSERT (SELECT count(*) = 0 FROM public.sets), 'B reads none of A''s sets';
  ASSERT (SELECT count(*) = 0 FROM public.split_days), 'B reads none of A''s split days';
  ASSERT (SELECT count(*) = 0 FROM public.split_exercises), 'B reads none of A''s split exercises';
  ASSERT (SELECT count(*) = 0 FROM public.exercises WHERE name = 'Fixture A secret move'), 'B cannot see A''s custom exercise';
  ASSERT (SELECT count(*) = 0 FROM public.foods WHERE name = 'Fixture A USDA'), 'B cannot see A''s USDA food';
  ASSERT NOT (public.my_beta_access() ->> 'user_id') = a::TEXT, 'B is asked about B';

  -- B cannot add to any shared list.
  BEGIN
    INSERT INTO public.exercises (name, muscle_group, user_id) VALUES ('Fixture B junk', 'chest', NULL);
    RAISE EXCEPTION 'B added a shared exercise';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.exercises (name, muscle_group, user_id) VALUES ('Fixture B planted', 'chest', a);
    RAISE EXCEPTION 'B planted an exercise in A''s list';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.foods (name, calories, protein, carbs, fat, source, user_id) VALUES ('Fixture B fake', 1, 0, 0, 0, 'usda', NULL);
    RAISE EXCEPTION 'B planted a shared food';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.foods (name, calories, protein, carbs, fat, source, user_id) VALUES ('Fixture B fake', 1, 0, 0, 0, 'usda', a);
    RAISE EXCEPTION 'B planted a food in A''s list';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- B's own custom exercise with A's name is fine and separate.
  INSERT INTO public.exercises (name, muscle_group) VALUES ('Fixture A secret move', 'back');
  UPDATE public.foods SET calories = 9999 WHERE id = 'f0000000-0000-4000-8000-0000000000f0';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'B cannot change a legacy shared food';
  DELETE FROM public.exercises;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'Clients cannot delete exercises';

  -- B cannot point its own rows at A's private exercise or food, even knowing the ids.
  INSERT INTO public.workouts (user_id) VALUES (auth.uid()) RETURNING id INTO v_b_workout;
  BEGIN
    INSERT INTO public.sets (workout_id, exercise_id, set_number, weight, reps)
    VALUES (v_b_workout, current_setting('fixture.a_exercise')::UUID, 1, 1, 1);
    RAISE EXCEPTION 'B logged a set on A''s private exercise';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  INSERT INTO public.splits (user_id, name) VALUES (auth.uid(), 'B split') RETURNING id INTO v_b_split;
  INSERT INTO public.split_days (split_id, day_name, day_order) VALUES (v_b_split, 'B day', 0) RETURNING id INTO v_b_day;
  BEGIN
    INSERT INTO public.split_exercises (split_day_id, exercise_id, target_sets, target_reps_min, target_reps_max, exercise_order)
    VALUES (v_b_day, current_setting('fixture.a_exercise')::UUID, 3, 5, 8, 0);
    RAISE EXCEPTION 'B planned A''s private exercise';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.save_split_snapshot(v_b_split, 'B split', NULL, 3, jsonb_build_array(jsonb_build_object(
      'day_name', 'B day', 'day_order', 0, 'exercises', jsonb_build_array(jsonb_build_object(
        'exercise_id', current_setting('fixture.a_exercise'), 'target_sets', 3, 'target_reps_min', 5, 'target_reps_max', 8, 'exercise_order', 0)))));
    RAISE EXCEPTION 'B saved a program with A''s private exercise';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.exercise_rest_preferences (user_id, exercise_id, rest_seconds)
    VALUES (auth.uid(), current_setting('fixture.a_exercise')::UUID, 90);
    RAISE EXCEPTION 'B set rest on A''s private exercise';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.nutrition_logs (user_id, food_id) VALUES (auth.uid(), current_setting('fixture.a_food')::UUID);
    RAISE EXCEPTION 'B logged A''s private food';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  -- Shared rows can still be used by everyone.
  INSERT INTO public.nutrition_logs (user_id, food_id) VALUES (auth.uid(), 'f0000000-0000-4000-8000-0000000000f0');
  INSERT INTO public.sets (workout_id, exercise_id, set_number, weight, reps)
  SELECT v_b_workout, id, 1, 1, 1 FROM public.exercises WHERE user_id IS NULL ORDER BY name LIMIT 1;

  -- An Apple token can only be stored by an account with an Apple sign-in.
  ASSERT NOT public.save_apple_refresh_token('fixture-token'), 'B has no Apple sign-in';
END $$;
RESET ROLE;

-- ─── Signed out: nothing ─────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE t TEXT;
BEGIN
  -- No table at all while signed out, and no TRUNCATE for anyone.
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind = 'r' LOOP
    ASSERT NOT has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), 'Signed-out caller has a grant on ' || t;
    ASSERT NOT has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE,TRIGGER,REFERENCES'), 'Clients can truncate ' || t;
  END LOOP;
  ASSERT (public.app_public_config() ->> 'signup_mode') = 'open', 'Signed-out caller reads the sign-up mode';
  ASSERT NOT (public.app_public_config() ? 'ai_daily_budget_usd'), 'The budget stays private';
  BEGIN
    INSERT INTO public.exercises (name, muscle_group) VALUES ('Fixture anon junk', 'chest');
    RAISE EXCEPTION 'Signed-out exercise insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- ─── Apple token, then A deletes the account ────────────────────────────
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider)
VALUES ('fixture-apple-sub', 'a0000000-0000-4000-8000-00000000000a', '{"sub":"fixture-apple-sub","email":"stranger.a@example.com"}', 'apple');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
BEGIN
  ASSERT public.save_apple_refresh_token('fixture-token-1'), 'A stores its Apple token';
  ASSERT public.save_apple_refresh_token('fixture-token-2'), 'A replaces it on the next sign-in';
  ASSERT NOT public.save_apple_refresh_token(repeat('x', 2001)), 'Oversized token refused';
END $$;
RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT refresh_token FROM public.apple_sign_in_tokens WHERE user_id = 'a0000000-0000-4000-8000-00000000000a') = 'fixture-token-2', 'Latest token kept';
END $$;

-- AI spend by A survives the deletion (the money was spent).
SET LOCAL ROLE service_role;
SELECT public.claim_ai_spend('fixture-a-claim', 'a0000000-0000-4000-8000-00000000000a', 'food-analysis', '2001-01-01', 100000);
RESET ROLE;

-- Deleting A removes everything of A's, private exercises and foods included,
-- even though A's sets, programs, rest times and diary point at them.
DELETE FROM auth.users WHERE id = 'a0000000-0000-4000-8000-00000000000a';
-- The fixtures roll back, so run the end-of-transaction checks now.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT FROM public.exercises WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'), 'A''s exercises are gone';
  ASSERT NOT EXISTS (SELECT FROM public.foods WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'), 'A''s foods are gone';
  ASSERT NOT EXISTS (SELECT FROM public.apple_sign_in_tokens WHERE user_id = 'a0000000-0000-4000-8000-00000000000a'), 'A''s Apple token is gone';
  ASSERT EXISTS (SELECT FROM public.foods WHERE id = 'f0000000-0000-4000-8000-0000000000f0'), 'Shared food stays';
  ASSERT (SELECT user_id IS NULL FROM public.ai_spend_claims WHERE claim_key = 'fixture-a-claim'), 'Spend kept, owner cleared';
  ASSERT (SELECT committed_micros FROM public.ai_spend_daily WHERE usage_date = '2001-01-01') = 100000, 'Day total kept';
END $$;

-- ─── AI budget ($1.00 for these fixtures) ────────────────────────────────
SET LOCAL ROLE service_role;
DO $$
BEGIN
  ASSERT public.claim_ai_spend('k1', NULL, 'food-analysis', '2001-02-01', 400000) = 'claimed', 'First reservation';
  ASSERT public.claim_ai_spend('k1', NULL, 'food-analysis', '2001-02-01', 400000) = 'duplicate', 'Same key never charged twice';
  ASSERT public.claim_ai_spend('k2', NULL, 'food-analysis', '2001-02-01', 400000) = 'claimed', 'Second reservation';
  ASSERT public.claim_ai_spend('k3', NULL, 'food-analysis', '2001-02-01', 400000) = 'exhausted', 'A third would pass $1.00';
  ASSERT public.claim_ai_spend('k3', NULL, 'serving', '2001-02-01', 200000) = 'claimed', 'A smaller one still fits';
  ASSERT (public.ai_budget_status('2001-02-01') ->> 'committed_micros')::bigint = 1000000, 'Exactly at the budget';
  -- Settling to the real cost frees the rest of the reservation.
  ASSERT public.settle_ai_spend('k1', 50000), 'Settled';
  ASSERT NOT public.settle_ai_spend('k1', 10), 'Settles once';
  ASSERT NOT public.settle_ai_spend('missing', 10), 'Unknown key';
  ASSERT (public.ai_budget_status('2001-02-01') ->> 'committed_micros')::bigint = 650000, 'Reservation replaced by cost';
  ASSERT public.claim_ai_spend('k4', NULL, 'food-analysis', '2001-02-01', 300000) = 'claimed', 'Freed room is usable';
  ASSERT public.claim_ai_spend('k5', NULL, 'food-analysis', '2001-02-01', 100000) = 'exhausted', 'Not past the budget';
  -- A cost above its reservation is charged in full and closes the day.
  ASSERT public.settle_ai_spend('k2', 500000), 'Overrun settled';
  ASSERT (public.ai_budget_status('2001-02-01') ->> 'committed_micros')::bigint = 1050000, 'Overrun counted';
  ASSERT public.claim_ai_spend('k6', NULL, 'serving', '2001-02-01', 1) = 'exhausted', 'Nothing more today';
  ASSERT public.claim_ai_spend('k6', NULL, 'serving', '2001-02-02', 1) = 'claimed', 'A new UTC day starts over';
  -- The off-switch.
  UPDATE public.app_config SET ai_enabled = FALSE;
  ASSERT public.claim_ai_spend('k7', NULL, 'serving', '2001-02-03', 1) = 'disabled', 'Off means off';
  ASSERT NOT (public.ai_budget_status('2001-02-03') ->> 'enabled')::boolean, 'Status shows off';
  UPDATE public.app_config SET ai_enabled = TRUE, ai_daily_budget_usd = 0;
  ASSERT public.claim_ai_spend('k7', NULL, 'serving', '2001-02-03', 1) = 'exhausted', 'A zero budget allows nothing';
  ASSERT public.claim_ai_spend('k8', NULL, 'serving', '2001-02-03', 0) = 'disabled', 'A reservation must be positive';
END $$;
RESET ROLE;

-- ─── Food lookup limits (2 a minute, 3 a day for these fixtures) ─────────
SET LOCAL ROLE service_role;
DO $$
BEGIN
  ASSERT public.claim_food_lookup('b0000000-0000-4000-8000-00000000000b'), 'Lookup 1';
  ASSERT public.claim_food_lookup('b0000000-0000-4000-8000-00000000000b'), 'Lookup 2';
  ASSERT NOT public.claim_food_lookup('b0000000-0000-4000-8000-00000000000b'), 'Third in a minute refused';
  ASSERT public.claim_food_lookup('e0000000-0000-4000-8000-00000000000e'), 'Another account has its own limit';
  ASSERT NOT public.claim_food_lookup(NULL), 'No account, no lookup';
  ASSERT public.claim_open_food_facts_call(), 'One Open Food Facts call';
  ASSERT NOT public.claim_open_food_facts_call(), 'The shared Open Food Facts limit';
  ASSERT NOT public.claim_rate_limit('fixture', 60, 0), 'A limit below 1 refuses';
END $$;
RESET ROLE;

ROLLBACK;
