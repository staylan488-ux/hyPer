-- WHOOP physiology on a lifting workout.
--
-- A lifting session and the WHOOP record of it are the same event seen twice,
-- but workouts live in their own table with no strain, heart rate or energy of
-- their own, and never appear in the activity merge picker. These columns let
-- the WHOOP record be attached to the workout it belongs to.
--
-- whoop_session_id remembers the source so the attachment can be undone. It is
-- ON DELETE SET NULL rather than CASCADE: deleting the WHOOP activity must not
-- delete the user's workout.
--
-- All nullable and additive; every existing workout row stays valid untouched.

ALTER TABLE workouts ADD COLUMN IF NOT EXISTS strain NUMERIC;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS avg_hr SMALLINT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS max_hr SMALLINT;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS energy_kcal NUMERIC;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS whoop_session_id UUID
  REFERENCES activity_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workouts_whoop_session
  ON workouts(whoop_session_id) WHERE whoop_session_id IS NOT NULL;
