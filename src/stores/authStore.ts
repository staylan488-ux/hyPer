import { create } from 'zustand';
import { isAuthRetryableFetchError, type User, type Session } from '@supabase/supabase-js';
import { getAuthRedirectTo, signInWithOAuthProvider } from '@/lib/nativeAuth';
import { hydratePhotoWorkerSettings } from '@/lib/photoAnalysis';
import { invalidateExerciseLibrary } from '@/lib/exerciseLibrary';
import { supabase } from '@/lib/supabase';
import { initialAppData, useAppStore } from '@/stores/appStore';

const EXISTING_ACCOUNT_SIGNUP_MESSAGE = 'This email already has an account. If you created it with Google, use Continue with Google. Otherwise sign in.';

type SignUpResult = {
  error: Error | null;
  existingAccount: boolean;
};

function isExistingAccountMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('already registered')
    || normalized.includes('already exists')
    || normalized.includes('already been registered')
    || normalized.includes('already used');
}

function isExistingAccountSignUpResponse(data: { user: User | null; session: Session | null }) {
  if (!data.user || data.session) {
    return false;
  }

  return Array.isArray(data.user.identities) && data.user.identities.length === 0;
}

// user id whose profile request is in flight; auth events for the same account
// (INITIAL_SESSION, TOKEN_REFRESHED, the SIGNED_IN on every foreground resume)
// skip the refetch while it runs or once the profile is loaded
let profileRequestFor: string | null = null;

// a password sign-in by an unconfirmed email emits SIGNED_IN before signIn
// rejects it and signs out; it must not take over the device AI settings
function isUnverifiedEmailUser(user: User) {
  return user.app_metadata?.provider === 'email' && !user.email_confirmed_at;
}

// clears the in-memory copy of the previous account's data; every set is
// already saved, and each screen's fetch rebuilds the store for the new user
function resetAppData() {
  useAppStore.setState(initialAppData);
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: { id: string; display_name: string | null } | null;
  loading: boolean;
  initialized: boolean;
  /** Offline cold start with a stored session whose access token expired:
   * the refresh token is intact, so wait for the connection instead of
   * presenting sign-in. Ends on SIGNED_OUT or any event with a session. */
  reconnecting: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<SignUpResult>;
  resendSignupConfirmation: (email: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  updateDisplayName: (displayName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  loading: true,
  initialized: false,
  reconnecting: false,

  initialize: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (session) {
      set({ session, user: session.user, loading: false, initialized: true });
      get().fetchProfile();
      // no-op when local settings exist; restores them after storage eviction
      if (!isUnverifiedEmailUser(session.user)) void hydratePhotoWorkerSettings(session.user.id);
    } else if (error && isAuthRetryableFetchError(error)) {
      // the refresh failed for lack of a network and auth-js kept the stored
      // session; its auto-refresh emits TOKEN_REFRESHED once the connection is
      // back. A non-retryable failure removes the session and signs out.
      set({ loading: false, initialized: true, reconnecting: true });
    } else {
      set({ loading: false, initialized: true });
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      // while reconnecting, the INITIAL_SESSION that follows the failed
      // restore carries no session; it is not a sign-out
      if (!session && event !== 'SIGNED_OUT' && get().reconnecting) return;
      if (get().reconnecting) set({ reconnecting: false });

      // compare user ids, never event names: TOKEN_REFRESHED and the SIGNED_IN
      // on every foreground resume keep the same id and the active workout
      const prevId = get().user?.id;
      set({ session, user: session?.user ?? null });
      if (prevId && prevId !== (session?.user?.id ?? null)) resetAppData();

      if (session?.user) {
        const userId = session.user.id;
        if (get().profile?.id !== userId && profileRequestFor !== userId) {
          get().fetchProfile();
        }
        if (!isUnverifiedEmailUser(session.user)) void hydratePhotoWorkerSettings(userId);
      } else {
        set({ profile: null });
      }
    });
  },

  fetchProfile: async () => {
    const { user } = get();
    if (!user) return;

    const userId = user.id;
    profileRequestFor = userId;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // a slow response for a previous account must not land after a switch
      if (!error && data && get().user?.id === data.id) {
        set({ profile: data });
      }
    } finally {
      if (profileRequestFor === userId) profileRequestFor = null;
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error && data.user && !data.user.email_confirmed_at) {
      await supabase.auth.signOut();
      invalidateExerciseLibrary();
      resetAppData();
      set({ loading: false, user: null, session: null, profile: null });
      return { error: new Error('Please verify your email before signing in.') };
    }

    set({ loading: false });
    return { error };
  },

  signUp: async (email: string, password: string, displayName?: string) => {
    set({ loading: true });
    const emailRedirectTo = getAuthRedirectTo();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    if (error) {
      set({ loading: false });

      if (isExistingAccountMessage(error.message)) {
        return { error: new Error(EXISTING_ACCOUNT_SIGNUP_MESSAGE), existingAccount: true };
      }

      return { error: new Error(error.message), existingAccount: false };
    }

    if (isExistingAccountSignUpResponse(data)) {
      set({ loading: false });
      return {
        error: new Error(EXISTING_ACCOUNT_SIGNUP_MESSAGE),
        existingAccount: true,
      };
    }

    set({ loading: false });
    return { error: null, existingAccount: false };
  },

  resendSignupConfirmation: async (email: string) => {
    set({ loading: true });
    const emailRedirectTo = getAuthRedirectTo();

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });

    set({ loading: false });
    return { error: error ? new Error(error.message) : null };
  },

  signInWithGoogle: async () => {
    return signInWithOAuthProvider('google');
  },

  signInWithApple: async () => {
    return signInWithOAuthProvider('apple');
  },

  updateDisplayName: async (displayName: string) => {
    const { user } = get();
    if (!user) {
      return { error: new Error('User not authenticated') };
    }

    const normalizedDisplayName = displayName.trim();

    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: normalizedDisplayName || null })
      .eq('id', user.id)
      .select('*')
      .single();

    if (error) {
      return { error: new Error(error.message) };
    }

    if (data) {
      set({ profile: data });
    }

    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    invalidateExerciseLibrary();
    resetAppData();
    set({ user: null, session: null, profile: null, reconnecting: false });
  },
}));
