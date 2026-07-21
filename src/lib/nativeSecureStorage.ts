import { NativeAuth, isNativeIOS } from '@/lib/nativeBridge';

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
export const nativeAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isNativeIOS()) return window.localStorage.getItem(key);
    try {
      const { value } = await NativeAuth.getSecureValue({ key });
      if (value !== null && value !== undefined) return value;

      // Keychain miss — migrate a legacy localStorage session if present.
      const legacy = readLegacy(key);
      if (legacy !== null) {
        try {
          await NativeAuth.setSecureValue({ key, value: legacy });
          removeLegacy(key);
        } catch {
          // Promotion failed; still return the value so the session restores.
          // We retry the promotion on the next launch.
        }
      }
      return legacy;
    } catch {
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
    try {
      await NativeAuth.setSecureValue({ key, value });
    } catch {
      // Best-effort: a failed persist just means re-auth on the next cold start.
    }
  },
  async removeItem(key: string): Promise<void> {
    if (!isNativeIOS()) {
      window.localStorage.removeItem(key);
      return;
    }
    try {
      await NativeAuth.removeSecureValue({ key });
    } catch {
      // Best-effort.
    }
    // Clear any legacy localStorage copy too, so sign-out is complete.
    removeLegacy(key);
  },
};

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
