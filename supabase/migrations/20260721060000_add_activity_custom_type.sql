-- User-named activity types. The activity_type enum stays closed so known
-- types keep their behaviour, icons, and grouping logic; custom_type carries
-- the user's own name when they pick 'other' (e.g. "Yoga", "Surfing").
ALTER TABLE activity_sessions
  ADD COLUMN IF NOT EXISTS custom_type TEXT;

-- Only meaningful alongside 'other', and keep it short enough to render.
ALTER TABLE activity_sessions
  DROP CONSTRAINT IF EXISTS activity_sessions_custom_type_check;

ALTER TABLE activity_sessions
  ADD CONSTRAINT activity_sessions_custom_type_check CHECK (
    custom_type IS NULL
    OR (activity_type = 'other' AND char_length(btrim(custom_type)) BETWEEN 1 AND 40)
  );
