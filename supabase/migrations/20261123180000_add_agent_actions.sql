-- Agent actions audit log: one row each time a connected AI agent writes to
-- hyPer via the MCP server (log/update/delete food, log body weight), storing
-- the exact before/after snapshot so the user can reverse any action with
-- 1-tap Undo in You > Connections.
--
-- The MCP server and app handle a missing table quietly: before this migration
-- runs, writes still succeed and the app simply shows no recent activity.
--
-- Each person sees and records only their own rows; nothing for signed-out
-- callers. A client can update only undone_at (Undo), never the audit payload.
-- Account deletion removes the rows (profiles -> auth.users cascades).
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- OAuth client_id from the agent's access token (matched to the connected agent name in-app).
  client_id TEXT CHECK (client_id IS NULL OR char_length(client_id) <= 200),
  agent_name TEXT CHECK (agent_name IS NULL OR char_length(agent_name) <= 120),
  tool_name TEXT NOT NULL CHECK (tool_name IN ('log_food', 'update_food_log', 'delete_food_log', 'log_body_weight')),
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 300),
  undo_payload JSONB NOT NULL CHECK (octet_length(undo_payload::TEXT) <= 65536),
  undone_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_actions_user_created_idx
  ON public.agent_actions(user_id, created_at DESC);

ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agent_actions TO authenticated;
GRANT UPDATE (undone_at) ON public.agent_actions TO authenticated;
GRANT ALL ON public.agent_actions TO service_role;

DROP POLICY IF EXISTS "Users can view own agent actions" ON public.agent_actions;
CREATE POLICY "Users can view own agent actions" ON public.agent_actions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert own agent actions" ON public.agent_actions;
CREATE POLICY "Users can insert own agent actions" ON public.agent_actions
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own agent actions" ON public.agent_actions;
CREATE POLICY "Users can update own agent actions" ON public.agent_actions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Approved accounts only, as every other app table, once the private beta
-- migration (20261109120000) has added is_approved_user. Before it, the
-- policies above already limit each person to their own rows.
DO $$
BEGIN
  IF to_regprocedure('public.is_approved_user()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Private beta: approved users only" ON public.agent_actions;
    CREATE POLICY "Private beta: approved users only" ON public.agent_actions
      AS RESTRICTIVE FOR ALL TO PUBLIC
      USING ((SELECT public.is_approved_user()))
      WITH CHECK ((SELECT public.is_approved_user()));
  END IF;
END
$$;
