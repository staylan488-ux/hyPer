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

CREATE POLICY "Users can view own body weight" ON body_weight_measurements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own body weight" ON body_weight_measurements
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own body weight" ON body_weight_measurements
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own body weight" ON body_weight_measurements
  FOR DELETE USING (auth.uid() = user_id);

