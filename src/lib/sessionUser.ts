import { supabase } from '@/lib/supabase';

/**
 * The signed-in user's id from the stored session, for queries and inserts
 * that only need the id (RLS enforces ownership on every request anyway).
 *
 * Unlike auth.getUser() this makes no request to Supabase Auth unless the
 * access token needs a refresh, which the query would trigger regardless.
 * An expired session whose refresh fails comes back null, so callers keep
 * their signed-out early return. Never substitute the auth store's user id:
 * it outlives such a session, and a query sent with the anon key would get
 * empty RLS results (clearing an active workout, for example).
 *
 * Keep auth.getUser() where server-validated identity or user metadata
 * matters (account-changed checks, user_metadata or email reads).
 */
export async function getSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
