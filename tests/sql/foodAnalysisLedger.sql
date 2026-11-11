-- Run with psql -X -v ON_ERROR_STOP=1 on a disposable LOCAL database after
-- applying 20261108220000_add_food_analysis_ledger.sql. All fixtures roll back.
BEGIN;

-- With the private beta migration, a new account needs an invite (rolled back).
DO $$
BEGIN
  IF to_regclass('public.beta_invites') IS NULL THEN
    INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111');
  ELSE
    INSERT INTO public.beta_invites(email) VALUES ('ledger.fixture@example.invalid');
    EXECUTE 'INSERT INTO auth.users(id, email) VALUES (''11111111-1111-4111-8111-111111111111'', ''ledger.fixture@example.invalid'')';
  END IF;
END $$;

DO $$
DECLARE role_name TEXT;
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.food_analysis_ledger'::regclass), 'RLS must be enabled';
  ASSERT NOT EXISTS (SELECT FROM pg_policy WHERE polrelid = 'public.food_analysis_ledger'::regclass), 'No client policies';
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    ASSERT NOT has_table_privilege(role_name, 'public.food_analysis_ledger', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), 'Clients have no grants';
  END LOOP;
  ASSERT has_table_privilege('service_role', 'public.food_analysis_ledger', 'SELECT'), 'Service can read';
  ASSERT has_table_privilege('service_role', 'public.food_analysis_ledger', 'INSERT'), 'Service can insert';
  ASSERT NOT has_table_privilege('service_role', 'public.food_analysis_ledger', 'UPDATE,DELETE,TRUNCATE'), 'Service cannot overwrite or refund';
END $$;

SET LOCAL ROLE service_role;
INSERT INTO public.food_analysis_ledger(path, user_id, value)
SELECT 'food-v1/11111111-1111-4111-8111-111111111111/2026-11-08/' || kind || '/0.json',
       '11111111-1111-4111-8111-111111111111', '{"private":"meal"}'::jsonb
FROM unnest(ARRAY['claims', 'slots', 'results']) AS kind;

DO $$
BEGIN
  ASSERT (SELECT count(*) = 3 FROM public.food_analysis_ledger WHERE user_id = '11111111-1111-4111-8111-111111111111'), 'All ledger kinds stored';
  BEGIN
    INSERT INTO public.food_analysis_ledger VALUES ('food-v1/11111111-1111-4111-8111-111111111111/2026-11-08/slots/0.json', '11111111-1111-4111-8111-111111111111', '{}');
    RAISE EXCEPTION 'Duplicate slot accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.food_analysis_ledger VALUES ('food-v1/22222222-2222-4222-8222-222222222222/2026-11-08/results/0.json', '11111111-1111-4111-8111-111111111111', '{}');
    RAISE EXCEPTION 'Mismatched owner accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;

-- Even accidentally restoring client grants cannot bypass the policy barrier.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_analysis_ledger TO anon, authenticated;
DO $$
DECLARE role_name TEXT; affected INTEGER;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    ASSERT (SELECT count(*) = 0 FROM public.food_analysis_ledger), 'Clients cannot read private results';
    BEGIN
      INSERT INTO public.food_analysis_ledger VALUES ('food-v1/11111111-1111-4111-8111-111111111111/2026-11-08/results/1.json', '11111111-1111-4111-8111-111111111111', '{}');
      RAISE EXCEPTION 'Client write accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE public.food_analysis_ledger SET value = '{}';
    GET DIAGNOSTICS affected = ROW_COUNT;
    ASSERT affected = 0, 'Clients cannot overwrite quota/results';
    DELETE FROM public.food_analysis_ledger;
    GET DIAGNOSTICS affected = ROW_COUNT;
    ASSERT affected = 0, 'Clients cannot erase quota/results';
    RESET ROLE;
  END LOOP;
END $$;

DELETE FROM auth.users WHERE id = '11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE service_role;
DO $$
DECLARE kind TEXT;
BEGIN
  ASSERT (SELECT count(*) = 0 FROM public.food_analysis_ledger WHERE user_id = '11111111-1111-4111-8111-111111111111'), 'Deletion cascades every ledger kind';
  FOREACH kind IN ARRAY ARRAY['claims', 'slots', 'results'] LOOP
    BEGIN
      INSERT INTO public.food_analysis_ledger VALUES ('food-v1/11111111-1111-4111-8111-111111111111/2026-11-08/' || kind || '/1.json', '11111111-1111-4111-8111-111111111111', '{}');
      RAISE EXCEPTION 'Late write resurrected data';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
  END LOOP;
END $$;
RESET ROLE;
ROLLBACK;
