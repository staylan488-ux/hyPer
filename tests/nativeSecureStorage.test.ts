import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Keychain adapter behind sign-in persistence on iOS. It must migrate a
// legacy localStorage session, never reject into supabase-js (that hangs boot
// on the loading screen), and fully clear the session on sign-out.
const mocks = vi.hoisted(() => ({
  isNativeIOS: vi.fn(),
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

import { nativeAuthStorage } from '@/lib/nativeSecureStorage';

const KEY = 'sb-abcd-auth-token';
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

  it('never rejects sign-out when localStorage throws', async () => {
    vi.stubGlobal('window', { localStorage: throwingLocalStorage() });
    keychain.set(KEY, SESSION);
    await expect(nativeAuthStorage.removeItem(KEY)).resolves.toBeUndefined();
    expect(keychain.has(KEY)).toBe(false);
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
