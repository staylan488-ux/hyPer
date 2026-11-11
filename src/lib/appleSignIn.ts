import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * After a Sign in with Apple, hands Apple's refresh token to the server, so
 * that deleting the account can tell Apple to drop hyPer (delete-account
 * revokes it). Supabase passes the token back only once, in the session that
 * the sign-in's code was exchanged for. The server keeps it out of the app's
 * reach and accepts it only from an account with an Apple sign-in.
 *
 * Best-effort and never awaited by sign-in: a failure only means a later
 * deletion cannot revoke, and the next Apple sign-in tries again.
 */
export async function rememberAppleRefreshToken(provider: string, session: Session | null | undefined): Promise<void> {
  const token = session?.provider_refresh_token;
  if (provider !== 'apple' || !token) return;
  try {
    await supabase.rpc('save_apple_refresh_token', { p_refresh_token: token });
  } catch {
    // Offline or an older backend without the function: nothing to do.
  }
}
