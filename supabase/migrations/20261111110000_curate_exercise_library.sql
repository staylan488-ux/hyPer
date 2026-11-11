-- A curated everyday gym list. No row is deleted or renamed, and no program,
-- logged set, rest preference or saved plan is touched.
--
-- 1. retired_at: duplicates and never-used niche movements leave the picker
--    but keep their row, so everything that points at them keeps working. The
--    app offers a retired row only when a search spells out its whole name
--    (src/lib/exerciseSearch.ts, offeredInPicker). Clearing it brings a row back.
-- 2. Gym staples that were missing, as shared rows.
-- 3. Bodyweight skills that were filed as gym move to the calisthenics section.
-- 4. Muscle values the app does not know become ones it does.
-- 5. Bodyweight skills nobody has ever logged, programmed or planned retire.
--
-- Independent of 20261111120000_public_signup_hardening (which adds user_id;
-- NULL means shared): inserts here never set user_id, and the existence check
-- does not use ON CONFLICT, so it works before or after it. Safe to run more
-- than once.

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

-- 2. Missing staples. A name already in the library, in any letter case, is
-- left as it is.
INSERT INTO exercises (name, muscle_group, muscle_group_secondary, equipment, is_compound, category)
SELECT v.name, v.muscle_group, v.muscle_group_secondary, v.equipment, v.is_compound, 'gym'
FROM (VALUES
  -- Chest
  ('Decline Barbell Bench Press', 'chest', 'triceps', 'barbell', true),
  ('Smith Machine Bench Press', 'chest', 'triceps', 'smith machine', true),
  ('Incline Smith Machine Bench Press', 'chest', 'triceps', 'smith machine', true),
  ('Incline Machine Chest Press', 'chest', 'triceps', 'machine', true),
  ('Dumbbell Fly', 'chest', NULL, 'dumbbells', false),
  ('Incline Dumbbell Fly', 'chest', NULL, 'dumbbells', false),
  ('Low-to-High Cable Fly', 'chest', 'front_delts', 'cable', false),
  ('Dumbbell Pullover', 'chest', 'back', 'dumbbells', false),
  -- Back
  ('Pendlay Row', 'back', 'biceps', 'barbell', true),
  ('One-Arm Cable Row', 'back', 'biceps', 'cable', true),
  ('Close-Grip Lat Pulldown', 'back', 'biceps', 'cable', true),
  ('One-Arm Lat Pulldown', 'back', 'biceps', 'cable', true),
  ('Straight-Arm Pulldown', 'back', NULL, 'cable', false),
  -- Shoulders
  ('Smith Machine Shoulder Press', 'shoulders', 'triceps', 'smith machine', true),
  ('Machine Lateral Raise', 'side_delts', NULL, 'machine', false),
  ('Upright Row', 'side_delts', 'traps', 'barbell', true),
  ('Reverse Pec Deck', 'rear_delts', NULL, 'machine', false),
  ('Cable Rear Delt Fly', 'rear_delts', NULL, 'cable', false),
  -- Biceps
  ('EZ-Bar Curl', 'biceps', NULL, 'barbell', false),
  ('Machine Preacher Curl', 'biceps', NULL, 'machine', false),
  ('Concentration Curl', 'biceps', NULL, 'dumbbells', false),
  ('Bayesian Cable Curl', 'biceps', NULL, 'cable', false),
  ('Spider Curl', 'biceps', NULL, 'dumbbells', false),
  ('Rope Hammer Curl', 'biceps', NULL, 'cable', false),
  ('Reverse Curl', 'biceps', NULL, 'barbell', false),
  -- Triceps
  ('Rope Pushdown', 'triceps', NULL, 'cable', false),
  ('Tricep Kickback', 'triceps', NULL, 'dumbbells', false),
  ('Machine Dip', 'triceps', 'chest', 'machine', true),
  -- Quads
  ('Front Squat', 'quads', 'glutes', 'barbell', true),
  ('Smith Machine Squat', 'quads', 'glutes', 'smith machine', true),
  ('Pendulum Squat', 'quads', 'glutes', 'machine', true),
  ('Belt Squat', 'quads', 'glutes', 'machine', true),
  ('Walking Lunge', 'quads', 'glutes', 'dumbbells', true),
  ('Step-Up', 'quads', 'glutes', 'dumbbells', true),
  ('Trap Bar Deadlift', 'quads', 'glutes', 'barbell', true),
  -- Hamstrings
  ('Dumbbell Romanian Deadlift', 'hamstrings', 'glutes', 'dumbbells', true),
  ('Stiff-Leg Deadlift', 'hamstrings', 'glutes', 'barbell', true),
  -- Glutes and hips (the app has no adductor muscle, so both hip machines sit
  -- under glutes)
  ('Hip Abduction Machine', 'glutes', NULL, 'machine', false),
  ('Cable Glute Kickback', 'glutes', 'hamstrings', 'cable', false),
  ('Sumo Deadlift', 'glutes', 'hamstrings', 'barbell', true),
  ('Kettlebell Swing', 'glutes', 'hamstrings', 'kettlebell', true),
  -- Calves ("Calf Raise" is in the repo's seed and the guided plans, but was
  -- never in production, so guided plans left calves out)
  ('Calf Raise', 'calves', NULL, 'machine', false),
  ('Leg Press Calf Raise', 'calves', NULL, 'machine', false),
  -- Core
  ('Crunch', 'core', NULL, 'bodyweight', false),
  ('Machine Crunch', 'core', NULL, 'machine', false),
  ('Hanging Knee Raise', 'core', NULL, 'bodyweight', false),
  ('Side Plank', 'core', NULL, 'bodyweight', false),
  ('Pallof Press', 'core', NULL, 'cable', false)
) AS v(name, muscle_group, muscle_group_secondary, equipment, is_compound)
WHERE NOT EXISTS (SELECT 1 FROM exercises e WHERE lower(e.name) = lower(v.name));

-- 1. Duplicates of a gym staple, and one niche rehab move, leave the picker.
UPDATE exercises SET retired_at = NOW()
WHERE retired_at IS NULL AND name IN (
  'Pull-ups',                                       -- Pull-Up
  'Face Pulls',                                     -- Face Pull
  'Lunges',                                         -- Lunge
  'Dumbbell Shoulder Press',                        -- Overhead Dumbbell Press
  'Parallel Bar Dips',                              -- Dips
  'Weighted Hip Thrusts',                           -- Hip Thrust
  'Hyperextension',                                 -- Weighted Hyperextension, 45° Back Extension
  'Side Lying External Rotation (with Dumbbells)'
);

-- 3. Bodyweight skills, holds, rehab and ring work that were filed as gym move
-- to the bodyweight skills section (they stay available there).
UPDATE exercises SET category = 'calisthenics'
WHERE category IS DISTINCT FROM 'calisthenics' AND name IN (
  'Ab Wheel Eccentric',
  'Ab Wheel Plus 20 Pounds',
  'Ab Wheel Ramp',
  'Active Deadhang',
  'Advanced Tuck Flag',
  'Advanced Tuck Rope Climb',
  'Ankle Weight Toes to Bar',
  'Back Kip to Cross',
  'Back Kip to L-Cross',
  'Back Kip to Support',
  'Bar Pull-up Eccentric',
  'Bent-Arm Bent-Body Press',
  'Bent-Arm Straight-Body Press',
  'Bodyweight Press',
  'Box Headstand Pushup',
  'Butterfly Mount',
  'Chair Illusion',
  'Chair Press',
  'Coppenhagen Holds',
  'Core Compressions',
  'Cross Progressions',
  'Cross Straight-Body Press',
  'Deadhang',
  'Dip Shrugs',
  'Distal Bicep Tendon Holds',
  'Dragon Press',
  'Elevated Matrix Squat',
  'Elevated Shoulder Hip Thrust',
  'Elevated Shoulder Single Leg Hip Thrust',
  'Elevated Straight Stand Straddle Press',
  'Elevator',
  'Feet Elevated Pelican Curl',
  'Felge Backward Pike to Support',
  'Felge Backward Straight to Support',
  'Felge Backward Straight-Arm to Cross',
  'Felge Backward Straight-Body to Support',
  'Felge Backward Tuck to Support',
  'Felge Forward Pike to Support',
  'Felge Forward Straight to Support',
  'Felge Forward Straight-Arm to Cross',
  'Felge Forward Tuck to Support',
  'Fingertip Push Ups',
  'Floor Straight Leg Raise',
  'Floor Tuck Raises',
  'Floor Victorian Cross One Forearm',
  'Floor Victorian Cross Straight Arms',
  'Floor Victorian Cross on Forearms',
  'Free Headstand Pushup',
  'Frog Stand',
  'Full Ab Wheel',
  'Full Flag',
  'Full Natural Hamstring Curl',
  'Full Reverse Hyperextension',
  'Full Squat',
  'Full Tuck Reverse Hyperextension',
  'German Hang',
  'German Hang Pullout',
  'Hamstring Curl with Arms Overhead',
  'Hand on Wrist Hefesto',
  'Hang Bent Leg Toes to Bar',
  'Hang Pull to Inverted',
  'Hang Straight Leg Toes to Bar',
  'Hefesto',
  'Hefesto Negative',
  'Hip Hinge with Vertical Thighs',
  'Impossible Dip',
  'Incline Pelican Curl',
  'Inverted Cross',
  'Inverted Deadlift',
  'Inverted Shrugs',
  'Inverted to Deadhang Eccentric',
  'Iron Cross Hold',
  'Iron Cross Pullouts',
  'Jump Pull-ups',
  'Kip Behind the Back Clap Pull-ups',
  'Kip Clap Pull-ups',
  'Kip Pull-ups',
  'Kip to Support',
  'Knees Ab Wheel',
  'Kowalik Dip',
  'L-Clap Pull-ups',
  'L-Dips',
  'L-Pull-ups',
  'L-Slap Abs Pull-ups',
  'L-Slap Thighs Pull-ups',
  'Maltese',
  'Manna',
  'Matrix Squat to Floor',
  'Natural Leg Extension',
  'Natural One Leg Extension',
  'Non-Kip Behind the Back Clap Pull-ups',
  'Non-Kip Clapping Pull-ups',
  'One Arm Ab Wheel',
  'One Arm Deadhang',
  'One Arm Dragon Press',
  'One Arm One Leg Plank',
  'One Arm Rows',
  'One Leg Matrix Squat to Floor',
  'One Leg Matrix Squat to Horizontal',
  'One Leg Sissy Squat to Horizontal Shin',
  'Parallel Bar Dips Eccentric',
  'Parallel Bar Jump Dips',
  'Parallel Squat',
  'Pelican Curl',
  'Pike Headstand Pushup',
  'Pinching Deadhang',
  'Protracted Victorian Cross on Bars',
  'Proximal Bicep Tendon Raises',
  'Pullover',
  'Regular Slap Thighs Pull-ups',
  'Reverse Nordic Curl',
  'Reverse Plank Holds',
  'Row Eccentric',
  'Scapular Pull-ups',
  'Side Plank with Abduction',
  'Side to Side Squat',
  'Single Leg Glute Bridge',
  'Single Leg Hamstring Slide',
  'Single Leg Hamstring Slide Eccentric',
  'Single Leg Hip Thrust',
  'Slow Eccentric Nordic Curl',
  'Straddle Flag',
  'Straddle One Arm Rows',
  'Straddle Stand Press',
  'Straight-Arm Back Kip to Support',
  'Straight-Arm Frog Stand',
  'Straight-Arm Kip to Cross',
  'Straight-Arm Kip to L-Cross',
  'Superman Holds',
  'Superman Rocks',
  'Support to Hang to Cross',
  'Tibialis Raises',
  'Tricep Extension Pushups',
  'Tricep Extension Tendon Holds',
  'Tricep Tendon Holds',
  'Tuck Flag',
  'Two Leg Hamstring Slide',
  'Victorian Cross on Bars',
  'Wall Headstand Pushup',
  'Wall Headstand Pushup Eccentric',
  'Wall Maltese Pushups',
  'Wall Straight Press Eccentric',
  'Weighted Hamstring Curl',
  'Weighted Reverse Hyperextension',
  'Wide Rows',
  'Wide Victorian Cross on Bars'
);

-- 4. Muscle values the app has no label, chip or volume target for.
UPDATE exercises SET muscle_group = 'core' WHERE name = 'Weighted Decline Sit-Up' AND muscle_group = 'abs';
UPDATE exercises SET muscle_group = 'glutes' WHERE name = 'Hip Adduction Machine' AND muscle_group = 'adductors';
UPDATE exercises SET muscle_group_secondary = 'hamstrings' WHERE name = 'Barbell Deadlift' AND muscle_group_secondary = 'legs';
UPDATE exercises SET muscle_group_secondary = NULL WHERE name = 'Hammer Curl' AND muscle_group_secondary = 'brachialis';

-- 5. Bodyweight skills nobody has used: never logged, in no program, no rest
-- preference, and in no saved day plan or flexible template (those keep ids
-- in JSON, with no foreign key). The first step of each main skill stays.
UPDATE exercises e SET retired_at = NOW()
WHERE e.retired_at IS NULL
  AND e.category = 'calisthenics'
  AND e.name NOT IN (
    'Australian Pull-ups', 'Ring Rows', 'Ring Dips', 'Pike Pushup', 'Wall Handstand',
    'Tuck L-Sit', 'L-Sit', 'Hollow Rock', 'Tuck Front Lever', 'Tuck Back Lever',
    'Tuck Planche', 'Skin the Cat', 'Strict Bar Muscle-up'
  )
  AND e.created_at < '2026-11-11'  -- the library as reviewed, never later customs
  AND NOT EXISTS (SELECT 1 FROM sets s WHERE s.exercise_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM split_exercises se WHERE se.exercise_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM exercise_rest_preferences r WHERE r.exercise_id = e.id)
  AND NOT EXISTS (
    SELECT 1 FROM workout_day_plans p,
      jsonb_array_elements(CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END) AS item
    WHERE item->>'exercise_id' = e.id::text
       OR item->'substitutes_for'->>'exercise_id' = e.id::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM flex_day_templates t,
      jsonb_array_elements(CASE WHEN jsonb_typeof(t.items) = 'array' THEN t.items ELSE '[]'::jsonb END) AS item
    WHERE item->>'exercise_id' = e.id::text
       OR item->'substitutes_for'->>'exercise_id' = e.id::text
  );
