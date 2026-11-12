import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  functions: { invoke: vi.fn() },
  auth: {
    getSession: vi.fn(),
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));
vi.mock('@/lib/nativeAuth', () => ({ getAuthRedirectTo: () => null, signInWithOAuthProvider: vi.fn() }));
vi.mock('@/lib/photoAnalysis', () => ({ hydratePhotoWorkerSettings: vi.fn(async () => {}) }));

import { authScreen } from '@/lib/authScreen';
import { fetchBetaAccess, isInviteRefusal } from '@/lib/betaAccess';
import { useAuthStore } from '@/stores/authStore';

type AuthCallback = (event: string, session: unknown) => void;
const ANNA = { id: 'user-anna', email: 'anna@example.com', app_metadata: { provider: 'email' }, email_confirmed_at: '2026-09-01T00:00:00Z' };
const BEN = { id: 'user-ben', email: 'ben@example.com', app_metadata: { provider: 'google' } };
const screen = () => authScreen(useAuthStore.getState());
const answer = (userId: string | null, approved: boolean) => ({ data: { user_id: userId, approved }, error: null });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function initialize(user: unknown = ANNA): Promise<AuthCallback> {
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: user ? { user } : null }, error: null });
  supabaseMock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  await useAuthStore.getState().initialize();
  await flush();
  return supabaseMock.auth.onAuthStateChange.mock.calls[0][0] as AuthCallback;
}

beforeEach(() => {
  supabaseMock.from.mockReset().mockImplementation(() => {
    const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: null, error: { message: 'none' } }) };
    return chain;
  });
  supabaseMock.rpc.mockReset();
  supabaseMock.functions.invoke.mockReset();
  for (const fn of Object.values(supabaseMock.auth)) fn.mockReset();
  supabaseMock.auth.signOut.mockResolvedValue({ error: null });
  useAuthStore.setState({ user: null, session: null, profile: null, loading: false, initialized: false, reconnecting: false, passwordRecovery: false, betaAccess: 'unknown' });
});

describe('reading the server’s approval answer', () => {
  it('trusts only a clear answer about this very account', async () => {
    expect(await fetchBetaAccess('a', async () => answer('a', true))).toBe('approved');
    expect(await fetchBetaAccess('a', async () => answer('a', false))).toBe('not-approved');
    // Sent without the sign-in, or about someone else: says nothing.
    expect(await fetchBetaAccess('a', async () => answer(null, false))).toBe('unknown');
    expect(await fetchBetaAccess('a', async () => answer('b', false))).toBe('unknown');
    expect(await fetchBetaAccess('a', async () => ({ data: null, error: null }))).toBe('unknown');
    expect(await fetchBetaAccess('a', async () => ({ data: { user_id: 'a', approved: 'no' }, error: null }))).toBe('unknown');
  });

  it('treats errors, throws and slow answers as unknown', async () => {
    expect(await fetchBetaAccess('a', async () => ({ data: null, error: { message: 'Failed to fetch' } }))).toBe('unknown');
    expect(await fetchBetaAccess('a', async () => ({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }))).toBe('unknown');
    expect(await fetchBetaAccess('a', () => { throw new TypeError('Network request failed'); })).toBe('unknown');
    vi.useFakeTimers();
    try {
      const pending = fetchBetaAccess('a', () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await pending).toBe('unknown');
    } finally { vi.useRealTimers(); }
  });

  it('keeps the app open before the migration exists on the server', async () => {
    expect(await fetchBetaAccess('a', async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }))).toBe('approved');
  });

  it('recognises an invite refusal however Supabase Auth words it', () => {
    expect(isInviteRefusal('Database error saving new user')).toBe(true);
    expect(isInviteRefusal('hyPer is invite-only: this email is not invited')).toBe(true);
    expect(isInviteRefusal('Signups not allowed for this instance')).toBe(true);
    expect(isInviteRefusal('Invalid login credentials')).toBe(false);
  });
});

describe('the not-on-the-list screen', () => {
  it('shows only when the server clearly says no', async () => {
    supabaseMock.rpc.mockResolvedValue(answer(ANNA.id, false));
    await initialize();
    expect(supabaseMock.rpc).toHaveBeenCalledWith('my_beta_access');
    expect(screen()).toBe('not-approved');
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
  });

  it('opens the app for an approved account', async () => {
    supabaseMock.rpc.mockResolvedValue(answer(ANNA.id, true));
    await initialize();
    expect(screen()).toBe('app');
  });

  it('keeps an approved person in the app and signed in while the answer is slow or offline', async () => {
    let settle: (value: unknown) => void = () => {};
    supabaseMock.rpc.mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    const callback = await initialize();
    expect(screen()).toBe('app');
    settle({ data: null, error: { message: 'Failed to fetch' } });
    await flush();
    expect(useAuthStore.getState().betaAccess).toBe('unknown');
    expect(screen()).toBe('app');
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
    // The next return to the app asks again.
    supabaseMock.rpc.mockResolvedValue(answer(ANNA.id, true));
    callback('SIGNED_IN', { user: ANNA });
    await flush();
    expect(useAuthStore.getState().betaAccess).toBe('approved');
  });

  it('never lets an unclear answer replace a clear one', async () => {
    supabaseMock.rpc.mockResolvedValue(answer(ANNA.id, true));
    await initialize();
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
    await useAuthStore.getState().checkBetaAccess();
    expect(useAuthStore.getState().betaAccess).toBe('approved');
    expect(screen()).toBe('app');
  });

  it('lets a newly approved person in on Check again', async () => {
    supabaseMock.rpc.mockResolvedValue(answer(ANNA.id, false));
    await initialize();
    expect(screen()).toBe('not-approved');
    supabaseMock.rpc.mockResolvedValue(answer(ANNA.id, true));
    await useAuthStore.getState().checkBetaAccess();
    expect(screen()).toBe('app');
  });

  it('never carries an answer from one account to the next', async () => {
    let settleAnna: (value: unknown) => void = () => {};
    supabaseMock.rpc.mockReturnValueOnce(new Promise(resolve => { settleAnna = resolve; }));
    const callback = await initialize();
    // Ben signs in while Anna's answer is still out.
    supabaseMock.rpc.mockResolvedValueOnce(answer(BEN.id, true));
    callback('SIGNED_IN', { user: BEN });
    await flush();
    settleAnna(answer(ANNA.id, false));
    await flush();
    expect(useAuthStore.getState().betaAccess).toBe('approved');
    expect(screen()).toBe('app');
    // A clear "no" for Ben is cleared when he signs out.
    supabaseMock.rpc.mockResolvedValue(answer(BEN.id, false));
    await useAuthStore.getState().checkBetaAccess();
    expect(screen()).toBe('not-approved');
    await useAuthStore.getState().signOut();
    expect(useAuthStore.getState().betaAccess).toBe('unknown');
    expect(screen()).toBe('sign-in');
  });

  it('puts a password reset first, and lets an unapproved account delete itself', async () => {
    supabaseMock.rpc.mockResolvedValue(answer(ANNA.id, false));
    const callback = await initialize();
    callback('PASSWORD_RECOVERY', { user: ANNA });
    await flush();
    expect(screen()).toBe('new-password');
    useAuthStore.getState().endPasswordRecovery();
    expect(screen()).toBe('not-approved');
    supabaseMock.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const { error } = await useAuthStore.getState().deleteAccount();
    expect(error).toBeNull();
    expect(supabaseMock.functions.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
    expect(screen()).toBe('sign-in');
  });

  it('does not ask for an unverified email sign-in (it is signed out at once)', async () => {
    await initialize({ ...ANNA, email_confirmed_at: null });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});

describe('the early features (WHOOP, the Mac worker, runs)', () => {
  const full = (userId: string, early?: boolean) => ({ data: { user_id: userId, approved: true, ...(early === undefined ? {} : { early_access: early, ai_daily_limit: 8 }) }, error: null });

  it('reads early access only from a clear answer about this account', async () => {
    const { fetchAccountAccess } = await import('@/lib/betaAccess');
    expect(await fetchAccountAccess('a', async () => full('a', true))).toEqual({ access: 'approved', earlyAccess: true });
    expect(await fetchAccountAccess('a', async () => full('a', false))).toEqual({ access: 'approved', earlyAccess: false });
    expect(await fetchAccountAccess('a', async () => answer('a', false))).toEqual({ access: 'not-approved', earlyAccess: false });
    expect(await fetchAccountAccess('a', async () => full('b', true))).toEqual({ access: 'unknown', earlyAccess: null });
    expect(await fetchAccountAccess('a', async () => ({ data: null, error: { message: 'Failed to fetch' } }))).toEqual({ access: 'unknown', earlyAccess: null });
  });

  it('keeps them for everyone on a server from before public sign-up', async () => {
    const { fetchAccountAccess } = await import('@/lib/betaAccess');
    // The private beta's answer has no early_access field; older still, no function at all.
    expect(await fetchAccountAccess('a', async () => full('a'))).toEqual({ access: 'approved', earlyAccess: true });
    expect(await fetchAccountAccess('a', async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }))).toEqual({ access: 'approved', earlyAccess: true });
  });

  it('remembers the answer per account, so an offline launch shows the same settings', async () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
    });
    try {
      supabaseMock.rpc.mockResolvedValue(full(ANNA.id, true));
      const callback = await initialize();
      expect(useAuthStore.getState().earlyAccess).toBe(true);

      // Ben, who joined after public sign-up, never inherits Anna's.
      supabaseMock.rpc.mockResolvedValue(full(BEN.id, false));
      callback('SIGNED_IN', { user: BEN });
      expect(useAuthStore.getState().earlyAccess).toBe(false);
      await flush();
      expect(useAuthStore.getState().earlyAccess).toBe(false);

      // Anna again, offline: the phone remembers her answer.
      supabaseMock.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
      callback('SIGNED_IN', { user: ANNA });
      expect(useAuthStore.getState().earlyAccess).toBe(true);
      await flush();
      expect(useAuthStore.getState().earlyAccess).toBe(true);

      await useAuthStore.getState().signOut();
      expect(useAuthStore.getState().earlyAccess).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
