-- Calorie target changes: one row each time the adaptive loop moves a
-- person's target, so the app can say what changed and why (Last week on
-- Mondays, and You > Targets), and Undo can put the old target back.
-- Not applied anywhere yet. The app reads and writes this table quietly: on a
-- backend without it, nothing is recorded or shown and nothing else changes.
--
-- Each person sees and adds only their own rows; nothing for signed-out
-- callers. A client can change only undone_at (Undo), never the figures.
-- Account deletion removes the rows (profiles, and through it auth.users,
-- cascade).
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.macro_target_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The target before and after, as saved in macro_targets.
  old_calories INTEGER NOT NULL CHECK (old_calories BETWEEN 0 AND 20000),
  old_protein INTEGER NOT NULL CHECK (old_protein BETWEEN 0 AND 2000),
  old_carbs INTEGER NOT NULL CHECK (old_carbs BETWEEN 0 AND 3000),
  old_fat INTEGER NOT NULL CHECK (old_fat BETWEEN 0 AND 2000),
  new_calories INTEGER NOT NULL CHECK (new_calories BETWEEN 0 AND 20000),
  new_protein INTEGER NOT NULL CHECK (new_protein BETWEEN 0 AND 2000),
  new_carbs INTEGER NOT NULL CHECK (new_carbs BETWEEN 0 AND 3000),
  new_fat INTEGER NOT NULL CHECK (new_fat BETWEEN 0 AND 2000),
  -- Why: the learned daily burn and how sure the estimate is, the measured
  -- weight change and the goal's pace (signed kg a week), the mean logged
  -- intake, and how many logged days and weigh-ins the estimate used.
  expenditure_kcal INTEGER NOT NULL CHECK (expenditure_kcal BETWEEN 500 AND 10000),
  expenditure_confidence TEXT NOT NULL CHECK (expenditure_confidence IN ('learning', 'measured')),
  kg_per_week NUMERIC(6, 3) CHECK (kg_per_week IS NULL OR kg_per_week BETWEEN -10 AND 10),
  goal_kg_per_week NUMERIC(6, 3) CHECK (goal_kg_per_week IS NULL OR goal_kg_per_week BETWEEN -10 AND 10),
  mean_intake_kcal INTEGER CHECK (mean_intake_kcal IS NULL OR mean_intake_kcal BETWEEN 0 AND 20000),
  logged_days SMALLINT NOT NULL CHECK (logged_days BETWEEN 0 AND 366),
  weigh_in_days SMALLINT NOT NULL CHECK (weigh_in_days BETWEEN 0 AND 366),
  -- Set by Undo: the old target went back until the next weekly update.
  undone_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS macro_target_changes_user_changed_idx
  ON public.macro_target_changes(user_id, changed_at DESC);

ALTER TABLE public.macro_target_changes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.macro_target_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.macro_target_changes TO authenticated;
GRANT UPDATE (undone_at) ON public.macro_target_changes TO authenticated;
GRANT ALL ON public.macro_target_changes TO service_role;

DROP POLICY IF EXISTS "Users can view own macro target changes" ON public.macro_target_changes;
CREATE POLICY "Users can view own macro target changes" ON public.macro_target_changes
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert own macro target changes" ON public.macro_target_changes;
CREATE POLICY "Users can insert own macro target changes" ON public.macro_target_changes
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own macro target changes" ON public.macro_target_changes;
CREATE POLICY "Users can update own macro target changes" ON public.macro_target_changes
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Approved accounts only, as every other app table, once the private beta
-- migration (20261109120000) has added is_approved_user. Before it, the
-- policies above already limit each person to their own rows.
DO $$
BEGIN
  IF to_regprocedure('public.is_approved_user()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Private beta: approved users only" ON public.macro_target_changes;
    CREATE POLICY "Private beta: approved users only" ON public.macro_target_changes
      AS RESTRICTIVE FOR ALL TO PUBLIC
      USING ((SELECT public.is_approved_user()))
      WITH CHECK ((SELECT public.is_approved_user()));
  END IF;
END
$$;
