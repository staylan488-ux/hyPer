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

CREATE POLICY "Users can view own activity sessions" ON activity_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activity sessions" ON activity_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own activity sessions" ON activity_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own activity sessions" ON activity_sessions
  FOR DELETE USING (auth.uid() = user_id);
