// Replaces ../src/lib/nativeAuth.ts (see metro.config.js).
//
// Google and Apple sign-in open in iOS's web-authentication sheet
// (ASWebAuthenticationSession, through expo-web-browser), as the Capacitor app
// did with its HyperAuth plugin. The callback is checked by the shared parser,
// then exchanged for a session with PKCE.
import type { Provider } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';

import { parseNativeOAuthCallback } from '@/lib/nativeOAuthCallback';
import { supabase } from '@/lib/supabase';

import { NATIVE_AUTH_REDIRECT_URL } from './nativeBridge';

export type HyperOAuthProvider = Extract<Provider, 'google' | 'apple'>;

/** The message for a sheet the person closed; screens show nothing for it. */
export const SIGN_IN_CANCELLED = 'Sign-in was cancelled.';

export function getAuthRedirectTo(): string | undefined {
  return NATIVE_AUTH_REDIRECT_URL;
}

let signingIn = false;

export async function signInWithOAuthProvider(
  provider: HyperOAuthProvider,
): Promise<{ error: Error | null }> {
  // One sheet at a time, as the HyperAuth plugin enforced.
  if (signingIn) return { error: new Error('Another sign-in is already in progress.') };
  signingIn = true;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: NATIVE_AUTH_REDIRECT_URL, skipBrowserRedirect: true },
    });
    if (error) return { error: new Error(error.message) };
    if (!data?.url) return { error: new Error('The sign-in provider did not return a login URL.') };

    const result = await WebBrowser.openAuthSessionAsync(data.url, NATIVE_AUTH_REDIRECT_URL, {
      preferEphemeralSession: false,
    });
    if (result.type === 'cancel' || result.type === 'dismiss') return { error: new Error(SIGN_IN_CANCELLED) };
    if (result.type !== 'success') return { error: new Error('Unable to complete sign-in.') };

    const { code } = parseNativeOAuthCallback(result.url);
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    return { error: exchangeError ? new Error(exchangeError.message) : null };
  } catch (signInError) {
    return {
      error: signInError instanceof Error ? signInError : new Error('Unable to complete sign-in.'),
    };
  } finally {
    signingIn = false;
  }
}
