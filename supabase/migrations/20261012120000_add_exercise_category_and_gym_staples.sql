-- Exercise library cleanup (additive only: no rows are deleted or renamed).
--
-- 1. A category per exercise, so the picker can keep niche calisthenics skills
--    (levers, planches, shrimp squats, ring and one-arm dips…) in their own
--    section. NULL means "let the app decide from the name"; the app uses the
--    same rules as the backfill below (src/lib/exerciseSearch.ts).
-- 2. Common gym machines and cable moves that were missing.
--
-- Safe to run more than once.

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS category TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exercises_category_check' AND conrelid = 'exercises'::regclass
  ) THEN
    ALTER TABLE exercises
      ADD CONSTRAINT exercises_category_check
      CHECK (category IS NULL OR category IN ('gym', 'calisthenics'));
  END IF;
END;
$$;

-- Backfill rows that have no category yet. Plain staples such as Push-Up,
-- Pull-Up, Chin-Up, Dips and Plank stay in the gym list, and anything using
-- gym equipment is always gym.
UPDATE exercises
SET category = CASE
  WHEN COALESCE(equipment, '') ~* '(barbell|dumbbell|cable|machine|smith|kettlebell)' THEN 'gym'
  WHEN name ~* '\ylevers?\y'
    OR name ~* '\yplanche'
    OR name ~* '\yshrimp\y'
    OR name ~* '\ypistol\y'
    OR name ~* '\yskater squat'
    OR name ~* '\ymuscle[- ]?ups?\y'
    OR name ~* '\yhuman flag\y'
    OR name ~* '\ydragon flag\y'
    OR name ~* '\y[lv][- ]sits?\y'
    OR name ~* '\yhandstand'
    OR name ~* '\yskin the cat\y'
    OR name ~* '\yarcher\y'
    OR name ~* '\ytypewriter\y'
    OR name ~* '\yrings?\y'
    OR name ~* '\y(korean|russian) dips?\y'
    OR name ~* '\ypike push'
    OR name ~* '\y(clap|clapping|plyo|plyometric|explosive|hindu|diamond) push'
    OR name ~* '\yaustralian pull'
    OR name ~* '\yhollow (body|hold|rock)'
    OR name ~* '\ywindshield wiper'
    OR name ~* '\y(one|single)[- ]arm\y.*\y(push[- ]?ups?|pull[- ]?ups?|chin[- ]?ups?|dips?)\y'
    THEN 'calisthenics'
  ELSE 'gym'
END
WHERE category IS NULL;

-- Missing gym staples. Existing names are left untouched. "45° Back Extension"
-- is added next to "Weighted Hyperextension" (which keeps its logged history);
-- search finds either one for "back extension" or "hyperextension".
INSERT INTO exercises (name, muscle_group, muscle_group_secondary, equipment, is_compound, category) VALUES
('Hack Squat', 'quads', 'glutes', 'machine', true, 'gym'),
('Machine Chest Press', 'chest', 'triceps', 'machine', true, 'gym'),
('Machine Shoulder Press', 'shoulders', 'triceps', 'machine', true, 'gym'),
('One-Arm Chest-Supported Machine Row', 'back', 'biceps', 'machine', true, 'gym'),
('Cable Overhead Tricep Extension', 'triceps', NULL, 'cable', false, 'gym'),
('Cable Curl', 'biceps', NULL, 'cable', false, 'gym'),
('45° Back Extension', 'glutes', 'hamstrings', 'machine', true, 'gym')
ON CONFLICT (name) DO NOTHING;
