export type AuthScreen = 'boot' | 'offline' | 'sign-in' | 'app';

/**
 * The top-level screen for the auth state. An offline restore waits for the
 * connection instead of showing sign-in, unless the person chose to sign in.
 */
export function authScreen(
  state: { initialized: boolean; user: unknown; reconnecting: boolean },
  signInInstead = false,
): AuthScreen {
  if (!state.initialized) return 'boot';
  if (state.user) return 'app';
  if (state.reconnecting && !signInInstead) return 'offline';
  return 'sign-in';
}
