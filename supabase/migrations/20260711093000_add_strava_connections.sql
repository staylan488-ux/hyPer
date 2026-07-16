-- Strava OAuth storage, same split-by-sensitivity pattern as WHOOP:
--   strava_connections — safe metadata; owner may READ to know status.
--   strava_tokens      — OAuth tokens; zero policies + REVOKE, service role only.

CREATE TABLE IF NOT EXISTS strava_connections (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  strava_athlete_id TEXT,
  scopes TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strava_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strava connection" ON strava_connections
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS strava_tokens (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE strava_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON strava_tokens FROM anon, authenticated;
