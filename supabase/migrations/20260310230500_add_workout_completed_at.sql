ALTER TABLE workouts
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

WITH completed_workouts AS (
  SELECT
    workouts.id,
    COALESCE(MAX(sets.completed_at), workouts.created_at) AS inferred_completed_at
  FROM workouts
  LEFT JOIN sets ON sets.workout_id = workouts.id
  WHERE workouts.completed = true
  GROUP BY workouts.id, workouts.created_at
)
UPDATE workouts
SET completed_at = completed_workouts.inferred_completed_at
FROM completed_workouts
WHERE workouts.id = completed_workouts.id
  AND workouts.completed_at IS NULL;
