-- All new claims, quota slots and results live here, never in Storage.
-- The FK serializes inserts with account deletion: earlier writes cascade;
-- later writes fail, even if the Edge Function lost its response or crashed.
CREATE TABLE public.food_analysis_ledger (
  path TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  value JSONB NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  CONSTRAINT food_analysis_ledger_owner_path CHECK (path LIKE 'food-v1/' || user_id::text || '/%')
);

CREATE INDEX food_analysis_ledger_user_id_idx ON public.food_analysis_ledger(user_id);

ALTER TABLE public.food_analysis_ledger ENABLE ROW LEVEL SECURITY;
-- No client policies. Edge Functions alone read/insert; no quota upserts/refunds.
REVOKE ALL ON public.food_analysis_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.food_analysis_ledger TO service_role;
