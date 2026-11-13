-- Muscle tags that distorted weekly sets per muscle (training science audit,
-- 2026-11-13). Data only: no table, column or policy changes, and no row is
-- added, renamed or removed. Each statement names the value it expects, so
-- it does nothing to a row already fixed or tagged some other way, and the
-- file is safe to run more than once.
--
-- "adductors" and "lower_back" are muscles the app now names
-- (src/types/index.ts, MUSCLE_GROUP_LABELS). The adductor machine was filed
-- under glutes by 20261111110000 only because the app had no adductor muscle
-- then.

-- The inner thigh machine is not glute work.
UPDATE exercises SET muscle_group = 'adductors'
WHERE name = 'Hip Adduction Machine' AND muscle_group = 'glutes';

-- A back extension is a hip hinge: glutes with hamstrings second, the same
-- as its twin "45° Back Extension". It counted as a back set equal to a row.
UPDATE exercises SET muscle_group = 'glutes', muscle_group_secondary = 'hamstrings'
WHERE name IN ('Weighted Hyperextension', 'Hyperextension') AND muscle_group = 'back';

-- A deadlift counted as lat and upper-back work.
UPDATE exercises SET muscle_group = 'glutes', muscle_group_secondary = 'hamstrings'
WHERE name = 'Barbell Deadlift' AND muscle_group = 'back';

-- Every other row gives biceps half a set; this one gave them none.
UPDATE exercises SET muscle_group_secondary = 'biceps'
WHERE name = 'Chest-Supported Row' AND muscle_group = 'back' AND muscle_group_secondary IS NULL;

-- Spellings of the two new muscles, should the library hold any.
UPDATE exercises SET muscle_group = 'lower_back' WHERE muscle_group IN ('lower back', 'erectors', 'spinal erectors');
UPDATE exercises SET muscle_group_secondary = 'lower_back' WHERE muscle_group_secondary IN ('lower back', 'erectors', 'spinal erectors');
UPDATE exercises SET muscle_group_secondary = 'adductors' WHERE muscle_group_secondary IN ('adductor', 'inner thigh');
