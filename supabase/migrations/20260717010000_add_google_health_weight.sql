-- Body measurements imported through Google Health. OAuth tokens remain
-- service-role-only in a separate table and never reach the browser.

CREATE TABLE IF NOT EXISTS public.google_health_connections (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  health_user_id TEXT,
  scopes TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.google_health_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own Google Health connection"
  ON public.google_health_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.google_health_tokens (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scopes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.google_health_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_health_tokens FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.body_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  weight_kg DECIMAL(7,3) NOT NULL CHECK (weight_kg > 0 AND weight_kg < 700),
  body_fat_percent DECIMAL(5,2) CHECK (body_fat_percent > 0 AND body_fat_percent < 100),
  source TEXT NOT NULL CHECK (source IN ('manual', 'google_health')),
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_measurements_user_time
  ON public.body_measurements(user_id, measured_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_body_measurements_external_identity
  ON public.body_measurements(user_id, source, external_id);

ALTER TABLE public.body_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own body measurements"
  ON public.body_measurements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own manual body measurements"
  ON public.body_measurements FOR INSERT
  WITH CHECK (auth.uid() = user_id AND source = 'manual');
CREATE POLICY "Users can update own manual body measurements"
  ON public.body_measurements FOR UPDATE
  USING (auth.uid() = user_id AND source = 'manual')
  WITH CHECK (auth.uid() = user_id AND source = 'manual');
CREATE POLICY "Users can delete own body measurements"
  ON public.body_measurements FOR DELETE USING (auth.uid() = user_id);
