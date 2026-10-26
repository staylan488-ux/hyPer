import { describe, expect, it, vi } from 'vitest';

// The native app hands the shared session storage its own Keychain module
// (native/src/platform/supabase.ts) instead of the Capacitor plugin.
vi.mock('@/lib/nativeBridge', () => ({ isNativeIOS: () => false, NativeAuth: {} }));
vi.mock('@/lib/authDiagnostics', () => ({ recordAuthDiagnostic: vi.fn() }));

import { createSecureAuthStorage } from '@/lib/nativeSecureStorage';

function fakeKeychain() {
  const items = new Map<string, string>();
  return {
    items,
    getSecureValue: vi.fn(async ({ key }: { key: string }) => ({ value: items.get(key) ?? null })),
    setSecureValue: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      items.set(key, value);
    }),
    removeSecureValue: vi.fn(async ({ key }: { key: string }) => {
      items.delete(key);
    }),
  };
}

describe('session storage with an injected Keychain', () => {
  it('reads, writes and removes the session through the given Keychain', async () => {
    const keychain = fakeKeychain();
    const storage = createSecureAuthStorage(keychain, () => true);

    await storage.setItem('sb-auth-token', 'session');
    expect(keychain.items.get('sb-auth-token')).toBe('session');
    expect(await storage.getItem('sb-auth-token')).toBe('session');

    await storage.removeItem('sb-auth-token');
    expect(keychain.items.has('sb-auth-token')).toBe(false);
    expect(await storage.getItem('sb-auth-token')).toBeNull();
  });

  it('keeps a separate cache per storage', async () => {
    const first = createSecureAuthStorage(fakeKeychain(), () => true);
    const secondKeychain = fakeKeychain();
    const second = createSecureAuthStorage(secondKeychain, () => true);

    await first.setItem('sb-auth-token', 'first');
    await first.removeItem('sb-auth-token');
    secondKeychain.items.set('sb-auth-token', 'second');
    // The first storage's sign-out tombstone does not hide the second's session.
    expect(await second.getItem('sb-auth-token')).toBe('second');
  });
});
