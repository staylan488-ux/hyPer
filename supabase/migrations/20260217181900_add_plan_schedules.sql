-- Plan Schedules: persist training start-date & weekday mapping in the DB
-- so schedules survive device switches and cache clears.

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

ALTER TABLE plan_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own plan schedules" ON plan_schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own plan schedules" ON plan_schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own plan schedules" ON plan_schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own plan schedules" ON plan_schedules FOR DELETE USING (auth.uid() = user_id);
