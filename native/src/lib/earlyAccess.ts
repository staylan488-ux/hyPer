import { useAuthStore } from '@/stores/authStore';

/**
 * The early features: WHOOP, the Mac food worker and GPS runs. Only the
 * accounts from before public sign-up see them (the server's early_access),
 * so nobody else meets a feature that can't work for them yet.
 */
export function useEarlyAccess(): boolean {
  return useAuthStore((state) => Boolean(state.user) && state.earlyAccess);
}
