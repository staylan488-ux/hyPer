import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  functions: { invoke: vi.fn() },
  auth: {
    getSession: vi.fn(),
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));
vi.mock('@/lib/nativeAuth', () => ({
  getAuthRedirectTo: () => 'app.hyper.mobile://auth/callback',
  signInWithOAuthProvider: vi.fn(),
}));
vi.mock('@/lib/photoAnalysis', () => ({ hydratePhotoWorkerSettings: vi.fn(async () => {}) }));

import { authScreen } from '@/lib/authScreen';
import { useAuthStore } from '@/stores/authStore';

type AuthCallback = (event: string, session: unknown) => void;

const USER = { id: 'user-1', email: 'lifter@example.com', app_metadata: { provider: 'email' }, email_confirmed_at: '2026-09-01T00:00:00Z' };
const screen = () => authScreen(useAuthStore.getState());

async function initialize(session: unknown = null): Promise<AuthCallback> {
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session }, error: null });
  supabaseMock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  await useAuthStore.getState().initialize();
  return supabaseMock.auth.onAuthStateChange.mock.calls[0][0] as AuthCallback;
}

beforeEach(() => {
  supabaseMock.from.mockReset().mockImplementation(() => {
    const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: null, error: { message: 'none' } }) };
    return chain;
  });
  supabaseMock.functions.invoke.mockReset();
  for (const fn of Object.values(supabaseMock.auth)) fn.mockReset();
  supabaseMock.auth.signOut.mockResolvedValue({ error: null });
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: USER }, error: null });
  useAuthStore.setState({ user: null, session: null, profile: null, loading: false, initialized: false, reconnecting: false, passwordRecovery: false });
});

describe('forgot password', () => {
  it('emails a reset link that returns to the app', async () => {
    supabaseMock.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const { error } = await useAuthStore.getState().requestPasswordReset('lifter@example.com');
    expect(error).toBeNull();
    expect(supabaseMock.auth.resetPasswordForEmail).toHaveBeenCalledWith('lifter@example.com', {
      redirectTo: 'app.hyper.mobile://auth/callback',
    });
  });

  it('passes the server’s refusal on', async () => {
    supabaseMock.auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: { message: 'email rate limit exceeded' } });
    const { error } = await useAuthStore.getState().requestPasswordReset('lifter@example.com');
    expect(error?.message).toBe('email rate limit exceeded');
  });

  it('asks for the new password before the app when the reset link signs in', async () => {
    const callback = await initialize();
    expect(screen()).toBe('sign-in');

    callback('PASSWORD_RECOVERY', { user: USER });
    expect(useAuthStore.getState().passwordRecovery).toBe(true);
    expect(screen()).toBe('new-password');

    // auth-js follows with the usual events for the same account; they keep the screen
    callback('TOKEN_REFRESHED', { user: USER });
    expect(screen()).toBe('new-password');
  });

  it('opens the app once the new password saves', async () => {
    const callback = await initialize();
    callback('PASSWORD_RECOVERY', { user: USER });
    supabaseMock.auth.updateUser.mockResolvedValue({ data: { user: USER }, error: null });

    const { error } = await useAuthStore.getState().updatePassword('a-new-password');
    expect(error).toBeNull();
    expect(supabaseMock.auth.updateUser).toHaveBeenCalledWith({ password: 'a-new-password' });
    expect(screen()).toBe('app');
  });

  it('stays on the new password screen when the save fails', async () => {
    const callback = await initialize();
    callback('PASSWORD_RECOVERY', { user: USER });
    supabaseMock.auth.updateUser.mockResolvedValue({ data: { user: null }, error: { message: 'New password should be different from the old password.' } });

    const { error } = await useAuthStore.getState().updatePassword('same-password');
    expect(error?.message).toMatch(/different from the old password/);
    expect(screen()).toBe('new-password');
  });

  it('Not now opens the app with the old password', async () => {
    const callback = await initialize();
    callback('PASSWORD_RECOVERY', { user: USER });
    useAuthStore.getState().endPasswordRecovery();
    expect(screen()).toBe('app');
    expect(supabaseMock.auth.updateUser).not.toHaveBeenCalled();
  });

  it('ends the recovery when the account signs out', async () => {
    const callback = await initialize();
    callback('PASSWORD_RECOVERY', { user: USER });
    callback('SIGNED_OUT', null);
    expect(useAuthStore.getState().passwordRecovery).toBe(false);
    expect(screen()).toBe('sign-in');
  });

  it('a plain sign-in never asks for a new password', async () => {
    const callback = await initialize();
    callback('SIGNED_IN', { user: USER });
    expect(screen()).toBe('app');
  });
});

describe('delete account', () => {
  it('deletes on the server, then clears only this device’s session', async () => {
    await initialize({ user: USER });
    supabaseMock.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });

    const { error } = await useAuthStore.getState().deleteAccount();
    expect(error).toBeNull();
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
    expect(supabaseMock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAuthStore.getState().user).toBeNull();
    expect(screen()).toBe('sign-in');
  });

  it('stays signed in when the server did not delete the account', async () => {
    await initialize({ user: USER });
    supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } });

    const { error } = await useAuthStore.getState().deleteAccount();
    expect(error).not.toBeNull();
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
  });

  it('finishes the deletion when the answer was lost but the server says the account is gone', async () => {
    await initialize({ user: USER });
    // The retry after a lost answer: the function refuses the sign-in of an account that no longer exists.
    supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } });
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'User from sub claim in JWT does not exist', status: 403, code: 'user_not_found' } });

    const { error } = await useAuthStore.getState().deleteAccount();
    expect(error).toBeNull();
    expect(supabaseMock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useAuthStore.getState().user).toBeNull();
    expect(screen()).toBe('sign-in');
  });

  it('stays signed in when the account could not be checked', async () => {
    await initialize({ user: USER });
    supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request to the Edge Function' } });
    for (const answer of [
      { data: { user: null }, error: { message: 'Network request failed', status: 0, code: undefined } },
      { data: { user: null }, error: { message: 'invalid JWT', status: 401, code: 'bad_jwt' } },
    ]) {
      supabaseMock.auth.getUser.mockResolvedValue(answer);
      expect((await useAuthStore.getState().deleteAccount()).error).not.toBeNull();
    }
    supabaseMock.auth.getUser.mockRejectedValue(new Error('offline'));
    expect((await useAuthStore.getState().deleteAccount()).error).not.toBeNull();
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
  });

  it('treats an answer without ok as not deleted', async () => {
    await initialize({ user: USER });
    supabaseMock.functions.invoke.mockResolvedValue({ data: {}, error: null });
    const { error } = await useAuthStore.getState().deleteAccount();
    expect(error).not.toBeNull();
    expect(useAuthStore.getState().user?.id).toBe('user-1');
  });

  it('does nothing when no one is signed in', async () => {
    await initialize();
    const { error } = await useAuthStore.getState().deleteAccount();
    expect(error).not.toBeNull();
    expect(supabaseMock.functions.invoke).not.toHaveBeenCalled();
  });
});
