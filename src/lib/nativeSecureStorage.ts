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
//  2. Best-effort access — a failed read reuses this launch's known session.
//     Returning null on a transient error makes supabase-js send anonymous
//     requests while the UI still shows the user signed in. A successful miss
//     remains authoritative; an unknown cold-start value falls back to legacy
//     storage, else signed-out. Never reject into supabase-js. Calls that do
//     not settle within KEYCHAIN_TIMEOUT_MS take the same fallback; the native
//     call itself keeps running.
export const nativeAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isNativeIOS()) return window.localStorage.getItem(key);
    const previous = cache.get(key);
    // A failed native delete must not revive this launch's signed-out session.
    // A later setItem (new sign-in) replaces this tombstone.
    if (previous?.removed) return null;
    const revision = previous?.revision ?? 0;
    try {
      const { value } = await keychain('get', NativeAuth.getSecureValue({ key }));
      // A native result can arrive after a newer sign-in, refresh or sign-out.
      if ((cache.get(key)?.revision ?? 0) !== revision) return cache.get(key)?.value ?? null;
      if (value !== null && value !== undefined) {
        cache.set(key, { value, revision, removed: false });
        return value;
      }

      // Keychain miss — migrate a legacy localStorage session if present.
      const legacy = readLegacy(key);
      cache.set(key, { value: legacy, revision, removed: false });
      if (legacy !== null) {
        try {
          await keychain('set', NativeAuth.setSecureValue({ key, value: legacy }));
          removeLegacy(key);
        } catch {
          // Promotion failed; still return the value so the session restores.
          // We retry the promotion on the next launch.
        }
      }
      // Legacy promotion also awaits the bridge; a concurrent removal or write
      // must win over the old value when that promotion finally completes.
      return cache.get(key)?.value ?? null;
    } catch {
      if (cache.has(key)) return cache.get(key)?.value ?? null;
      // Cold launch before first unlock, for example: no in-memory credential
      // exists yet. Keep the original legacy/signed-out fallback.
      return readLegacy(key);
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!isNativeIOS()) {
      window.localStorage.setItem(key, value);
      return;
    }
    cache.set(key, { value, revision: ++mutationRevision, removed: false });
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
    cache.set(key, { value: null, revision: ++mutationRevision, removed: true });
    try {
      await keychain('remove', NativeAuth.removeSecureValue({ key }));
    } catch {
      // Best-effort.
    }
    // Clear any legacy localStorage copy too, so sign-out is complete.
    removeLegacy(key);
  },
};

// Process-only fallback; it contains only values read from or written to
// secure storage, plus a removal marker. It cannot guarantee on-disk deletion
// after a native failure or survive a cold restart.
const cache = new Map<string, { value: string | null; revision: number; removed: boolean }>();
let mutationRevision = 0;

const KEYCHAIN_ERROR_CODES = new Set(['KEYCHAIN_READ_FAILED', 'KEYCHAIN_WRITE_FAILED', 'KEYCHAIN_DELETE_FAILED']);

function errorOutcome(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (typeof code !== 'string' || !KEYCHAIN_ERROR_CODES.has(code)) return 'error';
  const data = error && typeof error === 'object' && 'data' in error ? error.data : undefined;
  const status = data && typeof data === 'object' && 'osStatus' in data ? data.osStatus : undefined;
  // Only the native code allowlist and an Int32 OSStatus enter diagnostics.
  // Never serialize arbitrary native error metadata, keys, values or messages.
  return typeof status === 'number' && Number.isInteger(status) && status >= -2_147_483_648 && status <= 2_147_483_647
    ? `${code}:${status}` : code;
}

function keychain<T>(op: 'get' | 'set' | 'remove', call: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      recordAuthDiagnostic('keychain:timeout', { detail: op });
      reject(new Error(`Keychain ${op} timed out`));
    }, KEYCHAIN_TIMEOUT_MS);
    call.then(
      (value) => { settled = true; clearTimeout(timer); resolve(value); },
      (error) => {
        clearTimeout(timer);
        if (!settled) recordAuthDiagnostic('keychain:error', { detail: op, outcome: errorOutcome(error) });
        settled = true;
        reject(error);
      },
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
