import { create } from 'zustand';

import { authScreen, type AuthScreen } from '@/lib/authScreen';
import { useAuthStore } from '@/stores/authStore';

/**
 * "Sign in instead" on the offline screen. Kept for this launch only, as on
 * the web, and it never signs out, so the saved session stays.
 */
export const useSignInInstead = create<{ chosen: boolean; choose: () => void }>((set) => ({
  chosen: false,
  choose: () => set({ chosen: true }),
}));

/** Which top-level screen the auth state calls for (the web app's rule). */
export function useAuthScreen(): AuthScreen {
  const initialized = useAuthStore((state) => state.initialized);
  const user = useAuthStore((state) => state.user);
  const reconnecting = useAuthStore((state) => state.reconnecting);
  const signInInstead = useSignInInstead((state) => state.chosen);
  return authScreen({ initialized, user, reconnecting }, signInInstead);
}
