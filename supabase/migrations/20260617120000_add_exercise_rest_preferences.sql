-- Per-movement rest timer preferences: remember a preferred rest duration
-- per (user, exercise) so the timer auto-starts at the right length and
-- survives device switches. Last-used is derived from MAX(updated_at).

CREATE TABLE IF NOT EXISTS exercise_rest_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  rest_seconds INTEGER NOT NULL CHECK (rest_seconds BETWEEN 5 AND 3600),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, exercise_id)
);

ALTER TABLE exercise_rest_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rest preferences"
  ON exercise_rest_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own rest preferences"
  ON exercise_rest_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own rest preferences"
  ON exercise_rest_preferences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own rest preferences"
  ON exercise_rest_preferences FOR DELETE USING (auth.uid() = user_id);
