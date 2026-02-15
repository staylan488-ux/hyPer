import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: { id: string; display_name: string | null } | null;
  loading: boolean;
  initialized: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    set({ loading: false });
    return { error };
  },

  signUp: async (email: string, password: string, displayName?: string) => {
    set({ loading: true });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
      },
    });
    set({ loading: false });
    return { error };
  },

  signInWithGoogle: async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/`,
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
