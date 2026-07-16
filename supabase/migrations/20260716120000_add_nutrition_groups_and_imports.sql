-- Unified nutrition inbox: ordered meal/snack containers plus import provenance.
-- Additive only. Existing meal_type values remain readable for backward compatibility.

CREATE TABLE IF NOT EXISTS public.nutrition_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('meal', 'snack')),
  label TEXT CHECK (label IS NULL OR label IN ('breakfast', 'lunch', 'dinner')),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_groups_user_date
  ON public.nutrition_groups(user_id, date, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_groups_named_label
  ON public.nutrition_groups(user_id, date, label)
  WHERE label IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.nutrition_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('cronometer')),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_count INTEGER NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, file_hash)
);

ALTER TABLE public.foods
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_external_identity
  ON public.foods(user_id, external_source, external_id)
  WHERE user_id IS NOT NULL AND external_source IS NOT NULL AND external_id IS NOT NULL;

ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS group_id UUID,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES public.nutrition_import_batches(id) ON DELETE SET NULL;

-- Preserve the existing breakfast/lunch/dinner/snack organization on upgrade.
INSERT INTO public.nutrition_groups (user_id, date, kind, label, sort_order)
SELECT DISTINCT
  logs.user_id,
  logs.date,
  'meal',
  logs.meal_type,
  CASE logs.meal_type WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END
FROM public.nutrition_logs AS logs
WHERE logs.meal_type IN ('breakfast', 'lunch', 'dinner')
  AND NOT EXISTS (
    SELECT 1 FROM public.nutrition_groups AS groups
    WHERE groups.user_id = logs.user_id
      AND groups.date = logs.date
      AND groups.label = logs.meal_type
  );

INSERT INTO public.nutrition_groups (user_id, date, kind, label, sort_order)
SELECT DISTINCT logs.user_id, logs.date, 'snack', NULL, 3
FROM public.nutrition_logs AS logs
WHERE logs.meal_type = 'snack'
  AND NOT EXISTS (
    SELECT 1 FROM public.nutrition_groups AS groups
    WHERE groups.user_id = logs.user_id
      AND groups.date = logs.date
      AND groups.kind = 'snack'
      AND groups.label IS NULL
  );

UPDATE public.nutrition_logs AS logs
SET group_id = groups.id
FROM public.nutrition_groups AS groups
WHERE logs.group_id IS NULL
  AND groups.user_id = logs.user_id
  AND groups.date = logs.date
  AND (
    groups.label = logs.meal_type
    OR (logs.meal_type = 'snack' AND groups.kind = 'snack' AND groups.label IS NULL)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nutrition_logs_group_owner_fk'
  ) THEN
    ALTER TABLE public.nutrition_logs
      ADD CONSTRAINT nutrition_logs_group_owner_fk
      FOREIGN KEY (group_id, user_id)
      REFERENCES public.nutrition_groups(id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_group
  ON public.nutrition_logs(group_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nutrition_logs_external_identity
  ON public.nutrition_logs(user_id, source, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE public.nutrition_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own nutrition groups"
  ON public.nutrition_groups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own nutrition groups"
  ON public.nutrition_groups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own nutrition groups"
  ON public.nutrition_groups FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own nutrition groups"
  ON public.nutrition_groups FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own nutrition imports"
  ON public.nutrition_import_batches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own nutrition imports"
  ON public.nutrition_import_batches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own nutrition imports"
  ON public.nutrition_import_batches FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own nutrition imports"
  ON public.nutrition_import_batches FOR DELETE
  USING (auth.uid() = user_id);
