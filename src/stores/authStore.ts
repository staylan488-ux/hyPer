import { create } from 'zustand';
import { isAuthRetryableFetchError, type User, type Session } from '@supabase/supabase-js';
import { getAuthRedirectTo, signInWithOAuthProvider } from '@/lib/nativeAuth';
import { hydratePhotoWorkerSettings } from '@/lib/photoAnalysis';
import { invalidateExerciseLibrary } from '@/lib/exerciseLibrary';
import { fetchAccountAccess, type BetaAccess } from '@/lib/betaAccess';
import { supabase } from '@/lib/supabase';
import { resetAppData } from '@/stores/appStore';

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

// user id whose private beta check is in flight
let betaAccessRequestFor: string | null = null;

// The accounts that keep WHOOP and the Mac worker, as the server last said,
// so an offline launch shows the same settings. Ids only; one per account.
const EARLY_ACCESS_KEY = 'hyper.early-access';

function storedEarlyAccess(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    const ids = JSON.parse(globalThis.localStorage?.getItem(EARLY_ACCESS_KEY) ?? '[]') as unknown;
    return Array.isArray(ids) && ids.includes(userId);
  } catch {
    return false;
  }
}

function storeEarlyAccess(userId: string, early: boolean) {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(EARLY_ACCESS_KEY) ?? '[]') as unknown;
    const ids = (Array.isArray(raw) ? raw : []).filter((id): id is string => typeof id === 'string' && id !== userId);
    if (early) ids.push(userId);
    globalThis.localStorage?.setItem(EARLY_ACCESS_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable: the answer still holds for this run
  }
}

// a password sign-in by an unconfirmed email emits SIGNED_IN before signIn
// rejects it and signs out; it must not take over the device AI settings
function isUnverifiedEmailUser(user: User) {
  return user.app_metadata?.provider === 'email' && !user.email_confirmed_at;
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
  /** Signed in by a password reset link: the app asks for a new password
   * before anything else. Ends when one is saved, the person skips it, or
   * they sign out. */
  passwordRecovery: boolean;
  /** Private beta: whether the server lists the signed-in account as approved.
   * 'unknown' (not asked yet, offline, any error) keeps the app open; only the
   * server's clear "no" for this account shows the not-on-the-list screen.
   * Reset whenever the account changes, so a switch never inherits an answer. */
  betaAccess: BetaAccess;
  /** WHOOP and the Mac food worker: only the accounts from before public
   * sign-up keep them (my_beta_access's early_access). The server's last
   * clear answer for this account, kept on the phone; false until one exists. */
  earlyAccess: boolean;
  /** Asks the server again; the not-on-the-list screen's Check again. */
  checkBetaAccess: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<SignUpResult>;
  resendSignupConfirmation: (email: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  updateDisplayName: (displayName: string) => Promise<{ error: Error | null }>;
  /** Emails a link that signs in on this device and asks for a new password. */
  requestPasswordReset: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  endPasswordRecovery: () => void;
  /** Deletes the account and all its data on the server, then signs out here. */
  deleteAccount: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  initialize: () => Promise<void>;
}

/**
 * Whether the server says the signed-in account no longer exists. A failed
 * or unclear answer (offline, a timeout, any other error) is "still there".
 */
async function accountIsGone(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.getUser();
    if (!error) return false;
    return error.code === 'user_not_found' || /sub claim in JWT does not exist/i.test(error.message ?? '');
  } catch {
    return false;
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  loading: true,
  initialized: false,
  reconnecting: false,
  passwordRecovery: false,
  betaAccess: 'unknown',
  earlyAccess: false,

  initialize: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (session) {
      set({ session, user: session.user, loading: false, initialized: true, earlyAccess: storedEarlyAccess(session.user.id) });
      get().fetchProfile();
      void get().checkBetaAccess();
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
      const nextId = session?.user?.id ?? null;
      set({ session, user: session?.user ?? null });
      if (prevId && prevId !== nextId) resetAppData();
      if (prevId !== nextId) set({ betaAccess: 'unknown', earlyAccess: storedEarlyAccess(nextId) });
      // A reset link's code was exchanged for a session: ask for the new
      // password. Any other account change ends a recovery in progress.
      if (event === 'PASSWORD_RECOVERY' && nextId) set({ passwordRecovery: true });
      else if (prevId !== nextId) set({ passwordRecovery: false });

      if (session?.user) {
        const userId = session.user.id;
        if (get().profile?.id !== userId && profileRequestFor !== userId) {
          get().fetchProfile();
        }
        // Asks again until approved: after an account change, after an
        // unclear answer, and on every return to the app (its SIGNED_IN), so
        // someone approved meanwhile gets in without signing in again.
        if (get().betaAccess !== 'approved') void get().checkBetaAccess();
        if (!isUnverifiedEmailUser(session.user)) void hydratePhotoWorkerSettings(userId);
      } else {
        set({ profile: null, betaAccess: 'unknown', earlyAccess: false });
      }
    });
  },

  checkBetaAccess: async () => {
    const { user } = get();
    if (!user || isUnverifiedEmailUser(user)) return;
    const userId = user.id;
    if (betaAccessRequestFor === userId) return;
    betaAccessRequestFor = userId;
    try {
      const { access, earlyAccess } = await fetchAccountAccess(userId, () => supabase.rpc('my_beta_access'));
      // An unclear answer never overwrites a clear one, and a slow answer for
      // a previous account never lands after a switch.
      if (access !== 'unknown' && get().user?.id === userId) {
        set({ betaAccess: access, ...(earlyAccess === null ? {} : { earlyAccess }) });
        if (earlyAccess !== null) storeEarlyAccess(userId, earlyAccess);
      }
    } finally {
      if (betaAccessRequestFor === userId) betaAccessRequestFor = null;
    }
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

  requestPasswordReset: async (email: string) => {
    const redirectTo = getAuthRedirectTo();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      ...(redirectTo ? { redirectTo } : {}),
    });
    return { error: error ? new Error(error.message) : null };
  },

  updatePassword: async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { error: new Error(error.message) };
    set({ passwordRecovery: false });
    return { error: null };
  },

  endPasswordRecovery: () => set({ passwordRecovery: false }),

  deleteAccount: async () => {
    if (!get().user) return { error: new Error('User not authenticated') };
    const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error || !(data as { ok?: boolean } | null)?.ok) {
      // The answer can be lost after the server finished (the connection
      // dropped, the app was left). Every retry is then refused, since the
      // sign-in is gone, so the server is asked whether the account still
      // exists; only its own "no such user" counts as deleted.
      if (!(await accountIsGone())) return { error: new Error(error?.message ?? 'Could not delete the account.') };
    }
    // The account is gone on the server, so only this device's session is
    // left to clear; a global sign-out would be refused.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    invalidateExerciseLibrary();
    resetAppData();
    set({ user: null, session: null, profile: null, reconnecting: false, passwordRecovery: false, betaAccess: 'unknown', earlyAccess: false });
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    invalidateExerciseLibrary();
    resetAppData();
    set({ user: null, session: null, profile: null, reconnecting: false, passwordRecovery: false, betaAccess: 'unknown', earlyAccess: false });
  },
}));
