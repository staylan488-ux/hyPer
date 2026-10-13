import { recordAuthDiagnostic } from '@/lib/authDiagnostics';
import { NativeAuth, isNativeIOS } from '@/lib/nativeBridge';

// A Keychain call through the native bridge can stall after iOS resumes the
// app. supabase-js awaits this storage before every request and inside each
// token refresh, so a stalled call would hold all of them indefinitely.
export const KEYCHAIN_TIMEOUT_MS = 3_000;

// Supabase accepts asynchronous Storage-compatible methods. Only auth state is
// placed here; application data continues through the normal database/RLS path.
//
// On native iOS the session lives in the Keychain, with two hardening rules:
//  1. One-time migration — builds before the Keychain switch persisted the
//     session in the WKWebView's localStorage, which survives an app update. On
//     a Keychain miss we adopt any legacy localStorage value and promote it, so
//     existing users are not logged out on first launch after updating.
//  2. Best-effort access — a Keychain read/write failure must degrade to the
//     signed-out path, never reject into supabase-js. An unhandled rejection
//     from getSession() at boot would hang the app on the loading screen.
//     A call that does not settle within KEYCHAIN_TIMEOUT_MS takes the same
//     fallback, except that a read reuses the value this launch last read or
//     wrote. The native call itself keeps running.
export const nativeAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isNativeIOS()) return window.localStorage.getItem(key);
    try {
      const { value } = await keychain('get', NativeAuth.getSecureValue({ key }));
      if (value !== null && value !== undefined) {
        lastKnown.set(key, value);
        return value;
      }

      // Keychain miss — migrate a legacy localStorage session if present.
      const legacy = readLegacy(key);
      if (legacy !== null) {
        lastKnown.set(key, legacy);
        try {
          await keychain('set', NativeAuth.setSecureValue({ key, value: legacy }));
          removeLegacy(key);
        } catch {
          // Promotion failed; still return the value so the session restores.
          // We retry the promotion on the next launch.
        }
      } else {
        lastKnown.delete(key);
      }
      return legacy;
    } catch (error) {
      // A stalled bridge after resume: keep this launch's session in use.
      if (error instanceof KeychainTimeoutError && lastKnown.has(key)) return lastKnown.get(key) ?? null;
      // Keychain unavailable (e.g. launched before first unlock). Fall back to
      // any legacy value, else signed-out. Never throw.
      return readLegacy(key);
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!isNativeIOS()) {
      window.localStorage.setItem(key, value);
      return;
    }
    lastKnown.set(key, value);
    try {
      await keychain('set', NativeAuth.setSecureValue({ key, value }));
    } catch {
      // Best-effort: a failed persist just means re-auth on the next cold start.
    }
  },
  async removeItem(key: string): Promise<void> {
    if (!isNativeIOS()) {
      window.localStorage.removeItem(key);
      return;
    }
    lastKnown.delete(key);
    try {
      await keychain('remove', NativeAuth.removeSecureValue({ key }));
    } catch {
      // Best-effort.
    }
    // Clear any legacy localStorage copy too, so sign-out is complete.
    removeLegacy(key);
  },
};

// The value each key last held in this launch, used only when the Keychain
// times out. It never outlives the process and holds nothing the Keychain
// was not asked to hold.
const lastKnown = new Map<string, string>();

class KeychainTimeoutError extends Error {}

function keychain<T>(op: 'get' | 'set' | 'remove', call: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      recordAuthDiagnostic('keychain:timeout', { detail: op });
      reject(new KeychainTimeoutError(`Keychain ${op} timed out`));
    }, KEYCHAIN_TIMEOUT_MS);
    call.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function readLegacy(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLegacy(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
