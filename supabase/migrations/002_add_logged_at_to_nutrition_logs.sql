-- Migration: add time-based logging support for nutrition entries

ALTER TABLE nutrition_logs
ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ;

-- Backfill existing rows to midday when timestamp is missing
UPDATE nutrition_logs
SET logged_at = (date::timestamp + TIME '12:00') AT TIME ZONE 'UTC'
WHERE logged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_user_logged_at
ON nutrition_logs(user_id, logged_at);
