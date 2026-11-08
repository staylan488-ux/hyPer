// Links that open the app from outside (Expo Router's native intent).
//
// The email-confirmation and password-reset links return to
// <scheme>://auth/callback?code=…, handled here: exchange the code for a
// session (PKCE, verifier kept by sign-up or Forgot password on this phone)
// and land on the app. A reset's exchange signs in with PASSWORD_RECOVERY,
// which shows the new password screen first (authStore, authScreen).
// Google and Apple sign-in never get here; iOS's sign-in sheet catches them.
//
// A widget or card link that launches the app is remembered for index, which
// opens it once the saved session has been read (lib/launchLink.ts).
import { NATIVE_AUTH_REDIRECT_URL } from '@/lib/nativeBridge';
import { parseNativeOAuthCallback } from '@/lib/nativeOAuthCallback';
import { supabase } from '@/lib/supabase';
import { AUTH_LINK_FAILED, useAuthLinkError } from '~/lib/authLink';
import { blocksRunLink, rememberLaunchLink } from '~/lib/launchLink';

/** The full callback URL, whether iOS hands over the URL or only its path. */
function callbackUrl(path: string): string | null {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/?auth\/callback(?:[/?#]|$)/i.exec(path);
  if (!match) return null;
  const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
  return `${NATIVE_AUTH_REDIRECT_URL}${query}`;
}

/** Sign-in says a link didn't work; signed in already, the app is open and nothing needs saying. */
function linkFailed() {
  void supabase.auth.getSession().then(({ data }) => {
    if (!data.session) useAuthLinkError.getState().set(AUTH_LINK_FAILED);
  }).catch(() => useAuthLinkError.getState().set(AUTH_LINK_FAILED));
}

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    const url = callbackUrl(path);
    if (!url) {
      if (!initial && blocksRunLink(path)) return '';
      if (initial) rememberLaunchLink(path);
      return path;
    }
    const { code } = parseNativeOAuthCallback(url);
    useAuthLinkError.getState().clear();
    // The auth listener opens the app once the session lands; on failure the
    // sign-in screen stays for a clean retry, and says why.
    void supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) linkFailed();
      })
      .catch(linkFailed);
    return '/';
  } catch {
    if (callbackUrl(path)) linkFailed();
    return '/';
  }
}
