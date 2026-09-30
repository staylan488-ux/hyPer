import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resend: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { useAuthStore } from '@/stores/authStore';
import { authScreen } from '@/lib/authScreen';
import { initialAppData, useAppStore } from '@/stores/appStore';

type Profile = {
  id: string;
  display_name: string | null;
};

function createProfilesChain(profile: Profile | null) {
  const chain = {
    update: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
  };

  chain.update.mockImplementation(() => chain);
  chain.select.mockImplementation(() => chain);
  chain.eq.mockImplementation(() => chain);
  chain.single.mockResolvedValue({ data: profile, error: null });

  return chain;
}

beforeEach(() => {
  supabaseMock.from.mockReset();
  supabaseMock.auth.getSession.mockReset();
  supabaseMock.auth.onAuthStateChange.mockReset();
  supabaseMock.auth.signOut.mockReset();
  supabaseMock.auth.signInWithPassword.mockReset();
  supabaseMock.auth.signUp.mockReset();
  supabaseMock.auth.resend.mockReset();

  useAuthStore.setState({
    user: null,
    session: null,
    profile: null,
    loading: true,
    initialized: false,
    reconnecting: false,
  });
});

describe('auth session must-work behavior', () => {
  it('restores existing session on initialize', async () => {
    const session = { user: { id: 'user-1' } } as { user: { id: string } };
    const profile = { id: 'user-1', display_name: 'Vibe Lifter' };

    supabaseMock.auth.getSession.mockResolvedValue({ data: { session } });
    supabaseMock.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    const profilesChain = createProfilesChain(profile);
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'profiles') return profilesChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAuthStore.getState().initialize();

    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile).toEqual(profile);
    });

    const state = useAuthStore.getState();
    expect(state.session).toEqual(session);
    expect(state.user?.id).toBe(session.user.id);
    expect(state.initialized).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('updates state from auth events after initialize', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
    supabaseMock.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });

    const profilesChain = createProfilesChain({ id: 'user-2', display_name: 'Session Test' });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'profiles') return profilesChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAuthStore.getState().initialize();
    expect(useAuthStore.getState().initialized).toBe(true);
    expect(useAuthStore.getState().user).toBeNull();

    const authCallback = supabaseMock.auth.onAuthStateChange.mock.calls[0]?.[0] as
      | ((event: string, session: { user: { id: string } } | null) => void)
      | undefined;

    if (!authCallback) {
      throw new Error('Expected auth callback to be registered');
    }

    authCallback('SIGNED_IN', { user: { id: 'user-2' } });

    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile).toEqual({ id: 'user-2', display_name: 'Session Test' });
    });

    authCallback('SIGNED_OUT', null);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
  });

  it('clears local session state on sign out', async () => {
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });

    useAuthStore.setState({
      user: { id: 'user-9' } as never,
      session: { access_token: 'token' } as never,
      profile: { id: 'user-9', display_name: 'Loaded User' },
      loading: false,
      initialized: true,
    });

    await useAuthStore.getState().signOut();

    const state = useAuthStore.getState();
    expect(supabaseMock.auth.signOut).toHaveBeenCalledTimes(1);
    expect(state.user).toBeNull();
    expect(state.session).toBeNull();
    expect(state.profile).toBeNull();
  });

  it('blocks password sign-in when email is unverified', async () => {
    supabaseMock.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-3', email_confirmed_at: null } },
      error: null,
    });
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });

    const result = await useAuthStore.getState().signIn('new@user.com', 'password123');

    expect(result.error?.message).toBe('Please verify your email before signing in.');
    expect(supabaseMock.auth.signOut).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('flags an obfuscated existing-account signup response as an existing account', async () => {
    supabaseMock.auth.signUp.mockResolvedValue({
      data: {
        user: {
          id: 'user-4',
          identities: [],
        },
        session: null,
      },
      error: null,
    });

    const result = await useAuthStore.getState().signUp('google-user@example.com', 'password123', 'Alex');

    expect(result.existingAccount).toBe(true);
    expect(result.error?.message).toBe(
      'This email already has an account. If you created it with Google, use Continue with Google. Otherwise sign in.',
    );
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('maps duplicate signup errors to the existing-account guidance', async () => {
    supabaseMock.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    });

    const result = await useAuthStore.getState().signUp('existing-user@example.com', 'password123', 'Alex');

    expect(result.existingAccount).toBe(true);
    expect(result.error?.message).toBe(
      'This email already has an account. If you created it with Google, use Continue with Google. Otherwise sign in.',
    );
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('keeps a real signup response as a verification flow', async () => {
    supabaseMock.auth.signUp.mockResolvedValue({
      data: {
        user: {
          id: 'user-5',
          identities: [{ identity_id: 'identity-1' }],
        },
        session: null,
      },
      error: null,
    });

    const result = await useAuthStore.getState().signUp('new-user@example.com', 'password123', 'Alex');

    expect(result).toEqual({ error: null, existingAccount: false });
    expect(useAuthStore.getState().loading).toBe(false);
  });

  it('updates display name and syncs profile state', async () => {
    const updatedProfile = { id: 'user-1', display_name: 'New Name' };
    const profilesChain = createProfilesChain(updatedProfile);

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'profiles') return profilesChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    useAuthStore.setState({
      user: { id: 'user-1' } as never,
      profile: { id: 'user-1', display_name: 'Old Name' },
      loading: false,
      initialized: true,
    });

    const result = await useAuthStore.getState().updateDisplayName('  New Name  ');

    expect(result.error).toBeNull();
    expect(profilesChain.update).toHaveBeenCalledWith({ display_name: 'New Name' });
    expect(profilesChain.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(useAuthStore.getState().profile).toEqual(updatedProfile);
  });
});

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function profilesByUser(results: Record<string, () => Promise<{ data: Profile | null; error: unknown }>>) {
  const requested: string[] = [];
  supabaseMock.from.mockImplementation((table: string) => {
    if (table !== 'profiles') throw new Error(`Unexpected table: ${table}`);
    let id = '';
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((_column: string, value: string) => { id = value; return chain; }),
      single: vi.fn(() => { requested.push(id); return results[id](); }),
    };
    return chain;
  });
  return requested;
}

async function initializeWith(session: { user: { id: string } } | null) {
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
  supabaseMock.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  await useAuthStore.getState().initialize();
  const callback = supabaseMock.auth.onAuthStateChange.mock.calls[0]?.[0] as AuthCallback | undefined;
  if (!callback) throw new Error('Expected auth callback to be registered');
  return callback;
}

describe('profile fetch dedupe across auth events', () => {
  it('fetches the profile once when INITIAL_SESSION repeats the restored session', async () => {
    const requested = profilesByUser({
      'user-1': async () => ({ data: { id: 'user-1', display_name: 'One' }, error: null }),
    });
    const session = { user: { id: 'user-1' } };
    const callback = await initializeWith(session);
    callback('INITIAL_SESSION', session);

    await vi.waitFor(() => expect(useAuthStore.getState().profile?.display_name).toBe('One'));
    expect(requested).toEqual(['user-1']);
  });

  it('skips the refetch on SIGNED_IN/TOKEN_REFRESHED for the same user but still replaces the session', async () => {
    const requested = profilesByUser({
      'user-1': async () => ({ data: { id: 'user-1', display_name: 'One' }, error: null }),
    });
    const callback = await initializeWith({ user: { id: 'user-1' } });
    await vi.waitFor(() => expect(useAuthStore.getState().profile).not.toBeNull());

    const refreshed = { user: { id: 'user-1' }, access_token: 'next' };
    callback('TOKEN_REFRESHED', refreshed);
    expect(useAuthStore.getState().session).toBe(refreshed);
    expect(useAuthStore.getState().user).toBe(refreshed.user);
    const resumed = { user: { id: 'user-1' }, access_token: 'resume' };
    callback('SIGNED_IN', resumed);
    expect(useAuthStore.getState().session).toBe(resumed);

    await Promise.resolve();
    expect(requested).toEqual(['user-1']);
  });

  it('refetches after sign-out and sign-in for the same user', async () => {
    const requested = profilesByUser({
      'user-1': async () => ({ data: { id: 'user-1', display_name: 'One' }, error: null }),
    });
    const callback = await initializeWith({ user: { id: 'user-1' } });
    await vi.waitFor(() => expect(useAuthStore.getState().profile).not.toBeNull());

    callback('SIGNED_OUT', null);
    expect(useAuthStore.getState().profile).toBeNull();
    callback('SIGNED_IN', { user: { id: 'user-1' } });

    await vi.waitFor(() => expect(useAuthStore.getState().profile?.display_name).toBe('One'));
    expect(requested).toEqual(['user-1', 'user-1']);
  });

  it('keeps the new account profile when the previous account response lands late', async () => {
    const slow = deferred<{ data: Profile | null; error: unknown }>();
    profilesByUser({
      'user-1': () => slow.promise,
      'user-2': async () => ({ data: { id: 'user-2', display_name: 'Two' }, error: null }),
    });
    const callback = await initializeWith({ user: { id: 'user-1' } });

    callback('SIGNED_IN', { user: { id: 'user-2' } });
    await vi.waitFor(() => expect(useAuthStore.getState().profile?.display_name).toBe('Two'));
    slow.resolve({ data: { id: 'user-1', display_name: 'One' }, error: null });
    await slow.promise;
    await Promise.resolve();

    expect(useAuthStore.getState().profile).toEqual({ id: 'user-2', display_name: 'Two' });
  });

  it('retries on the next event after a failed profile fetch', async () => {
    let attempt = 0;
    const requested = profilesByUser({
      'user-1': async () => (attempt++ === 0
        ? { data: null, error: { message: 'offline' } }
        : { data: { id: 'user-1', display_name: 'One' }, error: null }),
    });
    const callback = await initializeWith({ user: { id: 'user-1' } });
    await vi.waitFor(() => expect(requested).toHaveLength(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().profile).toBeNull();

    callback('TOKEN_REFRESHED', { user: { id: 'user-1' } });
    await vi.waitFor(() => expect(useAuthStore.getState().profile?.display_name).toBe('One'));
    expect(requested).toEqual(['user-1', 'user-1']);
  });
});

describe('in-memory app data on account change', () => {
  const accountData = {
    currentWorkout: {
      id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-09-30',
      notes: null, completed: false, sets: [],
    },
    macroTarget: { id: 'target-1', user_id: 'user-1', calories: 2500, protein: 180, carbs: 250, fat: 80 },
    splits: [{ id: 'split-1' }],
    whoopConnection: { user_id: 'user-1' },
  } as never;

  async function signedInWithData() {
    profilesByUser({
      'user-1': async () => ({ data: { id: 'user-1', display_name: 'One' }, error: null }),
      'user-2': async () => ({ data: { id: 'user-2', display_name: 'Two' }, error: null }),
    });
    const callback = await initializeWith({ user: { id: 'user-1' } });
    useAppStore.setState(accountData);
    return callback;
  }

  it('keeps the active workout and targets through refreshes and foreground sign-ins', async () => {
    const callback = await signedInWithData();
    callback('INITIAL_SESSION', { user: { id: 'user-1' } });
    callback('TOKEN_REFRESHED', { user: { id: 'user-1' } });
    callback('SIGNED_IN', { user: { id: 'user-1' } });
    callback('USER_UPDATED', { user: { id: 'user-1' } });

    const state = useAppStore.getState();
    expect(state.currentWorkout?.id).toBe('workout-1');
    expect(state.macroTarget?.calories).toBe(2500);
    expect(state.splits).toHaveLength(1);
  });

  it('resets the data fields when a different account signs in', async () => {
    const callback = await signedInWithData();
    callback('SIGNED_IN', { user: { id: 'user-2' } });

    const state = useAppStore.getState();
    for (const [key, value] of Object.entries(initialAppData)) {
      expect(state[key as keyof typeof initialAppData]).toEqual(value);
    }
  });

  it('resets the data fields when the session ends', async () => {
    const callback = await signedInWithData();
    callback('SIGNED_OUT', null);

    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().macroTarget).toBeNull();
  });

  it('leaves the data alone when a session starts from signed out', async () => {
    profilesByUser({
      'user-1': async () => ({ data: { id: 'user-1', display_name: 'One' }, error: null }),
    });
    const callback = await initializeWith(null);
    useAppStore.setState(accountData);
    callback('INITIAL_SESSION', null);
    callback('SIGNED_IN', { user: { id: 'user-1' } });

    expect(useAppStore.getState().currentWorkout?.id).toBe('workout-1');
  });

  it('resets the data fields on an explicit sign-out', async () => {
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });
    useAuthStore.setState({ user: { id: 'user-1' } as never, session: {} as never });
    useAppStore.setState(accountData);

    await useAuthStore.getState().signOut();

    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().whoopConnection).toBeNull();
  });
});

describe('offline restore with an expired access token', () => {
  const screen = (signInInstead = false) => authScreen(useAuthStore.getState(), signInInstead);

  async function initializeWithError(error: Error | null) {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error });
    supabaseMock.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    await useAuthStore.getState().initialize();
    const callback = supabaseMock.auth.onAuthStateChange.mock.calls[0]?.[0] as AuthCallback | undefined;
    if (!callback) throw new Error('Expected auth callback to be registered');
    return callback;
  }

  it('waits for the connection instead of showing sign-in', async () => {
    await initializeWithError(new AuthRetryableFetchError('Failed to fetch', 0));

    const state = useAuthStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.user).toBeNull();
    expect(state.reconnecting).toBe(true);
    expect(screen()).toBe('offline');
    // "Sign in instead" is a local choice only
    expect(screen(true)).toBe('sign-in');
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
  });

  it('ignores the empty INITIAL_SESSION and opens the app when the refresh succeeds', async () => {
    const requested = profilesByUser({
      'user-1': async () => ({ data: { id: 'user-1', display_name: 'One' }, error: null }),
    });
    const callback = await initializeWithError(new AuthRetryableFetchError('Failed to fetch', 0));

    callback('INITIAL_SESSION', null);
    expect(useAuthStore.getState().reconnecting).toBe(true);
    expect(screen()).toBe('offline');

    callback('TOKEN_REFRESHED', { user: { id: 'user-1' } });
    expect(useAuthStore.getState().reconnecting).toBe(false);
    expect(useAuthStore.getState().user?.id).toBe('user-1');
    expect(screen()).toBe('app');
    await vi.waitFor(() => expect(useAuthStore.getState().profile?.display_name).toBe('One'));
    expect(requested).toEqual(['user-1']);
  });

  it('shows sign-in when auth-js signs out while reconnecting', async () => {
    const callback = await initializeWithError(new AuthRetryableFetchError('Failed to fetch', 0));

    callback('SIGNED_OUT', null);
    expect(useAuthStore.getState().reconnecting).toBe(false);
    expect(useAuthStore.getState().profile).toBeNull();
    expect(screen()).toBe('sign-in');
  });

  it('shows sign-in straight away without a stored session', async () => {
    await initializeWithError(null);
    expect(useAuthStore.getState().reconnecting).toBe(false);
    expect(screen()).toBe('sign-in');
  });

  it('shows sign-in after a non-retryable refresh failure', async () => {
    await initializeWithError(new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'));
    expect(useAuthStore.getState().reconnecting).toBe(false);
    expect(screen()).toBe('sign-in');
  });

  it('still opens straight into the app with a valid stored session', async () => {
    profilesByUser({
      'user-1': async () => ({ data: { id: 'user-1', display_name: 'One' }, error: null }),
    });
    await initializeWith({ user: { id: 'user-1' } });
    expect(useAuthStore.getState().reconnecting).toBe(false);
    expect(screen()).toBe('app');
  });

  it('shows the splash until initialized', () => {
    expect(screen()).toBe('boot');
  });
});
