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

CREATE POLICY "Users can view own activity segments" ON activity_segments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activity segments" ON activity_segments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own activity segments" ON activity_segments
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own activity segments" ON activity_segments
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
