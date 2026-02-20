-- Flexible programming mode persistence

CREATE TABLE IF NOT EXISTS program_preferences (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  workout_mode TEXT NOT NULL DEFAULT 'split' CHECK (workout_mode IN ('split', 'flexible')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workout_day_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id UUID NOT NULL UNIQUE REFERENCES workouts(id) ON DELETE CASCADE,
  day_label TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flex_day_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, label)
);

CREATE INDEX IF NOT EXISTS idx_flex_day_templates_user_id ON flex_day_templates(user_id);

ALTER TABLE program_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_day_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE flex_day_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own program preferences" ON program_preferences
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own program preferences" ON program_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own program preferences" ON program_preferences
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own program preferences" ON program_preferences
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own workout day plans" ON workout_day_plans
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM workouts WHERE workouts.id = workout_day_plans.workout_id AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can insert own workout day plans" ON workout_day_plans
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM workouts WHERE workouts.id = workout_day_plans.workout_id AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can update own workout day plans" ON workout_day_plans
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM workouts WHERE workouts.id = workout_day_plans.workout_id AND workouts.user_id = auth.uid())
  );
CREATE POLICY "Users can delete own workout day plans" ON workout_day_plans
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM workouts WHERE workouts.id = workout_day_plans.workout_id AND workouts.user_id = auth.uid())
  );

CREATE POLICY "Users can view own flex day templates" ON flex_day_templates
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own flex day templates" ON flex_day_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own flex day templates" ON flex_day_templates
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own flex day templates" ON flex_day_templates
  FOR DELETE USING (auth.uid() = user_id);
