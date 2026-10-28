// Links that open the app from outside (Expo Router's native intent).
//
// The email-confirmation link returns to <scheme>://auth/callback?code=…, as
// the web shell's useNativeAuthCallback handles it: exchange the code for a
// session (PKCE, verifier kept by sign-up on this phone) and land on the app.
// Google and Apple sign-in never get here; iOS's sign-in sheet catches them.
import { NATIVE_AUTH_REDIRECT_URL } from '@/lib/nativeBridge';
import { parseNativeOAuthCallback } from '@/lib/nativeOAuthCallback';
import { supabase } from '@/lib/supabase';

/** The full callback URL, whether iOS hands over the URL or only its path. */
function callbackUrl(path: string): string | null {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/?auth\/callback(?:[/?#]|$)/i.exec(path);
  if (!match) return null;
  const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
  return `${NATIVE_AUTH_REDIRECT_URL}${query}`;
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = callbackUrl(path);
    if (!url) return path;
    const { code } = parseNativeOAuthCallback(url);
    // The auth listener opens the app once the session lands; on failure the
    // sign-in screen stays for a clean retry, as on the web.
    void supabase.auth.exchangeCodeForSession(code).catch(() => {});
    return '/';
  } catch {
    return '/';
  }
}
