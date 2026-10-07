import type { BetaAccess } from '@/lib/betaAccess';

export type AuthScreen = 'boot' | 'offline' | 'sign-in' | 'private-beta' | 'app';

/**
 * The top-level screen for the auth state. An offline restore waits for the
 * connection instead of showing sign-in, unless the person chose to sign in.
 * A signed-in account the server reports as not approved sees the private-beta
 * screen; an unknown answer (offline, still checking) keeps the app open.
 */
export function authScreen(
  state: { initialized: boolean; user: unknown; reconnecting: boolean; betaAccess?: BetaAccess },
  signInInstead = false,
): AuthScreen {
  if (!state.initialized) return 'boot';
  if (state.user) return state.betaAccess === 'not-approved' ? 'private-beta' : 'app';
  if (state.reconnecting && !signInInstead) return 'offline';
  return 'sign-in';
}
