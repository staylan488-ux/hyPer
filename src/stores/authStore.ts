import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const EXISTING_ACCOUNT_SIGNUP_MESSAGE = 'This email already has an account. If you created it with Google, use Continue with Google. Otherwise sign in.';

type SignUpResult = {
  error: Error | null;
  existingAccount: boolean;
};

function getAuthRedirectTo() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return undefined;
  }

  return `${window.location.origin}/`;
}

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

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: { id: string; display_name: string | null } | null;
  loading: boolean;
  initialized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<SignUpResult>;
  resendSignupConfirmation: (email: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
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

  initialize: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
      set({ session, user: session.user, loading: false, initialized: true });
      get().fetchProfile();
    } else {
      set({ loading: false, initialized: true });
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      set({ session, user: session?.user ?? null });
      
      if (session?.user) {
        get().fetchProfile();
      } else {
        set({ profile: null });
      }
    });
  },

  fetchProfile: async () => {
    const { user } = get();
    if (!user) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!error && data) {
      set({ profile: data });
    }
  },

  signIn: async (email: string, password: string) => {
    set({ loading: true });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error && data.user && !data.user.email_confirmed_at) {
      await supabase.auth.signOut();
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
    const redirectTo = getAuthRedirectTo();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        ...(redirectTo ? { redirectTo } : {}),
        skipBrowserRedirect: true,
      },
    });

    if (!error && data?.url) {
      window.location.assign(data.url);
    }

    return { error };
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
    set({ user: null, session: null, profile: null });
  },
}));
