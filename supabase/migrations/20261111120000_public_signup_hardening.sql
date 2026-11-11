-- Public sign-up with brakes. Builds on 20261109120000_private_beta_and_ai_caps.sql
-- (apply that one first). Not applied anywhere yet; see docs/sign-up-and-limits.md.
--
-- 1. app_config: one row of server-side switches the SQL editor can change at
--    once, without a redeploy: sign-up open or invite-only, AI on or off, the
--    daily AI budget in dollars, each person's daily AI requests, food lookup
--    limits and the oldest app version allowed.
-- 2. Sign-up: open by default (every new account is approved on the way in),
--    invite-only as the emergency switch. blocked_emails keeps a removed person
--    from signing up again in either mode. Removing an approved_users row still
--    suspends an account.
-- 3. Exercises: a custom exercise belongs to whoever made it and only they see
--    it. Every existing row stays shared (the exercise list cleanup decides what
--    the shared list holds). Clients can no longer add to the shared list.
-- 4. Foods: a phone can no longer write a shared (ownerless) row. Existing shared
--    rows stay readable so old logs keep working.
-- 5. Nobody can point their own rows at someone else's private exercise or food,
--    which would also block that person's account deletion.
-- 6. AI: a daily dollar budget across everyone (reserve before each paid call,
--    settle to the recorded cost after), each person's daily request limit
--    (raisable per account), and an off-switch. Replaces the request counter
--    from 20261109120000 (ai_usage_daily), which was never deployed.
-- 7. Food lookups: a per-person limit, a shared limit for Open Food Facts calls
--    (they all leave from one address), and a short-lived barcode answer cache.
-- 8. Sign in with Apple: the refresh token, kept so account deletion can tell
--    Apple (delete-account revokes it).
-- 9. Size limits on free text, for new and changed rows only.
--
-- Safe to run more than once. Deletes no rows except the never-deployed AI
-- request counter.

-- ─── 1. Server-side switches ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  -- 'open': anyone with a confirmed email. 'invite_only': only beta_invites.
  signup_mode TEXT NOT NULL DEFAULT 'open' CHECK (signup_mode IN ('open', 'invite_only')),
  -- Off: every paid AI call is refused at once; replays of saved results still work.
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- All accounts together, per UTC day.
  ai_daily_budget_usd NUMERIC(8, 2) NOT NULL DEFAULT 5 CHECK (ai_daily_budget_usd >= 0 AND ai_daily_budget_usd <= 500),
  -- Each account per UTC day, unless approved_users.ai_daily_limit says otherwise.
  ai_daily_requests_per_user INTEGER NOT NULL DEFAULT 8 CHECK (ai_daily_requests_per_user BETWEEN 0 AND 40),
  -- Food search, details and barcode lookups, per account.
  lookups_per_minute INTEGER NOT NULL DEFAULT 30 CHECK (lookups_per_minute BETWEEN 1 AND 600),
  lookups_per_day INTEGER NOT NULL DEFAULT 600 CHECK (lookups_per_day BETWEEN 1 AND 100000),
  -- Open Food Facts allows 15 product lookups a minute per address, and every
  -- account's lookups leave from the same functions.
  open_food_facts_per_minute INTEGER NOT NULL DEFAULT 12 CHECK (open_food_facts_per_minute BETWEEN 1 AND 100),
  -- Builds older than this should ask to be updated (the app reads it; piece 3).
  min_app_version TEXT CHECK (min_app_version IS NULL OR min_app_version ~ '^[0-9]+(\.[0-9]+){0,2}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.app_config TO service_role;

-- What the app may know before and after sign-in. Nothing else in app_config is exposed.
CREATE OR REPLACE FUNCTION public.app_public_config()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'signup_mode', c.signup_mode,
    'ai_enabled', c.ai_enabled,
    'min_app_version', c.min_app_version
  )
  FROM public.app_config c
  WHERE c.id;
$$;

REVOKE ALL ON FUNCTION public.app_public_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_public_config() TO anon, authenticated, service_role;

-- ─── 2. Sign-up: open or invite-only ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.blocked_emails (
  email TEXT PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  note TEXT,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.blocked_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blocked_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_emails TO service_role;

-- Per-account extras on the approved list.
ALTER TABLE public.approved_users
  ADD COLUMN IF NOT EXISTS ai_daily_limit INTEGER CHECK (ai_daily_limit IS NULL OR ai_daily_limit BETWEEN 0 AND 40),
  -- WHOOP and the Mac food worker stay visible only to these accounts (the app
  -- reads it through my_beta_access; piece 3).
  ADD COLUMN IF NOT EXISTS early_access BOOLEAN NOT NULL DEFAULT FALSE;

-- The accounts that exist before public sign-up (the owner, Alex and their
-- testers) keep 24 AI requests a day and the early features.
UPDATE public.approved_users
SET ai_daily_limit = coalesce(ai_daily_limit, 24), early_access = TRUE
WHERE note = 'existing account when private beta started';

-- Same trigger name as before; it now follows app_config.signup_mode.
CREATE OR REPLACE FUNCTION public.enforce_beta_invite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := lower(btrim(coalesce(NEW.email, '')));
  v_mode TEXT;
BEGIN
  -- Supabase Auth reports any of these to the app as "Database error saving new user".
  IF v_email = '' THEN
    RAISE EXCEPTION 'hyPer sign-up needs an email address' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.blocked_emails WHERE email = v_email) THEN
    RAISE EXCEPTION 'hyPer sign-up is not available for this email' USING ERRCODE = 'P0001';
  END IF;
  -- A missing config row counts as invite-only: fail closed.
  SELECT signup_mode INTO v_mode FROM public.app_config WHERE id;
  IF coalesce(v_mode, 'invite_only') <> 'open'
     AND NOT EXISTS (SELECT 1 FROM public.beta_invites WHERE email = v_email) THEN
    RAISE EXCEPTION 'hyPer is invite-only: this email is not invited' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- Everyone who got past enforce_beta_invite is approved.
CREATE OR REPLACE FUNCTION public.approve_invited_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := lower(btrim(coalesce(NEW.email, '')));
  v_invited BOOLEAN;
BEGIN
  UPDATE public.beta_invites SET used_at = now()
  WHERE email = v_email AND used_at IS NULL;
  v_invited := EXISTS (SELECT 1 FROM public.beta_invites WHERE email = v_email);

  INSERT INTO public.approved_users (user_id, email, note)
  VALUES (NEW.id, v_email, CASE WHEN v_invited THEN 'joined from invite' ELSE 'open sign-up' END)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_beta_invite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_invited_user() FROM PUBLIC, anon, authenticated;

-- The app's question, now with the account's extras. Same shape as before plus
-- two fields, so app builds that read only user_id and approved keep working.
CREATE OR REPLACE FUNCTION public.my_beta_access()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'approved', a.user_id IS NOT NULL,
    'early_access', coalesce(a.early_access, FALSE),
    'ai_daily_limit', CASE WHEN a.user_id IS NULL THEN 0
                           ELSE coalesce(a.ai_daily_limit, (SELECT c.ai_daily_requests_per_user FROM public.app_config c WHERE c.id), 0) END
  )
  FROM (SELECT 1) AS one
  LEFT JOIN public.approved_users a ON a.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_beta_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_beta_access() TO authenticated, service_role;

-- ─── 3. Private custom exercises ─────────────────────────────────────────

-- NULL is a shared row. The default fills in the signed-in caller, so the app's
-- existing insert (which sends no owner) makes a private exercise.
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.exercises ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Names were unique across the one shared list. Now: unique among shared rows,
-- and unique within each person's own. A private name may repeat a shared one.
ALTER TABLE public.exercises DROP CONSTRAINT IF EXISTS exercises_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS exercises_shared_name_key ON public.exercises(name) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS exercises_owner_name_key ON public.exercises(user_id, name) WHERE user_id IS NOT NULL;

-- Deleting an account deletes its private exercises and foods and, through
-- other paths, the sets, plans and diary rows that point at them. Postgres does
-- not promise which of those cascades runs first, so check these references at
-- the end of the transaction instead of mid-cascade. Same rule, later check.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1 AND c.confdeltype = 'a'
      AND ((c.conrelid IN (to_regclass('public.sets'), to_regclass('public.split_exercises'))
            AND c.confrelid = 'public.exercises'::regclass AND a.attname = 'exercise_id')
        OR (c.conrelid = to_regclass('public.nutrition_logs')
            AND c.confrelid = 'public.foods'::regclass AND a.attname = 'food_id'))
  LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED', r.tbl, r.conname);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS "Authenticated users can view exercises" ON public.exercises;
DROP POLICY IF EXISTS "Authenticated users can insert exercises" ON public.exercises;
DROP POLICY IF EXISTS "Users can view shared and own exercises" ON public.exercises;
DROP POLICY IF EXISTS "Users can insert own exercises" ON public.exercises;
CREATE POLICY "Users can view shared and own exercises" ON public.exercises
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = (SELECT auth.uid()));
CREATE POLICY "Users can insert own exercises" ON public.exercises
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
-- No update or delete for clients, as before.

-- ─── 4. No shared foods from phones ──────────────────────────────────────

-- The app now sends its own id with a USDA food; older builds send none, and
-- the default makes their row theirs instead of shared.
ALTER TABLE public.foods ALTER COLUMN user_id SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "Users can insert own foods" ON public.foods;
CREATE POLICY "Users can insert own foods" ON public.foods
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
-- Unchanged from 20261109120000: read your own rows and the existing shared ones.
DROP POLICY IF EXISTS "Users can view own foods" ON public.foods;
CREATE POLICY "Users can view own foods" ON public.foods
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);
-- Shared rows have no owner, so the existing update/delete policies
-- (auth.uid() = user_id) already leave them alone.

-- ─── 5. Only your own private rows can be referenced ─────────────────────
-- A foreign key does not check row-level security, so without this anyone who
-- learned the id of someone else's private exercise or food could log against
-- it, and that person's account deletion would then fail on the reference.
-- Service-role writes (no auth.uid()) are not checked.

CREATE OR REPLACE FUNCTION public.guard_private_exercise_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.exercises e
    WHERE e.id = NEW.exercise_id AND e.user_id IS NOT NULL AND e.user_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'Exercise not found' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_private_food_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.foods f
    WHERE f.id = NEW.food_id AND f.user_id IS NOT NULL AND f.user_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'Food not found' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_private_exercise_reference() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_private_food_reference() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sets', 'split_exercises', 'exercise_rest_preferences'] LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS guard_private_exercise_reference ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER guard_private_exercise_reference BEFORE INSERT OR UPDATE OF exercise_id ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.guard_private_exercise_reference()', t);
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS guard_private_food_reference ON public.nutrition_logs;
CREATE TRIGGER guard_private_food_reference
  BEFORE INSERT OR UPDATE OF food_id ON public.nutrition_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_private_food_reference();

-- ─── 6. AI: per-person limit, daily dollar budget, off-switch ────────────

-- The request counter from 20261109120000 is replaced by the dollar budget.
-- It was never deployed, so it holds nothing worth keeping.
DROP FUNCTION IF EXISTS public.claim_ai_request(TEXT, DATE, INTEGER);
DROP FUNCTION IF EXISTS public.ai_usage_count(TEXT, DATE);
DROP TABLE IF EXISTS public.ai_usage_daily;

-- One row per UTC day: what has been reserved or spent, in millionths of a dollar.
CREATE TABLE IF NOT EXISTS public.ai_spend_daily (
  usage_date DATE PRIMARY KEY,
  committed_micros BIGINT NOT NULL DEFAULT 0 CHECK (committed_micros >= 0),
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per paid request. The reservation stands until the real cost is
-- known; a request that never settles (a crash, an unknown cost) stays charged
-- at its reservation. Kept when the account is deleted: the money was spent.
CREATE TABLE IF NOT EXISTS public.ai_spend_claims (
  claim_key TEXT PRIMARY KEY CHECK (char_length(claim_key) BETWEEN 1 AND 300),
  usage_date DATE NOT NULL REFERENCES public.ai_spend_daily(usage_date),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  feature TEXT NOT NULL CHECK (char_length(feature) BETWEEN 1 AND 40),
  reserved_micros BIGINT NOT NULL CHECK (reserved_micros > 0),
  cost_micros BIGINT CHECK (cost_micros IS NULL OR cost_micros >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_spend_claims_user_id_idx ON public.ai_spend_claims(user_id);
CREATE INDEX IF NOT EXISTS ai_spend_claims_usage_date_idx ON public.ai_spend_claims(usage_date);

ALTER TABLE public.ai_spend_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_spend_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_spend_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_spend_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_spend_daily, public.ai_spend_claims TO service_role;

-- Whether an account may use AI and how many requests a day it gets.
CREATE OR REPLACE FUNCTION public.ai_access(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'approved', a.user_id IS NOT NULL,
    'daily_limit', CASE WHEN a.user_id IS NULL THEN 0
                        ELSE coalesce(a.ai_daily_limit, c.ai_daily_requests_per_user, 0) END
  )
  FROM (SELECT 1) AS one
  LEFT JOIN public.approved_users a ON a.user_id = p_user_id
  LEFT JOIN public.app_config c ON c.id;
$$;

-- Today's switch and budget, for the up-front check and the app's status line.
CREATE OR REPLACE FUNCTION public.ai_budget_status(p_usage_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'enabled', coalesce(c.ai_enabled, FALSE),
    'budget_micros', coalesce((c.ai_daily_budget_usd * 1000000)::BIGINT, 0),
    'committed_micros', coalesce(d.committed_micros, 0)
  )
  FROM (SELECT 1) AS one
  LEFT JOIN public.app_config c ON c.id
  LEFT JOIN public.ai_spend_daily d ON d.usage_date = p_usage_date;
$$;

-- Reserves p_reserve_micros of the day's budget for one paid request, or
-- refuses. The day row's lock serializes concurrent claims, so the committed
-- total (settled costs plus open reservations) never passes the budget.
-- Returns 'claimed', 'exhausted', 'disabled' or 'duplicate'.
CREATE OR REPLACE FUNCTION public.claim_ai_spend(
  p_claim_key TEXT,
  p_user_id UUID,
  p_feature TEXT,
  p_usage_date DATE,
  p_reserve_micros BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_budget BIGINT;
  v_committed BIGINT;
BEGIN
  IF p_claim_key IS NULL OR p_feature IS NULL OR p_usage_date IS NULL
     OR p_reserve_micros IS NULL OR p_reserve_micros <= 0 THEN
    RETURN 'disabled';
  END IF;

  SELECT ai_enabled, (ai_daily_budget_usd * 1000000)::BIGINT INTO v_enabled, v_budget
  FROM public.app_config WHERE id;
  IF NOT coalesce(v_enabled, FALSE) THEN
    RETURN 'disabled';
  END IF;

  INSERT INTO public.ai_spend_daily (usage_date) VALUES (p_usage_date)
  ON CONFLICT (usage_date) DO NOTHING;
  SELECT committed_micros INTO v_committed
  FROM public.ai_spend_daily WHERE usage_date = p_usage_date
  FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.ai_spend_claims WHERE claim_key = p_claim_key) THEN
    RETURN 'duplicate';
  END IF;
  IF v_committed + p_reserve_micros > coalesce(v_budget, 0) THEN
    RETURN 'exhausted';
  END IF;

  INSERT INTO public.ai_spend_claims (claim_key, usage_date, user_id, feature, reserved_micros)
  VALUES (p_claim_key, p_usage_date, p_user_id, p_feature, p_reserve_micros);
  UPDATE public.ai_spend_daily
  SET committed_micros = committed_micros + p_reserve_micros,
      requests = requests + 1,
      updated_at = now()
  WHERE usage_date = p_usage_date;
  RETURN 'claimed';
END;
$$;

-- Replaces a reservation with the request's recorded cost, once. A cost above
-- the reservation is charged in full (the money is spent) and closes the day
-- sooner; ai_spend_claims shows any such request.
CREATE OR REPLACE FUNCTION public.settle_ai_spend(p_claim_key TEXT, p_cost_micros BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_date DATE;
  v_reserved BIGINT;
BEGIN
  IF p_claim_key IS NULL OR p_cost_micros IS NULL OR p_cost_micros < 0 THEN
    RETURN FALSE;
  END IF;
  -- Lock the day first, in the same order as claim_ai_spend.
  SELECT usage_date INTO v_date FROM public.ai_spend_claims WHERE claim_key = p_claim_key;
  IF v_date IS NULL THEN
    RETURN FALSE;
  END IF;
  PERFORM 1 FROM public.ai_spend_daily WHERE usage_date = v_date FOR UPDATE;

  UPDATE public.ai_spend_claims
  SET cost_micros = p_cost_micros, settled_at = now()
  WHERE claim_key = p_claim_key AND cost_micros IS NULL
  RETURNING reserved_micros INTO v_reserved;
  IF v_reserved IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.ai_spend_daily
  SET committed_micros = greatest(0, committed_micros - v_reserved + p_cost_micros),
      updated_at = now()
  WHERE usage_date = v_date;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_access(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_budget_status(DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_ai_spend(TEXT, UUID, TEXT, DATE, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_ai_spend(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_access(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_budget_status(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_ai_spend(TEXT, UUID, TEXT, DATE, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_spend(TEXT, BIGINT) TO service_role;

-- ─── 7. Food lookup limits and barcode cache ─────────────────────────────

-- Fixed-window counters. Rows older than two days are pruned as new ones arrive.
CREATE TABLE IF NOT EXISTS public.rate_limit_windows (
  bucket TEXT NOT NULL CHECK (char_length(bucket) BETWEEN 1 AND 200),
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_windows_window_start_idx ON public.rate_limit_windows(window_start);

ALTER TABLE public.rate_limit_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rate_limit_windows TO service_role;

-- Counts one hit in the current window unless it already holds p_max.
CREATE OR REPLACE FUNCTION public.claim_rate_limit(p_bucket TEXT, p_window_seconds INTEGER, p_max INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_hits INTEGER;
BEGIN
  IF p_bucket IS NULL OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_max IS NULL OR p_max < 1 THEN
    RETURN FALSE;
  END IF;
  v_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.rate_limit_windows AS w (bucket, window_start, hits)
  VALUES (p_bucket, v_start, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE
    SET hits = w.hits + 1
    WHERE w.hits < p_max
  RETURNING w.hits INTO v_hits;

  -- Occasional pruning keeps the table small without a scheduled job.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_windows WHERE window_start < now() - interval '2 days';
  END IF;

  RETURN v_hits IS NOT NULL;
END;
$$;

-- One food lookup by one account: both its per-minute and per-day limits.
CREATE OR REPLACE FUNCTION public.claim_food_lookup(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_minute INTEGER;
  v_day INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  SELECT lookups_per_minute, lookups_per_day INTO v_minute, v_day FROM public.app_config WHERE id;
  RETURN public.claim_rate_limit('lookup:' || p_user_id || ':minute', 60, coalesce(v_minute, 1))
     AND public.claim_rate_limit('lookup:' || p_user_id || ':day', 86400, coalesce(v_day, 1));
END;
$$;

-- One call to Open Food Facts from any account.
CREATE OR REPLACE FUNCTION public.claim_open_food_facts_call()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.claim_rate_limit(
    'provider:open_food_facts:minute', 60,
    coalesce((SELECT open_food_facts_per_minute FROM public.app_config WHERE id), 1)
  );
$$;

REVOKE ALL ON FUNCTION public.claim_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_food_lookup(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_open_food_facts_call() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_food_lookup(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_open_food_facts_call() TO service_role;

-- Barcode answers from the food data providers, kept briefly so a popular
-- product is fetched once rather than once per person. Not personal data.
CREATE TABLE IF NOT EXISTS public.food_lookup_cache (
  cache_key TEXT PRIMARY KEY CHECK (char_length(cache_key) BETWEEN 1 AND 200),
  payload JSONB NOT NULL CHECK (octet_length(payload::TEXT) <= 262144),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS food_lookup_cache_expires_at_idx ON public.food_lookup_cache(expires_at);

ALTER TABLE public.food_lookup_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.food_lookup_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_lookup_cache TO service_role;

-- ─── 8. Sign in with Apple: what deletion needs to tell Apple ────────────

CREATE TABLE IF NOT EXISTS public.apple_sign_in_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL CHECK (char_length(refresh_token) BETWEEN 1 AND 2000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.apple_sign_in_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apple_sign_in_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.apple_sign_in_tokens TO service_role;

-- The app hands over Apple's refresh token right after a Sign in with Apple
-- (Supabase passes it back once, as provider_refresh_token). Only an account
-- that really has an Apple sign-in can store one, and only for itself. Open to
-- accounts that are not approved too, so anyone can leave cleanly.
CREATE OR REPLACE FUNCTION public.save_apple_refresh_token(p_refresh_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token TEXT := btrim(coalesce(p_refresh_token, ''));
BEGIN
  IF auth.uid() IS NULL OR v_token = '' OR char_length(v_token) > 2000 THEN
    RETURN FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = auth.uid() AND provider = 'apple') THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.apple_sign_in_tokens (user_id, refresh_token)
  VALUES (auth.uid(), v_token)
  ON CONFLICT (user_id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, updated_at = now();
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_apple_refresh_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_apple_refresh_token(TEXT) TO authenticated;

-- ─── 9. Size limits on free text ─────────────────────────────────────────
-- NOT VALID: checked on every new or changed row, never on rows already there,
-- so nothing existing breaks. Limits are well above anything the app writes.

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('activity_sessions', 'title', 200), ('activity_sessions', 'notes', 4000),
      ('activity_segments', 'sport', 100), ('activity_segments', 'external_id', 200),
      ('body_weight_measurements', 'external_id', 200), ('body_weight_measurements', 'source_name', 200),
      ('body_weight_measurements', 'source_bundle', 200),
      ('exercises', 'name', 120), ('exercises', 'muscle_group', 60),
      ('exercises', 'muscle_group_secondary', 60), ('exercises', 'equipment', 80),
      ('flex_day_templates', 'label', 120),
      ('foods', 'name', 300), ('foods', 'serving_unit', 60), ('foods', 'description', 4000),
      ('foods', 'fdc_id', 40), ('foods', 'external_id', 200), ('foods', 'external_source', 40), ('foods', 'source', 40),
      ('nutrition_import_batches', 'file_name', 300), ('nutrition_import_batches', 'file_hash', 200),
      ('nutrition_logs', 'external_id', 200), ('nutrition_logs', 'meal_type', 40), ('nutrition_logs', 'source', 40),
      ('profiles', 'display_name', 100),
      ('split_days', 'day_name', 120), ('split_exercises', 'notes', 2000),
      ('splits', 'name', 120), ('splits', 'description', 2000),
      ('workout_day_plans', 'day_label', 120),
      ('workouts', 'notes', 4000)
    ) AS limits(tbl, col, max_chars)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col
    ) THEN
      RAISE NOTICE 'size limits: public.%.% does not exist here, skipped', c.tbl, c.col;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', c.tbl, c.tbl || '_' || c.col || '_size');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (char_length(%I) <= %s) NOT VALID',
      c.tbl, c.tbl || '_' || c.col || '_size', c.col, c.max_chars);
  END LOOP;

  FOR c IN
    SELECT * FROM (VALUES
      ('activity_segments', 'raw', 262144),
      ('flex_day_templates', 'items', 65536),
      ('workout_day_plans', 'items', 65536)
    ) AS limits(tbl, col, max_bytes)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col
    ) THEN
      RAISE NOTICE 'size limits: public.%.% does not exist here, skipped', c.tbl, c.col;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', c.tbl, c.tbl || '_' || c.col || '_size');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (octet_length(%I::TEXT) <= %s) NOT VALID',
      c.tbl, c.tbl || '_' || c.col || '_size', c.col, c.max_bytes);
  END LOOP;
END
$$;

-- ─── 10. Table grants ────────────────────────────────────────────────────
-- Supabase's defaults give anon and authenticated every privilege on every
-- public table, TRUNCATE included (TRUNCATE ignores row-level security). The
-- app reaches tables only through the API, which never truncates, so this is
-- defence in depth: no TRUNCATE, TRIGGER or REFERENCES for clients, and no
-- table access at all while signed out (the app reads nothing before sign-in;
-- app_public_config() is a function). Tables added later get the same.
-- The service-only tables above already have no client grants.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM anon, authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
