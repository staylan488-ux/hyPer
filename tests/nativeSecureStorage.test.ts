import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Keychain adapter behind sign-in persistence on iOS. It must migrate a
// legacy localStorage session, never reject into supabase-js (that hangs boot
// on the loading screen), and fully clear the session on sign-out.
const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(),
  record: vi.fn(),
  NativeAuth: {
    getSecureValue: vi.fn(),
    setSecureValue: vi.fn(),
    removeSecureValue: vi.fn(),
  },
}));

vi.mock('@/lib/nativeBridge', () => ({
  isNativeIOS: mocks.isNativeIOS,
  NativeAuth: mocks.NativeAuth,
}));

vi.mock('@/lib/authDiagnostics', () => ({ recordAuthDiagnostic: mocks.record }));

import { KEYCHAIN_TIMEOUT_MS, nativeAuthStorage } from '@/lib/nativeSecureStorage';

let keySequence = 0;
let KEY: string;
const SESSION = '{"access_token":"a","refresh_token":"r"}';

let keychain: Map<string, string>;
let legacy: Map<string, string>;

function fakeLocalStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
}

function throwingLocalStorage() {
  const fail = () => { throw new Error('storage unavailable'); };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

beforeEach(() => {
  KEY = `sb-test-${++keySequence}-auth-token`;
  keychain = new Map();
  legacy = new Map();
  vi.stubGlobal('window', { localStorage: fakeLocalStorage(legacy) });
  mocks.isNativeIOS.mockReturnValue(true);
  mocks.NativeAuth.getSecureValue.mockImplementation(async ({ key }: { key: string }) => ({ value: keychain.get(key) ?? null }));
  mocks.NativeAuth.setSecureValue.mockImplementation(async ({ key, value }: { key: string; value: string }) => { keychain.set(key, value); });
  mocks.NativeAuth.removeSecureValue.mockImplementation(async ({ key }: { key: string }) => { keychain.delete(key); });
});

afterEach(() => vi.unstubAllGlobals());

describe('nativeAuthStorage on native iOS', () => {
  it('returns the Keychain session and leaves any legacy copy alone', async () => {
    keychain.set(KEY, SESSION);
    legacy.set(KEY, 'stale-legacy');
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBe(SESSION);
    expect(legacy.get(KEY)).toBe('stale-legacy');
  });

  it('migrates a legacy localStorage session into the Keychain on a miss', async () => {
    legacy.set(KEY, SESSION);
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBe(SESSION);
    expect(keychain.get(KEY)).toBe(SESSION);
    expect(legacy.has(KEY)).toBe(false);
  });

  it('still restores the legacy session and keeps it for a retry when promotion fails', async () => {
    legacy.set(KEY, SESSION);
    mocks.NativeAuth.setSecureValue.mockRejectedValue(new Error('keychain write failed'));
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBe(SESSION);
    expect(keychain.has(KEY)).toBe(false);
    expect(legacy.get(KEY)).toBe(SESSION);
  });

  it('resolves signed-out when neither the Keychain nor localStorage has a session', async () => {
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBeNull();
    expect(mocks.NativeAuth.setSecureValue).not.toHaveBeenCalled();
  });

  it('falls back to the legacy session, else signed-out, when the Keychain is locked', async () => {
    mocks.NativeAuth.getSecureValue.mockRejectedValue(new Error('locked before first unlock'));
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBeNull();
    legacy.set(KEY, SESSION);
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBe(SESSION);
  });

  it('resolves signed-out when both the Keychain and localStorage throw', async () => {
    mocks.NativeAuth.getSecureValue.mockRejectedValue(new Error('locked before first unlock'));
    vi.stubGlobal('window', { localStorage: throwingLocalStorage() });
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBeNull();
  });

  it('writes the session through to the Keychain and never rejects on a write error', async () => {
    await expect(nativeAuthStorage.setItem(KEY, SESSION)).resolves.toBeUndefined();
    expect(keychain.get(KEY)).toBe(SESSION);
    expect(legacy.has(KEY)).toBe(false);

    mocks.NativeAuth.setSecureValue.mockRejectedValue(new Error('keychain write failed'));
    await expect(nativeAuthStorage.setItem(KEY, 'next')).resolves.toBeUndefined();
  });

  it('clears both the Keychain and the legacy copy on sign-out', async () => {
    keychain.set(KEY, SESSION);
    legacy.set(KEY, SESSION);
    await expect(nativeAuthStorage.removeItem(KEY)).resolves.toBeUndefined();
    expect(keychain.has(KEY)).toBe(false);
    expect(legacy.has(KEY)).toBe(false);
  });

  it('still clears the legacy copy when the Keychain delete fails', async () => {
    legacy.set(KEY, SESSION);
    mocks.NativeAuth.removeSecureValue.mockRejectedValue(new Error('keychain delete failed'));
    await expect(nativeAuthStorage.removeItem(KEY)).resolves.toBeUndefined();
    expect(legacy.has(KEY)).toBe(false);
  });

  it('does not revive a signed-out session when the native deletion failed', async () => {
    keychain.set(KEY, SESSION);
    await nativeAuthStorage.getItem(KEY);
    mocks.NativeAuth.removeSecureValue.mockRejectedValue(new Error('delete failed'));
    await nativeAuthStorage.removeItem(KEY);
    expect(keychain.get(KEY)).toBe(SESSION);
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBeNull();

    await nativeAuthStorage.setItem(KEY, 'new-sign-in');
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBe('new-sign-in');
  });

  it('honors a successful Keychain miss even after a session was cached', async () => {
    keychain.set(KEY, SESSION);
    await nativeAuthStorage.getItem(KEY);
    keychain.delete(KEY);
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBeNull();
    mocks.NativeAuth.getSecureValue.mockRejectedValue(new Error('read failed'));
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBeNull();
  });

  it.each(['write', 'remove'])('ignores an old read that settles after a newer %s', async (mutation) => {
    let resolveRead!: (value: { value: string }) => void;
    mocks.NativeAuth.getSecureValue.mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
    const read = nativeAuthStorage.getItem(KEY);
    if (mutation === 'write') await nativeAuthStorage.setItem(KEY, 'new-session');
    else await nativeAuthStorage.removeItem(KEY);
    resolveRead({ value: SESSION });
    await expect(read).resolves.toBe(mutation === 'write' ? 'new-session' : null);
  });

  it('does not return a legacy session when sign-out happened during its promotion', async () => {
    legacy.set(KEY, SESSION);
    let finishPromotion!: () => void;
    mocks.NativeAuth.setSecureValue.mockReturnValueOnce(new Promise<void>((resolve) => { finishPromotion = resolve; }));
    const read = nativeAuthStorage.getItem(KEY);
    await vi.waitFor(() => expect(mocks.NativeAuth.setSecureValue).toHaveBeenCalled());
    await nativeAuthStorage.removeItem(KEY);
    finishPromotion();
    await expect(read).resolves.toBeNull();
  });

  it('never rejects sign-out when localStorage throws', async () => {
    vi.stubGlobal('window', { localStorage: throwingLocalStorage() });
    keychain.set(KEY, SESSION);
    await expect(nativeAuthStorage.removeItem(KEY)).resolves.toBeUndefined();
    expect(keychain.has(KEY)).toBe(false);
  });
});

describe('nativeAuthStorage when the Keychain bridge stalls', () => {
  const hang = () => new Promise<never>(() => {});

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops waiting on a hung read and falls back to the legacy session, else signed-out', async () => {
    mocks.NativeAuth.getSecureValue.mockImplementation(hang);
    const signedOut = nativeAuthStorage.getItem('sb-hang-none');
    await vi.advanceTimersByTimeAsync(KEYCHAIN_TIMEOUT_MS);
    await expect(signedOut).resolves.toBeNull();

    legacy.set('sb-hang-legacy', SESSION);
    const restored = nativeAuthStorage.getItem('sb-hang-legacy');
    await vi.advanceTimersByTimeAsync(KEYCHAIN_TIMEOUT_MS);
    await expect(restored).resolves.toBe(SESSION);
    expect(mocks.record).toHaveBeenCalledWith('keychain:timeout', { detail: 'get' });
  });

  it('keeps serving the session this launch last read or wrote while reads hang', async () => {
    const key = 'sb-hang-known';
    keychain.set(key, SESSION);
    await expect(nativeAuthStorage.getItem(key)).resolves.toBe(SESSION);

    mocks.NativeAuth.getSecureValue.mockImplementation(hang);
    mocks.NativeAuth.setSecureValue.mockImplementation(hang);
    const write = nativeAuthStorage.setItem(key, 'rotated');
    await vi.advanceTimersByTimeAsync(KEYCHAIN_TIMEOUT_MS);
    await expect(write).resolves.toBeUndefined();

    const read = nativeAuthStorage.getItem(key);
    await vi.advanceTimersByTimeAsync(KEYCHAIN_TIMEOUT_MS);
    await expect(read).resolves.toBe('rotated');
    expect(mocks.record).toHaveBeenCalledWith('keychain:timeout', { detail: 'set' });
  });

  it('does not resurrect a signed-out session while reads hang', async () => {
    const key = 'sb-hang-removed';
    await nativeAuthStorage.setItem(key, SESSION);
    mocks.NativeAuth.removeSecureValue.mockImplementation(hang);
    const removal = nativeAuthStorage.removeItem(key);
    await vi.advanceTimersByTimeAsync(KEYCHAIN_TIMEOUT_MS);
    await expect(removal).resolves.toBeUndefined();

    mocks.NativeAuth.getSecureValue.mockImplementation(hang);
    const read = nativeAuthStorage.getItem(key);
    await vi.advanceTimersByTimeAsync(KEYCHAIN_TIMEOUT_MS);
    await expect(read).resolves.toBeNull();
    expect(mocks.record).toHaveBeenCalledWith('keychain:timeout', { detail: 'remove' });
  });

  it('bounds a hung legacy promotion and still restores the session', async () => {
    legacy.set('sb-hang-promote', SESSION);
    mocks.NativeAuth.setSecureValue.mockImplementation(hang);
    const read = nativeAuthStorage.getItem('sb-hang-promote');
    await vi.advanceTimersByTimeAsync(KEYCHAIN_TIMEOUT_MS);
    await expect(read).resolves.toBe(SESSION);
    expect(legacy.get('sb-hang-promote')).toBe(SESSION);
  });

  it('lets supabase-js resolve getSession instead of hanging behind the read', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const storageKey = 'sb-hang-sdk-auth-token';
    const session = {
      access_token: 'access', refresh_token: 'refresh', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
    };
    legacy.set(storageKey, JSON.stringify(session));
    mocks.NativeAuth.getSecureValue.mockImplementation(hang);
    const client = createClient('https://keychain-hang.test', 'test-key', {
      auth: { storage: nativeAuthStorage, storageKey, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: vi.fn<typeof fetch>() },
    });

    const result = client.auth.getSession();
    await vi.advanceTimersByTimeAsync(3 * KEYCHAIN_TIMEOUT_MS);
    await expect(result).resolves.toMatchObject({ data: { session: { access_token: 'access' } }, error: null });
  });

  it('keeps the last value for a plain Keychain read error, just as for a timeout', async () => {
    const key = 'sb-error-known';
    keychain.set(key, SESSION);
    await nativeAuthStorage.getItem(key);
    mocks.NativeAuth.getSecureValue.mockRejectedValue(new Error('locked before first unlock'));
    await expect(nativeAuthStorage.getItem(key)).resolves.toBe(SESSION);
  });
});

describe('set-save authentication after a native storage error', () => {
  it('keeps the signed-in token on the real SDK request when a later Keychain read fails', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const session = {
      access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
    };
    keychain.set(KEY, JSON.stringify(session));
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (new Headers(init?.headers).get('Authorization') !== 'Bearer test-access') {
        return Response.json({ code: '42501', message: 'permission denied' }, { status: 401 });
      }
      return Response.json({ id: 'set-1', weight: 185, reps: 8, completed: true });
    });
    const client = createClient('https://native-storage-save.test', 'test-public-key', {
      auth: { storage: nativeAuthStorage, storageKey: KEY, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchMock },
    });
    await expect(client.auth.getSession()).resolves.toMatchObject({ data: { session: { access_token: 'test-access' } } });

    mocks.NativeAuth.getSecureValue.mockRejectedValue(Object.assign(new Error('private native details'), {
      code: 'KEYCHAIN_READ_FAILED', data: { osStatus: -25308, session: 'private-session-data' },
    }));
    const saved = await client.from('sets').update({ weight: 185, reps: 8, completed: true }).eq('id', 'set-1').select().single();
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ completed: true, weight: 185, reps: 8 });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer test-access');
    expect(mocks.record).toHaveBeenCalledWith('keychain:error', { detail: 'get', outcome: 'KEYCHAIN_READ_FAILED:-25308' });
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('private native details');
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('test-access');
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('private-session-data');
  });

  it.each([
    { code: 'private-code', status: -25308, expected: 'error' },
    { code: 'KEYCHAIN_READ_FAILED', status: 'private-status', expected: 'KEYCHAIN_READ_FAILED' },
    { code: 'KEYCHAIN_READ_FAILED', status: Number.MAX_SAFE_INTEGER, expected: 'KEYCHAIN_READ_FAILED' },
  ])('does not record arbitrary error metadata ($expected)', async ({ code, status, expected }) => {
    mocks.NativeAuth.getSecureValue.mockRejectedValue({ code, data: { osStatus: status }, message: 'private-message' });
    await nativeAuthStorage.getItem(KEY);
    expect(mocks.record).toHaveBeenCalledWith('keychain:error', { detail: 'get', outcome: expected });
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('private-');
  });
});

describe('nativeAuthStorage on the web', () => {
  it('reads, writes and removes straight through localStorage without the Keychain', async () => {
    mocks.isNativeIOS.mockReturnValue(false);
    await nativeAuthStorage.setItem(KEY, SESSION);
    expect(legacy.get(KEY)).toBe(SESSION);
    await expect(nativeAuthStorage.getItem(KEY)).resolves.toBe(SESSION);
    await nativeAuthStorage.removeItem(KEY);
    expect(legacy.has(KEY)).toBe(false);
    expect(mocks.NativeAuth.getSecureValue).not.toHaveBeenCalled();
    expect(mocks.NativeAuth.setSecureValue).not.toHaveBeenCalled();
    expect(mocks.NativeAuth.removeSecureValue).not.toHaveBeenCalled();
    expect(keychain.size).toBe(0);
  });
});
