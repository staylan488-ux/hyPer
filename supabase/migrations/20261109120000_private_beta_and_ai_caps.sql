-- Private beta and a daily ceiling on AI spend.
--
-- 1. approved_users: the accounts allowed to use hyPer. Every app table gets a
--    RESTRICTIVE row-level-security policy, so a signed-out caller, or a
--    signed-in account without a row here, can read or write nothing, whatever
--    the table's other policies allow. save_split_snapshot (SECURITY DEFINER,
--    so it skips RLS) checks approval itself.
-- 2. beta_invites: the only email addresses allowed to CREATE an account. A
--    trigger on auth.users refuses every other sign-up (email, Google, Apple,
--    or a user added in the dashboard) and approves invited accounts.
-- 3. ai_usage_daily + claim_ai_request(): one counter across all accounts that
--    analyze-food-trial claims before every paid call, capped by the
--    FOOD_ANALYSIS_MAX_GLOBAL_DAILY_REQUESTS function secret.
--
-- Every account that exists when this runs is approved, so current users keep
-- working. Review the list afterwards (docs/private-beta.md):
--   select email, note, approved_at from public.approved_users order by approved_at;
--
-- Safe to run more than once. Changes no existing data.

-- ─── 1. Approved accounts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.approved_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  note TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only the SQL editor and the service role (Edge Functions) touch this table.
-- The app asks through my_beta_access() below.
ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approved_users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approved_users TO service_role;

-- Whether the caller (auth.uid()) is approved. Used by every app table's policy.
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.approved_users WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_approved_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved_user() TO anon, authenticated, service_role;

-- The app's question: which account is asking, and is it approved? Returning
-- the id lets the app ignore an answer given for a request that went out
-- without its sign-in (user_id null), so a signed-in approved person is never
-- shown the "not on the list" screen by mistake.
CREATE OR REPLACE FUNCTION public.my_beta_access()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'approved', EXISTS (SELECT 1 FROM public.approved_users WHERE user_id = auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.my_beta_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_beta_access() TO authenticated, service_role;

-- Keep existing accounts working.
INSERT INTO public.approved_users (user_id, email, note)
SELECT id, lower(email), 'existing account when private beta started'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ─── 2. Invite-only sign-up ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.beta_invites (
  email TEXT PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  note TEXT,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beta_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.beta_invites TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_beta_invite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.beta_invites
    WHERE email = lower(btrim(coalesce(NEW.email, '')))
  ) THEN
    -- Supabase Auth reports this to the app as "Database error saving new user".
    RAISE EXCEPTION 'hyPer is invite-only: this email is not invited'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_invited_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.approved_users (user_id, email, note)
  VALUES (NEW.id, lower(btrim(NEW.email)), 'joined from invite')
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.beta_invites
  SET used_at = now()
  WHERE email = lower(btrim(coalesce(NEW.email, ''))) AND used_at IS NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_beta_invite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_invited_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_beta_invite ON auth.users;
CREATE TRIGGER enforce_beta_invite
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_beta_invite();

DROP TRIGGER IF EXISTS approve_invited_user ON auth.users;
CREATE TRIGGER approve_invited_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.approve_invited_user();

-- ─── App data: approved accounts only ────────────────────────────────────
-- A RESTRICTIVE policy is ANDed with the table's existing policies, which stay
-- as they were. It applies to every client role (anon and authenticated); the
-- service role bypasses RLS as before. This is every table in schema.sql except
-- the service-only ones (approved_users, beta_invites, ai_usage_daily,
-- food_analysis_ledger). tests/sql/privateBeta.sql fails if a new public table
-- is missing from this list.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_segments', 'activity_sessions', 'body_weight_measurements',
    'exercise_rest_preferences', 'exercises', 'flex_day_templates', 'foods',
    'macro_targets', 'nutrition_groups', 'nutrition_import_batches',
    'nutrition_logs', 'nutrition_profiles', 'plan_schedules', 'profiles',
    'program_preferences', 'sets', 'split_days', 'split_exercises', 'splits',
    'volume_landmarks', 'whoop_connections', 'whoop_tokens',
    'workout_day_plans', 'workouts'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'private beta: table public.% does not exist here, skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Private beta: approved users only" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Private beta: approved users only" ON public.%I '
      'AS RESTRICTIVE FOR ALL TO PUBLIC '
      'USING ((SELECT public.is_approved_user())) '
      'WITH CHECK ((SELECT public.is_approved_user()))',
      t
    );
  END LOOP;
END
$$;

-- Shared foods (user_id NULL, such as a USDA food one person logged first)
-- were readable and insertable by any role, including signed-out callers.
-- Limit both to signed-in accounts; the policy above limits them to approved
-- ones. Approved accounts keep creating shared USDA rows as before.
DROP POLICY IF EXISTS "Users can view own foods" ON public.foods;
CREATE POLICY "Users can view own foods" ON public.foods
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "Users can insert own foods" ON public.foods;
CREATE POLICY "Users can insert own foods" ON public.foods
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- save_split_snapshot runs as its owner and so skips RLS: check approval in it.
-- Otherwise the definition from 20260221130000 (supersets) with the search_path
-- from 20260401151500, unchanged.
CREATE OR REPLACE FUNCTION public.save_split_snapshot(
  p_split_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_days_per_week INTEGER,
  p_days JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_day JSONB;
  v_exercise JSONB;
  v_day_id UUID;
  v_exercise_id UUID;
  v_kept_day_ids UUID[] := '{}';
  v_kept_exercise_ids UUID[] := '{}';
  v_day_kept_exercise_ids UUID[];
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT user_id INTO v_user_id
  FROM splits
  WHERE id = p_split_id;

  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE splits
  SET name = p_name,
      description = p_description,
      days_per_week = p_days_per_week
  WHERE id = p_split_id;

  FOR v_day IN SELECT * FROM jsonb_array_elements(p_days)
  LOOP
    v_day_kept_exercise_ids := '{}';

    IF v_day->>'id' IS NOT NULL AND (v_day->>'id')::UUID IN (
      SELECT id FROM split_days WHERE split_id = p_split_id
    ) THEN
      v_day_id := (v_day->>'id')::UUID;
      UPDATE split_days
      SET day_name = v_day->>'day_name',
          day_order = (v_day->>'day_order')::INTEGER
      WHERE id = v_day_id AND split_id = p_split_id;
    ELSE
      INSERT INTO split_days (split_id, day_name, day_order)
      VALUES (p_split_id, v_day->>'day_name', (v_day->>'day_order')::INTEGER)
      RETURNING id INTO v_day_id;
    END IF;

    v_kept_day_ids := array_append(v_kept_day_ids, v_day_id);

    FOR v_exercise IN SELECT * FROM jsonb_array_elements(v_day->'exercises')
    LOOP
      IF v_exercise->>'id' IS NOT NULL AND (v_exercise->>'id')::UUID IN (
        SELECT id FROM split_exercises WHERE split_day_id = v_day_id
      ) THEN
        v_exercise_id := (v_exercise->>'id')::UUID;
        UPDATE split_exercises
        SET exercise_id = (v_exercise->>'exercise_id')::UUID,
            target_sets = (v_exercise->>'target_sets')::INTEGER,
            target_reps_min = (v_exercise->>'target_reps_min')::INTEGER,
            target_reps_max = (v_exercise->>'target_reps_max')::INTEGER,
            exercise_order = (v_exercise->>'exercise_order')::INTEGER,
            notes = v_exercise->>'notes',
            superset_group_id = CASE
              WHEN COALESCE(v_exercise->>'superset_group_id', '') = '' THEN NULL
              ELSE (v_exercise->>'superset_group_id')::UUID
            END
        WHERE id = v_exercise_id;
      ELSE
        INSERT INTO split_exercises (
          split_day_id,
          exercise_id,
          target_sets,
          target_reps_min,
          target_reps_max,
          exercise_order,
          notes,
          superset_group_id
        )
        VALUES (
          v_day_id,
          (v_exercise->>'exercise_id')::UUID,
          (v_exercise->>'target_sets')::INTEGER,
          (v_exercise->>'target_reps_min')::INTEGER,
          (v_exercise->>'target_reps_max')::INTEGER,
          (v_exercise->>'exercise_order')::INTEGER,
          v_exercise->>'notes',
          CASE
            WHEN COALESCE(v_exercise->>'superset_group_id', '') = '' THEN NULL
            ELSE (v_exercise->>'superset_group_id')::UUID
          END
        )
        RETURNING id INTO v_exercise_id;
      END IF;

      v_kept_exercise_ids := array_append(v_kept_exercise_ids, v_exercise_id);
      v_day_kept_exercise_ids := array_append(v_day_kept_exercise_ids, v_exercise_id);
    END LOOP;

    DELETE FROM split_exercises
    WHERE split_day_id = v_day_id
      AND id != ALL(v_day_kept_exercise_ids);
  END LOOP;

  DELETE FROM split_days
  WHERE split_id = p_split_id
    AND id != ALL(v_kept_day_ids);
END;
$$;

-- ─── 3. One daily AI counter across all accounts ─────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  usage_date DATE NOT NULL,
  feature TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, feature)
);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_usage_daily TO service_role;

-- Counts one request unless the day's ceiling is already reached, atomically
-- (the row lock serializes concurrent claims). Never refunds: a counted
-- request may already have been billed.
CREATE OR REPLACE FUNCTION public.claim_ai_request(p_feature TEXT, p_usage_date DATE, p_max INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requests INTEGER;
BEGIN
  IF p_max IS NULL OR p_max < 1 OR p_feature IS NULL OR p_usage_date IS NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.ai_usage_daily AS u (usage_date, feature, requests)
  VALUES (p_usage_date, p_feature, 1)
  ON CONFLICT (usage_date, feature) DO UPDATE
    SET requests = u.requests + 1, updated_at = now()
    WHERE u.requests < p_max
  RETURNING u.requests INTO v_requests;

  RETURN v_requests IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_usage_count(p_feature TEXT, p_usage_date DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT requests FROM public.ai_usage_daily WHERE feature = p_feature AND usage_date = p_usage_date),
    0
  );
$$;

REVOKE ALL ON FUNCTION public.claim_ai_request(TEXT, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_usage_count(TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_request(TEXT, DATE, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage_count(TEXT, DATE) TO service_role;
