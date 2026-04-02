ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exercises'
      AND policyname = 'Authenticated users can view exercises'
  ) THEN
    CREATE POLICY "Authenticated users can view exercises"
      ON public.exercises
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exercises'
      AND policyname = 'Authenticated users can insert exercises'
  ) THEN
    CREATE POLICY "Authenticated users can insert exercises"
      ON public.exercises
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END
$$;
