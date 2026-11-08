export type AuthScreen = 'boot' | 'offline' | 'sign-in' | 'new-password' | 'app';

/**
 * The top-level screen for the auth state. An offline restore waits for the
 * connection instead of showing sign-in, unless the person chose to sign in.
 * A password reset link signs in and asks for the new password first.
 */
export function authScreen(
  state: { initialized: boolean; user: unknown; reconnecting: boolean; passwordRecovery?: boolean },
  signInInstead = false,
): AuthScreen {
  if (!state.initialized) return 'boot';
  if (state.user) return state.passwordRecovery ? 'new-password' : 'app';
  if (state.reconnecting && !signInInstead) return 'offline';
  return 'sign-in';
}
