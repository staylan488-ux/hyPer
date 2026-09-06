import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

const PREFERENCE_KEY = 'adaptive_split_scheduling';

/** Opt-out preference: old accounts, new accounts and missing values stay on. */
export function isAdaptiveSplitSchedulingEnabled(user: Pick<User, 'user_metadata'> | null): boolean {
  return user?.user_metadata?.[PREFERENCE_KEY] !== false;
}

/** The existing SDK persists updated user metadata with the account session. */
export async function saveAdaptiveSplitScheduling(enabled: boolean): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) throw new Error('Sign in to change your scheduling preference.');

  const { data, error } = await supabase.auth.updateUser({ data: { [PREFERENCE_KEY]: enabled } });
  if (error) throw error;
  if (data.user?.id !== userId || data.user.user_metadata?.[PREFERENCE_KEY] !== enabled) {
    throw new Error('The scheduling preference was not saved. Please try again.');
  }

  // USER_UPDATED normally refreshes the store. Also apply the confirmed field
  // immediately, without replacing newer profile metadata or another account.
  useAuthStore.setState((state) => {
    if (state.user?.id !== userId) return state;
    const user = { ...state.user, user_metadata: { ...state.user.user_metadata, [PREFERENCE_KEY]: enabled } };
    return {
      user,
      session: state.session?.user.id === userId ? { ...state.session, user } : state.session,
    };
  });
}
