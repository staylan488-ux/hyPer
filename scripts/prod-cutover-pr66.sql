-- hyPer PR #66 production cutover: 6 additive migrations, made re-runnable.
-- Wrapped in one transaction: if anything fails, nothing is applied.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (PRODUCTION project).

BEGIN;

-- ===== 20260630120000_add_activity_sessions.sql =====
CREATE TABLE IF NOT EXISTS activity_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (
    activity_type IN (
      'bike_ride',
      'climbing',
      'swimming',
      'run',
      'interval_run',
      'sprint_session',
      'tennis',
      'pickleball',
      'squash',
      'golf',
      'other'
    )
  ),
  title TEXT,
  date DATE NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'whoop', 'strava', 'gps')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_activity_sessions_user_date
  ON activity_sessions(user_id, date);

CREATE INDEX IF NOT EXISTS idx_activity_sessions_user_started_at
  ON activity_sessions(user_id, started_at);

ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own activity sessions" ON activity_sessions;
CREATE POLICY "Users can view own activity sessions"
  ON activity_sessions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own activity sessions" ON activity_sessions;
CREATE POLICY "Users can insert own activity sessions"
  ON activity_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own activity sessions" ON activity_sessions;
CREATE POLICY "Users can update own activity sessions"
  ON activity_sessions
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own activity sessions" ON activity_sessions;
CREATE POLICY "Users can delete own activity sessions"
  ON activity_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- ===== 20260710090000_add_activity_segments.sql =====
-- Activity segments: raw imported/recorded child records of activity_sessions.
-- One row per WHOOP workout record or per GPS lap/sprint rep. The
-- (user_id, source, external_id) unique key makes re-imports idempotent —
-- the same pattern (source column + external_id + raw jsonb payload) is the
-- template for future importers (e.g. Cronometer nutrition CSV).

CREATE TABLE IF NOT EXISTS activity_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id UUID REFERENCES activity_sessions(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'whoop', 'strava', 'gps')),
  external_id TEXT NOT NULL,
  sport TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  strain NUMERIC,
  avg_hr SMALLINT,
  max_hr SMALLINT,
  energy_kcal NUMERIC,
  distance_m NUMERIC,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at >= started_at),
  UNIQUE (user_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_segments_user_started_at
  ON activity_segments(user_id, started_at);

CREATE INDEX IF NOT EXISTS idx_activity_segments_session
  ON activity_segments(session_id);

ALTER TABLE activity_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own activity segments" ON activity_segments;
CREATE POLICY "Users can view own activity segments"
  ON activity_segments
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own activity segments" ON activity_segments;
CREATE POLICY "Users can insert own activity segments"
  ON activity_segments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own activity segments" ON activity_segments;
CREATE POLICY "Users can update own activity segments"
  ON activity_segments
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own activity segments" ON activity_segments;
CREATE POLICY "Users can delete own activity segments"
  ON activity_segments
  FOR DELETE USING (auth.uid() = user_id);

-- Session-level aggregates (rolled up from segments for imported/tracked
-- sessions; null for plain manual entries) plus import bookkeeping flags:
--   auto_grouped  — session was created by the import grouping engine
--   user_edited   — user modified an auto-grouped session; re-sync must not clobber it
--   dismissed_at  — soft-delete tombstone so re-sync does not resurrect deletions
ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS strain NUMERIC,
  ADD COLUMN IF NOT EXISTS avg_hr SMALLINT,
  ADD COLUMN IF NOT EXISTS max_hr SMALLINT,
  ADD COLUMN IF NOT EXISTS energy_kcal NUMERIC,
  ADD COLUMN IF NOT EXISTS distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS auto_grouped BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_edited BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- ===== 20260710091000_add_whoop_connections.sql =====
-- WHOOP OAuth storage, split by sensitivity:
--   whoop_connections — safe metadata; the client may READ its own row to know
--                       "connected" status. Only the service role writes.
--   whoop_tokens      — OAuth tokens; RLS enabled with ZERO policies plus an
--                       explicit REVOKE so no client role can ever read them.
--                       Only Edge Functions using the service role touch them.

CREATE TABLE IF NOT EXISTS whoop_connections (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  whoop_user_id TEXT,
  scopes TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE whoop_connections ENABLE ROW LEVEL SECURITY;

-- read-only for the owner; no insert/update/delete policies on purpose
DROP POLICY IF EXISTS "Users can view own whoop connection" ON whoop_connections;
CREATE POLICY "Users can view own whoop connection"
  ON whoop_connections
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS whoop_tokens (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- zero policies: deny-by-default for anon/authenticated
ALTER TABLE whoop_tokens ENABLE ROW LEVEL SECURITY;

-- belt and braces on top of RLS
REVOKE ALL ON whoop_tokens FROM anon, authenticated;

-- ===== 20260716120000_add_nutrition_groups_and_imports.sql =====
-- Unified nutrition inbox: ordered meal/snack containers plus import provenance.
-- Additive only. Existing meal_type values remain readable for backward compatibility.

CREATE TABLE IF NOT EXISTS public.nutrition_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('meal', 'snack')),
  label TEXT CHECK (label IS NULL OR label IN ('breakfast', 'lunch', 'dinner')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_groups_user_date
  ON public.nutrition_groups(user_id, date, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_groups_named_label
  ON public.nutrition_groups(user_id, date, label)
  WHERE label IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.nutrition_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('cronometer')),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, file_hash)
);

ALTER TABLE public.foods
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_external_identity
  ON public.foods(user_id, external_source, external_id)
  WHERE user_id IS NOT NULL AND external_source IS NOT NULL AND external_id IS NOT NULL;

ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS group_id UUID,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES public.nutrition_import_batches(id) ON DELETE SET NULL;

-- Preserve the existing breakfast/lunch/dinner/snack organization on upgrade.
INSERT INTO public.nutrition_groups (user_id, date, kind, label, sort_order)
SELECT DISTINCT
  logs.user_id,
  logs.date,
  'meal',
  logs.meal_type,
  CASE logs.meal_type WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END
FROM public.nutrition_logs AS logs
WHERE logs.meal_type IN ('breakfast', 'lunch', 'dinner')
  AND NOT EXISTS (
    SELECT 1 FROM public.nutrition_groups AS groups
    WHERE groups.user_id = logs.user_id
      AND groups.date = logs.date
      AND groups.label = logs.meal_type
  );

INSERT INTO public.nutrition_groups (user_id, date, kind, label, sort_order)
SELECT DISTINCT logs.user_id, logs.date, 'snack', NULL, 3
FROM public.nutrition_logs AS logs
WHERE logs.meal_type = 'snack'
  AND NOT EXISTS (
    SELECT 1 FROM public.nutrition_groups AS groups
    WHERE groups.user_id = logs.user_id
      AND groups.date = logs.date
      AND groups.kind = 'snack'
      AND groups.label IS NULL
  );

UPDATE public.nutrition_logs AS logs
SET group_id = groups.id
FROM public.nutrition_groups AS groups
WHERE logs.group_id IS NULL
  AND groups.user_id = logs.user_id
  AND groups.date = logs.date
  AND (
    groups.label = logs.meal_type
    OR (logs.meal_type = 'snack' AND groups.kind = 'snack' AND groups.label IS NULL)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nutrition_logs_group_owner_fk'
  ) THEN
    ALTER TABLE public.nutrition_logs
      ADD CONSTRAINT nutrition_logs_group_owner_fk
      FOREIGN KEY (group_id, user_id)
      REFERENCES public.nutrition_groups(id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_group
  ON public.nutrition_logs(group_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_logs_external_identity
  ON public.nutrition_logs(user_id, source, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.nutrition_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own nutrition groups" ON public.nutrition_groups;
CREATE POLICY "Users can view own nutrition groups"
  ON public.nutrition_groups FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own nutrition groups" ON public.nutrition_groups;
CREATE POLICY "Users can insert own nutrition groups"
  ON public.nutrition_groups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own nutrition groups" ON public.nutrition_groups;
CREATE POLICY "Users can update own nutrition groups"
  ON public.nutrition_groups FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own nutrition groups" ON public.nutrition_groups;
CREATE POLICY "Users can delete own nutrition groups"
  ON public.nutrition_groups FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own nutrition imports" ON public.nutrition_import_batches;
CREATE POLICY "Users can view own nutrition imports"
  ON public.nutrition_import_batches FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own nutrition imports" ON public.nutrition_import_batches;
CREATE POLICY "Users can insert own nutrition imports"
  ON public.nutrition_import_batches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own nutrition imports" ON public.nutrition_import_batches;
CREATE POLICY "Users can update own nutrition imports"
  ON public.nutrition_import_batches FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own nutrition imports" ON public.nutrition_import_batches;
CREATE POLICY "Users can delete own nutrition imports"
  ON public.nutrition_import_batches FOR DELETE
  USING (auth.uid() = user_id);

-- ===== 20260719230000_add_body_weight_measurements.sql =====
-- HealthKit-derived body weight. The Apple Health sample UUID is the stable
-- external identity, so foreground/background retries remain idempotent.
CREATE TABLE IF NOT EXISTS body_weight_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'apple_health' CHECK (source = 'apple_health'),
  external_id TEXT NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  kilograms NUMERIC(7,3) NOT NULL CHECK (kilograms > 0 AND kilograms < 500),
  source_bundle TEXT NOT NULL,
  source_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_body_weight_measurements_user_time
  ON body_weight_measurements(user_id, measured_at DESC);

ALTER TABLE body_weight_measurements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own body weight" ON body_weight_measurements;
CREATE POLICY "Users can view own body weight"
  ON body_weight_measurements
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own body weight" ON body_weight_measurements;
CREATE POLICY "Users can insert own body weight"
  ON body_weight_measurements
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own body weight" ON body_weight_measurements;
CREATE POLICY "Users can update own body weight"
  ON body_weight_measurements
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own body weight" ON body_weight_measurements;
CREATE POLICY "Users can delete own body weight"
  ON body_weight_measurements
  FOR DELETE USING (auth.uid() = user_id);

-- ===== 20260721060000_add_activity_custom_type.sql =====
-- User-named activity types. The activity_type enum stays closed so known
-- types keep their behaviour, icons, and grouping logic; custom_type carries
-- the user's own name when they pick 'other' (e.g. "Yoga", "Surfing").
ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS custom_type TEXT;

-- Only meaningful alongside 'other', and keep it short enough to render.
ALTER TABLE activity_sessions
  DROP CONSTRAINT IF EXISTS activity_sessions_custom_type_check;

ALTER TABLE activity_sessions
  ADD CONSTRAINT activity_sessions_custom_type_check CHECK (
    custom_type IS NULL
    OR (activity_type = 'other' AND char_length(btrim(custom_type)) BETWEEN 1 AND 40)
  );

COMMIT;
