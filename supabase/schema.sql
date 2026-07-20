-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Body weight imported from Apple Health
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

-- Exercises library
CREATE TABLE IF NOT EXISTS exercises (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  muscle_group TEXT NOT NULL,
  muscle_group_secondary TEXT,
  equipment TEXT,
  is_compound BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workout Splits
CREATE TABLE IF NOT EXISTS splits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  days_per_week INTEGER NOT NULL DEFAULT 4,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Split Days (e.g., "Push Day", "Pull Day")
CREATE TABLE IF NOT EXISTS split_days (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  split_id UUID NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  day_name TEXT NOT NULL,
  day_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Split Exercises (exercises in each split day)
CREATE TABLE IF NOT EXISTS split_exercises (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  split_day_id UUID NOT NULL REFERENCES split_days(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  target_sets INTEGER NOT NULL DEFAULT 3,
  target_reps_min INTEGER NOT NULL DEFAULT 8,
  target_reps_max INTEGER NOT NULL DEFAULT 12,
  exercise_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workouts (individual training sessions)
CREATE TABLE IF NOT EXISTS workouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  split_day_id UUID REFERENCES split_days(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sets (individual sets within workouts)
CREATE TABLE IF NOT EXISTS sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  set_number INTEGER NOT NULL,
  weight DECIMAL(10,2),
  reps INTEGER,
  rpe DECIMAL(3,1),
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity Sessions (non-lifting calendar events)
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
  -- session-level aggregates rolled up from segments; null for manual entries
  strain NUMERIC,
  avg_hr SMALLINT,
  max_hr SMALLINT,
  energy_kcal NUMERIC,
  distance_m NUMERIC,
  -- import bookkeeping: created by grouping engine / edited by user / soft-deleted
  auto_grouped BOOLEAN NOT NULL DEFAULT FALSE,
  user_edited BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at)
);

-- Raw imported/recorded child records of activity_sessions (one row per WHOOP
-- workout record or GPS lap/sprint rep). UNIQUE (user_id, source, external_id)
-- makes re-imports idempotent.
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

-- WHOOP integration (see migration 20260710091000 for policy rationale):
-- whoop_connections = safe metadata (owner read-only), whoop_tokens = OAuth
-- tokens locked to the service role (zero policies + REVOKE)
CREATE TABLE IF NOT EXISTS whoop_connections (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  whoop_user_id TEXT,
  scopes TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whoop_tokens (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foods database (custom + USDA)
CREATE TABLE IF NOT EXISTS foods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  calories DECIMAL(10,1) NOT NULL,
  protein DECIMAL(10,1) NOT NULL,
  carbs DECIMAL(10,1) NOT NULL,
  fat DECIMAL(10,1) NOT NULL,
  serving_size DECIMAL(10,2) NOT NULL DEFAULT 1,
  serving_unit TEXT NOT NULL DEFAULT 'serving',
  source TEXT DEFAULT 'custom',
  fdc_id TEXT,
  external_source TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Day-scoped containers for unlimited meals and snacks
CREATE TABLE IF NOT EXISTS nutrition_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('meal', 'snack')),
  label TEXT CHECK (label IS NULL OR label IN ('breakfast', 'lunch', 'dinner')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS nutrition_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('cronometer')),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, file_hash)
);

-- Nutrition Logs
CREATE TABLE IF NOT EXISTS nutrition_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  logged_at TIMESTAMPTZ,
  food_id UUID NOT NULL REFERENCES foods(id),
  servings DECIMAL(10,2) NOT NULL DEFAULT 1,
  meal_type TEXT DEFAULT 'snack',
  group_id UUID,
  sort_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  import_batch_id UUID REFERENCES nutrition_import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT nutrition_logs_group_owner_fk
    FOREIGN KEY (group_id, user_id) REFERENCES nutrition_groups(id, user_id)
);

-- Macro Targets
CREATE TABLE IF NOT EXISTS macro_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  calories INTEGER NOT NULL DEFAULT 2000,
  protein INTEGER NOT NULL DEFAULT 150,
  carbs INTEGER NOT NULL DEFAULT 200,
  fat INTEGER NOT NULL DEFAULT 65,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Volume Landmarks (Beardsley-based)
CREATE TABLE IF NOT EXISTS volume_landmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  muscle_group TEXT NOT NULL,
  mv INTEGER DEFAULT 0,
  mev INTEGER DEFAULT 2,
  mav_low INTEGER DEFAULT 6,
  mav_high INTEGER DEFAULT 12,
  mrv INTEGER DEFAULT 15,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, muscle_group)
);

-- Indexes for performance
CREATE INDEX idx_splits_user_id ON splits(user_id);
CREATE INDEX idx_split_days_split_id ON split_days(split_id);
CREATE INDEX idx_split_exercises_day_id ON split_exercises(split_day_id);
CREATE INDEX idx_workouts_user_id ON workouts(user_id);
CREATE INDEX idx_workouts_date ON workouts(date);
CREATE INDEX idx_sets_workout_id ON sets(workout_id);
CREATE INDEX idx_sets_exercise_id ON sets(exercise_id);
CREATE INDEX idx_body_weight_measurements_user_time ON body_weight_measurements(user_id, measured_at DESC);
CREATE INDEX idx_activity_sessions_user_date ON activity_sessions(user_id, date);
CREATE INDEX idx_activity_sessions_user_started_at ON activity_sessions(user_id, started_at);
CREATE INDEX idx_activity_segments_user_started_at ON activity_segments(user_id, started_at);
CREATE INDEX idx_activity_segments_session ON activity_segments(session_id);
CREATE INDEX idx_nutrition_logs_user_date ON nutrition_logs(user_id, date);
CREATE INDEX idx_nutrition_logs_user_logged_at ON nutrition_logs(user_id, logged_at);
CREATE INDEX idx_nutrition_groups_user_date ON nutrition_groups(user_id, date, sort_order);
CREATE UNIQUE INDEX idx_nutrition_groups_named_label ON nutrition_groups(user_id, date, label) WHERE label IS NOT NULL;
CREATE INDEX idx_nutrition_logs_group ON nutrition_logs(group_id, sort_order);
CREATE UNIQUE INDEX idx_nutrition_logs_external_identity ON nutrition_logs(user_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX idx_foods_external_identity ON foods(user_id, external_source, external_id) WHERE user_id IS NOT NULL AND external_source IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_foods_user_id ON foods(user_id);

-- Plan Schedules (training start-date & weekday mapping, synced across devices)
CREATE TABLE IF NOT EXISTS plan_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  split_id UUID NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  mode TEXT NOT NULL DEFAULT 'fixed' CHECK (mode IN ('fixed','flex')),
  weekdays INTEGER[] NOT NULL DEFAULT '{}',
  anchor_day INTEGER CHECK (anchor_day IS NULL OR anchor_day BETWEEN 0 AND 6),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, split_id)
);

-- RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_weight_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE whoop_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE whoop_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON whoop_tokens FROM anon, authenticated;
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE macro_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_landmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_schedules ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Exercises policies
CREATE POLICY "Authenticated users can view exercises" ON exercises FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert exercises" ON exercises FOR INSERT TO authenticated WITH CHECK (true);

-- Splits policies
CREATE POLICY "Users can view own splits" ON splits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own splits" ON splits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own splits" ON splits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own splits" ON splits FOR DELETE USING (auth.uid() = user_id);

-- Split days policies
CREATE POLICY "Users can view own split days" ON split_days FOR SELECT USING (
  EXISTS (SELECT 1 FROM splits WHERE splits.id = split_days.split_id AND splits.user_id = auth.uid())
);
CREATE POLICY "Users can insert own split days" ON split_days FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM splits WHERE splits.id = split_days.split_id AND splits.user_id = auth.uid())
);
CREATE POLICY "Users can update own split days" ON split_days FOR UPDATE USING (
  EXISTS (SELECT 1 FROM splits WHERE splits.id = split_days.split_id AND splits.user_id = auth.uid())
);
CREATE POLICY "Users can delete own split days" ON split_days FOR DELETE USING (
  EXISTS (SELECT 1 FROM splits WHERE splits.id = split_days.split_id AND splits.user_id = auth.uid())
);

-- Split exercises policies
CREATE POLICY "Users can view own split exercises" ON split_exercises FOR SELECT USING (
  EXISTS (SELECT 1 FROM split_days JOIN splits ON splits.id = split_days.split_id WHERE split_days.id = split_exercises.split_day_id AND splits.user_id = auth.uid())
);
CREATE POLICY "Users can insert own split exercises" ON split_exercises FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM split_days JOIN splits ON splits.id = split_days.split_id WHERE split_days.id = split_exercises.split_day_id AND splits.user_id = auth.uid())
);
CREATE POLICY "Users can update own split exercises" ON split_exercises FOR UPDATE USING (
  EXISTS (SELECT 1 FROM split_days JOIN splits ON splits.id = split_days.split_id WHERE split_days.id = split_exercises.split_day_id AND splits.user_id = auth.uid())
);
CREATE POLICY "Users can delete own split exercises" ON split_exercises FOR DELETE USING (
  EXISTS (SELECT 1 FROM split_days JOIN splits ON splits.id = split_days.split_id WHERE split_days.id = split_exercises.split_day_id AND splits.user_id = auth.uid())
);

-- Workouts policies
CREATE POLICY "Users can view own workouts" ON workouts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own workouts" ON workouts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workouts" ON workouts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own workouts" ON workouts FOR DELETE USING (auth.uid() = user_id);

-- Sets policies
CREATE POLICY "Users can view own sets" ON sets FOR SELECT USING (
  EXISTS (SELECT 1 FROM workouts WHERE workouts.id = sets.workout_id AND workouts.user_id = auth.uid())
);
CREATE POLICY "Users can insert own sets" ON sets FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM workouts WHERE workouts.id = sets.workout_id AND workouts.user_id = auth.uid())
);
CREATE POLICY "Users can update own sets" ON sets FOR UPDATE USING (
  EXISTS (SELECT 1 FROM workouts WHERE workouts.id = sets.workout_id AND workouts.user_id = auth.uid())
);
CREATE POLICY "Users can delete own sets" ON sets FOR DELETE USING (
  EXISTS (SELECT 1 FROM workouts WHERE workouts.id = sets.workout_id AND workouts.user_id = auth.uid())
);

-- Body weight policies
CREATE POLICY "Users can view own body weight" ON body_weight_measurements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own body weight" ON body_weight_measurements FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own body weight" ON body_weight_measurements FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own body weight" ON body_weight_measurements FOR DELETE USING (auth.uid() = user_id);

-- Activity sessions policies
CREATE POLICY "Users can view own activity sessions" ON activity_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activity sessions" ON activity_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own activity sessions" ON activity_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own activity sessions" ON activity_sessions FOR DELETE USING (auth.uid() = user_id);

-- Activity segments policies
CREATE POLICY "Users can view own activity segments" ON activity_segments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activity segments" ON activity_segments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own activity segments" ON activity_segments FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own activity segments" ON activity_segments FOR DELETE USING (auth.uid() = user_id);

-- WHOOP connection policies: owner may read status; only service role writes.
-- whoop_tokens intentionally has NO policies.
CREATE POLICY "Users can view own whoop connection" ON whoop_connections FOR SELECT USING (auth.uid() = user_id);
-- Foods policies
CREATE POLICY "Users can view own foods" ON foods FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can insert own foods" ON foods FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Users can update own foods" ON foods FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own foods" ON foods FOR DELETE USING (auth.uid() = user_id);

-- Nutrition logs policies
CREATE POLICY "Users can view own nutrition logs" ON nutrition_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own nutrition logs" ON nutrition_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own nutrition logs" ON nutrition_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own nutrition logs" ON nutrition_logs FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view own nutrition groups" ON nutrition_groups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own nutrition groups" ON nutrition_groups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own nutrition groups" ON nutrition_groups FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own nutrition groups" ON nutrition_groups FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view own nutrition imports" ON nutrition_import_batches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own nutrition imports" ON nutrition_import_batches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own nutrition imports" ON nutrition_import_batches FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own nutrition imports" ON nutrition_import_batches FOR DELETE USING (auth.uid() = user_id);

-- Macro targets policies
CREATE POLICY "Users can view own macro targets" ON macro_targets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own macro targets" ON macro_targets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own macro targets" ON macro_targets FOR UPDATE USING (auth.uid() = user_id);

-- Volume landmarks policies
CREATE POLICY "Users can view own volume landmarks" ON volume_landmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own volume landmarks" ON volume_landmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own volume landmarks" ON volume_landmarks FOR UPDATE USING (auth.uid() = user_id);

-- Plan schedules policies
CREATE POLICY "Users can view own plan schedules" ON plan_schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own plan schedules" ON plan_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own plan schedules" ON plan_schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own plan schedules" ON plan_schedules FOR DELETE USING (auth.uid() = user_id);

-- Function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name');
  RETURN NEW;
END;
$$;

-- Trigger to create profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Default exercises (seed data)
INSERT INTO exercises (name, muscle_group, muscle_group_secondary, equipment, is_compound) VALUES
-- Chest
('Flat Barbell Bench Press', 'chest', 'triceps', 'barbell', true),
('Incline Barbell Bench Press', 'chest', 'triceps', 'barbell', true),
('Flat Dumbbell Bench Press', 'chest', 'triceps', 'dumbbells', true),
('Incline Dumbbell Bench Press', 'chest', 'triceps', 'dumbbells', true),
('Cable Fly', 'chest', NULL, 'cable', false),
('Pec Deck / Machine Fly', 'chest', NULL, 'machine', false),
('Push-Up', 'chest', 'triceps', 'bodyweight', true),

-- Back
('Barbell Deadlift', 'back', 'legs', 'barbell', true),
('Barbell Row', 'back', 'biceps', 'barbell', true),
('One-Arm Dumbbell Row', 'back', 'biceps', 'dumbbells', true),
('Lat Pulldown', 'back', 'biceps', 'cable', true),
('Seated Cable Row', 'back', 'biceps', 'cable', true),
('Pull-Up', 'back', 'biceps', 'bodyweight', true),
('Chin-Up', 'back', 'biceps', 'bodyweight', true),
('Face Pull', 'rear_delts', 'traps', 'cable', false),

-- Shoulders
('Overhead Barbell Press', 'shoulders', 'triceps', 'barbell', true),
('Overhead Dumbbell Press', 'shoulders', 'triceps', 'dumbbells', true),
('Arnold Press', 'shoulders', 'triceps', 'dumbbells', true),
('Lateral Raise', 'side_delts', NULL, 'dumbbells', false),
('Cable Lateral Raise', 'side_delts', NULL, 'cable', false),
('Rear Delt Fly', 'rear_delts', NULL, 'dumbbells', false),
('Front Raise', 'front_delts', NULL, 'dumbbells', false),

-- Biceps
('Barbell Curl', 'biceps', NULL, 'barbell', false),
('Dumbbell Curl', 'biceps', NULL, 'dumbbells', false),
('Hammer Curl', 'biceps', 'brachialis', 'dumbbells', false),
('Preacher Curl', 'biceps', NULL, 'barbell', false),
('Cable Curl', 'biceps', NULL, 'cable', false),
('Incline Dumbbell Curl', 'biceps', NULL, 'dumbbells', false),

-- Triceps
('Close-Grip Bench Press', 'triceps', 'chest', 'barbell', true),
('Tricep Pushdown', 'triceps', NULL, 'cable', false),
('Overhead Tricep Extension', 'triceps', NULL, 'dumbbells', false),
('Skull Crushers', 'triceps', NULL, 'barbell', false),
('Dips', 'triceps', 'chest', 'bodyweight', true),

-- Legs
('Barbell Back Squat', 'quads', 'glutes', 'barbell', true),
('Leg Press', 'quads', 'glutes', 'machine', true),
('Bulgarian Split Squat', 'quads', 'glutes', 'dumbbells', true),
('Leg Extension', 'quads', NULL, 'machine', false),
('Romanian Deadlift', 'hamstrings', 'glutes', 'barbell', true),
('Lying Leg Curl', 'hamstrings', NULL, 'machine', false),
('Seated Leg Curl', 'hamstrings', NULL, 'machine', false),
('Leg Curl', 'hamstrings', NULL, 'machine', false),
('Calf Raise', 'calves', NULL, 'machine', false),
('Standing Calf Raise', 'calves', NULL, 'dumbbells', false),
('Hip Thrust', 'glutes', 'hamstrings', 'barbell', true),
('Lunge', 'quads', 'glutes', 'dumbbells', true),
('Goblet Squat', 'quads', 'glutes', 'dumbbells', true),

-- Core
('Plank', 'core', NULL, 'bodyweight', false),
('Ab Wheel Rollout', 'core', NULL, 'bodyweight', false),
('Cable Crunch', 'core', NULL, 'cable', false),
('Hanging Leg Raise', 'core', NULL, 'bodyweight', false),
('Russian Twist', 'core', NULL, 'bodyweight', false)
ON CONFLICT (name) DO NOTHING;

-- Default volume landmarks based on Beardsley research
-- These are starting points; users can customize
INSERT INTO volume_landmarks (user_id, muscle_group, mv, mev, mav_low, mav_high, mrv)
SELECT 
  p.id,
  v.muscle_group,
  v.mv,
  v.mev,
  v.mav_low,
  v.mav_high,
  v.mrv
FROM profiles p
CROSS JOIN (
  VALUES
    ('chest', 0, 8, 10, 16, 22),
    ('back', 0, 8, 12, 18, 25),
    ('shoulders', 0, 4, 6, 10, 16),
    ('side_delts', 0, 6, 10, 16, 22),
    ('rear_delts', 0, 4, 6, 10, 14),
    ('front_delts', 0, 2, 4, 6, 10),
    ('biceps', 0, 6, 10, 14, 20),
    ('triceps', 0, 6, 10, 14, 20),
    ('quads', 0, 6, 8, 14, 20),
    ('hamstrings', 0, 4, 6, 10, 16),
    ('glutes', 0, 4, 6, 10, 16),
    ('calves', 0, 4, 6, 10, 16),
    ('core', 0, 4, 6, 10, 16)
) v(muscle_group, mv, mev, mav_low, mav_high, mrv)
WHERE NOT EXISTS (
  SELECT 1 FROM volume_landmarks vl WHERE vl.user_id = p.id AND vl.muscle_group = v.muscle_group
);
