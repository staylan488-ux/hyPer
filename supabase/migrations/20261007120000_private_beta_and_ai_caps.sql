-- Private beta + AI cost caps.
--
-- 1. approved_users: the accounts allowed to use hyPer. Every app table gets a
--    RESTRICTIVE row-level-security policy, so a signed-in account without a
--    row here can read or write nothing, regardless of the existing policies.
-- 2. beta_invites: the only email addresses allowed to CREATE an account. A
--    trigger on auth.users rejects any other sign-up (email, Google, Apple or
--    a dashboard-created user) and auto-approves invited accounts.
-- 3. ai_usage_daily + claim_ai_request(): a project-wide daily counter the
--    analyze-food-trial Edge Function uses to cap total paid AI requests.
--
-- Every account that already exists when this runs is approved, so current
-- users (the two developers) keep working. Review the list afterwards:
--   select user_id, email, approved_at from public.approved_users;
--
-- Invite a tester (before they sign up):
--   insert into public.beta_invites (email, note) values ('friend@example.com', 'tester');
-- Approve an account that already exists:
--   insert into public.approved_users (user_id, email, note)
--   select id, lower(email), 'tester' from auth.users where lower(email) = 'friend@example.com';
-- Remove access:
--   delete from public.approved_users where email = 'friend@example.com';
--
-- Idempotent: safe to run more than once.

-- ─── 1. Approved accounts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.approved_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  note TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.approved_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approved_users FROM anon, authenticated;
GRANT SELECT ON public.approved_users TO authenticated;

-- The app reads its own row to decide whether to show the private-beta screen.
-- Nobody can add, change or remove rows from the app; only the SQL editor /
-- service role can.
DROP POLICY IF EXISTS "Users can see their own approval" ON public.approved_users;
CREATE POLICY "Users can see their own approval" ON public.approved_users
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.approved_users WHERE user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_approved_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_approved_user() TO anon, authenticated, service_role;

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
REVOKE ALL ON public.beta_invites FROM anon, authenticated;

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
    RAISE EXCEPTION 'hyPer is in private beta: % is not invited', coalesce(NEW.email, 'this account')
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
  VALUES (NEW.id, lower(NEW.email), 'joined from invite')
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
-- RESTRICTIVE policies are ANDed with the existing per-user policies, which
-- stay unchanged. Tables that do not exist in a given project are skipped.

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
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "Private beta: approved users only" ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY "Private beta: approved users only" ON public.%I '
        'AS RESTRICTIVE FOR ALL TO anon, authenticated '
        'USING ((SELECT public.is_approved_user())) '
        'WITH CHECK ((SELECT public.is_approved_user()))',
        t
      );
    END IF;
  END LOOP;
END
$$;

-- ─── 3. Project-wide AI request counter ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  usage_date DATE NOT NULL,
  feature TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, feature)
);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_daily FROM anon, authenticated;

-- Atomically counts one request unless the day's cap is already reached.
-- Never refunds: a request that was counted may already have been billed.
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
