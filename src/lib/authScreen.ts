import type { BetaAccess } from '@/lib/betaAccess';

export type AuthScreen = 'boot' | 'update' | 'offline' | 'sign-in' | 'new-password' | 'not-approved' | 'app';

/**
 * The top-level screen for the auth state. An offline restore waits for the
 * connection instead of showing sign-in, unless the person chose to sign in.
 * A password reset link signs in and asks for the new password first. An
 * account the server clearly says is not approved (private beta) sees the
 * not-on-the-list screen; an unknown answer keeps the app open. A build the
 * server no longer allows asks to be updated before anything else, signed in
 * or not.
 */
export function authScreen(
  state: { initialized: boolean; user: unknown; reconnecting: boolean; passwordRecovery?: boolean; betaAccess?: BetaAccess; updateRequired?: boolean },
  signInInstead = false,
): AuthScreen {
  if (!state.initialized) return 'boot';
  if (state.updateRequired) return 'update';
  if (state.user) {
    if (state.passwordRecovery) return 'new-password';
    return state.betaAccess === 'not-approved' ? 'not-approved' : 'app';
  }
  if (state.reconnecting && !signInInstead) return 'offline';
  return 'sign-in';
}
