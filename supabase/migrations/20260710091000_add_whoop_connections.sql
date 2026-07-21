-- WHOOP OAuth storage, split by sensitivity:
--   whoop_connections — safe metadata; the client may READ its own row to know
--                       "connected" status. Only the service role writes.
--   whoop_tokens      — OAuth tokens; RLS enabled with ZERO policies plus an
--                       explicit REVOKE so no client role can ever read them.
--                       Only Edge Functions using the service role touch them.

CREATE TABLE IF NOT EXISTS whoop_connections (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  whoop_user_id TEXT,
  scopes TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE whoop_connections ENABLE ROW LEVEL SECURITY;

-- read-only for the owner; no insert/update/delete policies on purpose
CREATE POLICY "Users can view own whoop connection" ON whoop_connections
  FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS whoop_tokens (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- zero policies: deny-by-default for anon/authenticated
ALTER TABLE whoop_tokens ENABLE ROW LEVEL SECURITY;

-- belt and braces on top of RLS
REVOKE ALL ON whoop_tokens FROM anon, authenticated;
