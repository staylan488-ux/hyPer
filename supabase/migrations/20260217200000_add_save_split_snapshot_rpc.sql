-- Atomic RPC to save an entire split snapshot (name, days, exercises) in one transaction.
-- The client sends the full desired state; the function reconciles via upsert + delete.

CREATE OR REPLACE FUNCTION public.save_split_snapshot(
  p_split_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_days_per_week INTEGER,
  p_days JSONB  -- array of { id?, day_name, day_order, exercises: [{ id?, exercise_id, target_sets, target_reps_min, target_reps_max, exercise_order, notes? }] }
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_day JSONB;
  v_exercise JSONB;
  v_day_id UUID;
  v_exercise_id UUID;
  v_kept_day_ids UUID[] := '{}';
  v_kept_exercise_ids UUID[] := '{}';
BEGIN
  -- Verify ownership
  SELECT user_id INTO v_user_id
  FROM splits
  WHERE id = p_split_id;

  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- 1. Update split top-level fields
  UPDATE splits
  SET name = p_name,
      description = p_description,
      days_per_week = p_days_per_week
  WHERE id = p_split_id;

  -- 2. Upsert days and exercises
  FOR v_day IN SELECT * FROM jsonb_array_elements(p_days)
  LOOP
    -- Upsert day
    IF v_day->>'id' IS NOT NULL AND (v_day->>'id')::UUID IN (
      SELECT id FROM split_days WHERE split_id = p_split_id
    ) THEN
      -- Update existing day
      v_day_id := (v_day->>'id')::UUID;
      UPDATE split_days
      SET day_name = v_day->>'day_name',
          day_order = (v_day->>'day_order')::INTEGER
      WHERE id = v_day_id AND split_id = p_split_id;
    ELSE
      -- Insert new day
      INSERT INTO split_days (split_id, day_name, day_order)
      VALUES (p_split_id, v_day->>'day_name', (v_day->>'day_order')::INTEGER)
      RETURNING id INTO v_day_id;
    END IF;

    v_kept_day_ids := array_append(v_kept_day_ids, v_day_id);

    -- Upsert exercises for this day
    FOR v_exercise IN SELECT * FROM jsonb_array_elements(v_day->'exercises')
    LOOP
      IF v_exercise->>'id' IS NOT NULL AND (v_exercise->>'id')::UUID IN (
        SELECT id FROM split_exercises WHERE split_day_id = v_day_id
      ) THEN
        -- Update existing exercise
        v_exercise_id := (v_exercise->>'id')::UUID;
        UPDATE split_exercises
        SET exercise_id = (v_exercise->>'exercise_id')::UUID,
            target_sets = (v_exercise->>'target_sets')::INTEGER,
            target_reps_min = (v_exercise->>'target_reps_min')::INTEGER,
            target_reps_max = (v_exercise->>'target_reps_max')::INTEGER,
            exercise_order = (v_exercise->>'exercise_order')::INTEGER,
            notes = v_exercise->>'notes'
        WHERE id = v_exercise_id;
      ELSE
        -- Insert new exercise
        INSERT INTO split_exercises (split_day_id, exercise_id, target_sets, target_reps_min, target_reps_max, exercise_order, notes)
        VALUES (
          v_day_id,
          (v_exercise->>'exercise_id')::UUID,
          (v_exercise->>'target_sets')::INTEGER,
          (v_exercise->>'target_reps_min')::INTEGER,
          (v_exercise->>'target_reps_max')::INTEGER,
          (v_exercise->>'exercise_order')::INTEGER,
          v_exercise->>'notes'
        )
        RETURNING id INTO v_exercise_id;
      END IF;

      v_kept_exercise_ids := array_append(v_kept_exercise_ids, v_exercise_id);
    END LOOP;

    -- Delete exercises that were removed from this day
    DELETE FROM split_exercises
    WHERE split_day_id = v_day_id
      AND id != ALL(v_kept_exercise_ids);
  END LOOP;

  -- 3. Delete days that were removed from the split
  DELETE FROM split_days
  WHERE split_id = p_split_id
    AND id != ALL(v_kept_day_ids);
END;
$$;
