import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  auth: { getSession: vi.fn(), getUser: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import { getSessionUserId } from '@/lib/sessionUser';

beforeEach(() => {
  supabaseMock.auth.getSession.mockReset();
  supabaseMock.auth.getUser.mockReset();
});

describe('getSessionUserId', () => {
  it('returns the stored session user id without an auth server lookup', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'token', user: { id: 'user-1' } } }, error: null,
    });

    await expect(getSessionUserId()).resolves.toBe('user-1');
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it('returns null when signed out', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getSessionUserId()).resolves.toBeNull();
  });

  it('returns null when an expired session could not be refreshed', async () => {
    // auth-js reports a failed refresh of an expired token as a null session
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: null }, error: new Error('Failed to fetch'),
    });

    await expect(getSessionUserId()).resolves.toBeNull();
  });

  it('never falls back to the auth store user', async () => {
    const { useAuthStore } = await import('@/stores/authStore');
    useAuthStore.setState({ user: { id: 'stale-user' } as never });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getSessionUserId()).resolves.toBeNull();
  });
});
