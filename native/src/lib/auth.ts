import { create } from 'zustand';

import { authScreen, type AuthScreen } from '@/lib/authScreen';
import { isInviteRefusal } from '@/lib/betaAccess';
import { useAuthStore } from '@/stores/authStore';

/**
 * "Sign in instead" on the offline screen. Kept for this launch only, and it
 * never signs out, so the saved session stays.
 */
export const useSignInInstead = create<{ chosen: boolean; choose: () => void }>((set) => ({
  chosen: false,
  choose: () => set({ chosen: true }),
}));

/** A sign-up (email, Google or Apple) the invite list refused. */
export const INVITE_ONLY_WORDS = 'hyPer is invite-only for now. Use the email your invite was sent to.';

/** Which top-level screen the auth state calls for (the shared src/lib/authScreen rule). */
export function useAuthScreen(): AuthScreen {
  const initialized = useAuthStore((state) => state.initialized);
  const user = useAuthStore((state) => state.user);
  const reconnecting = useAuthStore((state) => state.reconnecting);
  const passwordRecovery = useAuthStore((state) => state.passwordRecovery);
  const betaAccess = useAuthStore((state) => state.betaAccess);
  const signInInstead = useSignInInstead((state) => state.chosen);
  return authScreen({ initialized, user, reconnecting, passwordRecovery, betaAccess }, signInInstead);
}

/**
 * The server's words for the common failures, said plainly: a wrong email or
 * password, an email the invite list refused, and no connection. Anything else
 * shows as the server wrote it.
 */
export function authErrorWords(message: string): string {
  if (isInviteRefusal(message)) return INVITE_ONLY_WORDS;
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match. Check them and try again.';
  if (/rate limit|only request this after|too many requests/i.test(message)) return 'Too many tries for now. Wait a minute, then try again.';
  if (/should be different from the old password/i.test(message)) return 'That’s your current password. Choose a new one.';
  if (/failed to fetch|network request failed|network error|timed? ?out/i.test(message)) return 'Couldn’t reach hyPer. Check your connection and try again.';
  return message;
}
