-- hyPer adaptive macro engine: production cutover for the nutrition-profile migration.
-- Re-runnable. Wrapped in one transaction: if anything fails, nothing is applied.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (PRODUCTION project nnwfaaxmyvqsdnfcdxom).

BEGIN;

-- ===== 20260725120000_add_nutrition_profiles.sql =====
-- Adaptive macro engine, part 1: persist the inputs behind the targets.
--
-- Until now the nutrition wizard collected sex/age/height/activity/goal, used
-- them once, and discarded them at the modal boundary — only the four computed
-- integers survived. That made it impossible to recompute targets as bodyweight
-- moved, and nothing downstream could tell whether the user was cutting.
--
-- Current bodyweight is deliberately NOT stored here. It lives in
-- body_weight_measurements as a time series, which is the single source of
-- truth and the input the adaptive layer needs.

CREATE TABLE IF NOT EXISTS nutrition_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  -- Body basis. birth_year rather than age so it never goes stale.
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  birth_year SMALLINT NOT NULL CHECK (birth_year BETWEEN 1900 AND 2100),
  height_cm NUMERIC(5,1) NOT NULL CHECK (height_cm > 50 AND height_cm < 260),
  body_fat_pct NUMERIC(4,1)
    CHECK (body_fat_pct IS NULL OR (body_fat_pct >= 3 AND body_fat_pct <= 60)),

  -- Intent.
  activity TEXT NOT NULL CHECK (
    activity IN ('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active')
  ),
  goal TEXT NOT NULL CHECK (goal IN ('cut', 'maintain', 'lean_bulk', 'bulk')),
  -- Signed % of bodyweight per week. Negative loses, positive gains.
  rate_pct_per_week NUMERIC(4,2) NOT NULL DEFAULT 0
    CHECK (rate_pct_per_week >= -2 AND rate_pct_per_week <= 2),
  unit_system TEXT NOT NULL DEFAULT 'imperial' CHECK (unit_system IN ('metric', 'imperial')),

  -- Adaptive state. phase_started_on lets the expenditure estimator skip the
  -- glycogen/water transient that follows any change of goal or rate.
  adaptive_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  phase_started_on DATE NOT NULL DEFAULT CURRENT_DATE,
  expenditure_kcal NUMERIC(7,1) CHECK (expenditure_kcal IS NULL OR expenditure_kcal > 0),
  expenditure_confidence TEXT
    CHECK (expenditure_confidence IS NULL OR expenditure_confidence IN ('predicted', 'learning', 'measured')),
  expenditure_updated_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE nutrition_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'nutrition_profiles' AND policyname = 'Users can view own nutrition profile'
  ) THEN
    CREATE POLICY "Users can view own nutrition profile" ON nutrition_profiles
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'nutrition_profiles' AND policyname = 'Users can insert own nutrition profile'
  ) THEN
    CREATE POLICY "Users can insert own nutrition profile" ON nutrition_profiles
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'nutrition_profiles' AND policyname = 'Users can update own nutrition profile'
  ) THEN
    CREATE POLICY "Users can update own nutrition profile" ON nutrition_profiles
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'nutrition_profiles' AND policyname = 'Users can delete own nutrition profile'
  ) THEN
    CREATE POLICY "Users can delete own nutrition profile" ON nutrition_profiles
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;


-- ── macro_targets: record where a target came from ──
-- 'manual' means the user typed it. The adaptive loop must never overwrite it.

ALTER TABLE macro_targets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE macro_targets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'macro_targets_source_check') THEN
    ALTER TABLE macro_targets
      ADD CONSTRAINT macro_targets_source_check
      CHECK (source IN ('manual', 'calculated', 'adaptive'));
  END IF;
END $$;


-- ── body_weight_measurements: allow manual weigh-ins ──
-- The original CHECK pinned source to the single value 'apple_health', so
-- anyone without a connected smart scale had no way to record a weight at all
-- — and the adaptive estimator needs a weight series to work from.

ALTER TABLE body_weight_measurements DROP CONSTRAINT IF EXISTS body_weight_measurements_source_check;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'body_weight_measurements_source_allowed') THEN
    ALTER TABLE body_weight_measurements
      ADD CONSTRAINT body_weight_measurements_source_allowed
      CHECK (source IN ('apple_health', 'manual'));
  END IF;
END $$;

-- source_bundle / source_name are NOT NULL with no defaults, which made a
-- manual insert invent values for two HealthKit-shaped columns.
ALTER TABLE body_weight_measurements ALTER COLUMN source_bundle SET DEFAULT 'manual';
ALTER TABLE body_weight_measurements ALTER COLUMN source_name SET DEFAULT 'Manual entry';

COMMIT;
