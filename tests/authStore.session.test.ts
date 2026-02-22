import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
    signInWithPassword: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

import { useAuthStore } from '@/stores/authStore';

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

  useAuthStore.setState({
    user: null,
    session: null,
    profile: null,
    loading: true,
    initialized: false,
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
