-- Migration: Fix split_exercises RLS policies
-- This fixes the bug where exercises weren't being added to split templates

-- Add INSERT policy for split_exercises
CREATE POLICY "Users can insert own split exercises" ON split_exercises FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM split_days JOIN splits ON splits.id = split_days.split_id WHERE split_days.id = split_exercises.split_day_id AND splits.user_id = auth.uid())
);

-- Add UPDATE policy for split_exercises
CREATE POLICY "Users can update own split exercises" ON split_exercises FOR UPDATE USING (
  EXISTS (SELECT 1 FROM split_days JOIN splits ON splits.id = split_days.split_id WHERE split_days.id = split_exercises.split_day_id AND splits.user_id = auth.uid())
);

-- Add DELETE policy for split_exercises
CREATE POLICY "Users can delete own split exercises" ON split_exercises FOR DELETE USING (
  EXISTS (SELECT 1 FROM split_days JOIN splits ON splits.id = split_days.split_id WHERE split_days.id = split_exercises.split_day_id AND splits.user_id = auth.uid())
);

-- Also enable RLS if not already enabled
ALTER TABLE split_exercises ENABLE ROW LEVEL SECURITY;
