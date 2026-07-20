import type { Provider } from '@supabase/supabase-js';

import {
  NATIVE_AUTH_CALLBACK_SCHEME,
  NATIVE_AUTH_REDIRECT_URL,
  NativeAuth,
  isNativeIOS,
} from '@/lib/nativeBridge';
import { parseNativeOAuthCallback } from '@/lib/nativeOAuthCallback';
import { supabase } from '@/lib/supabase';

export type HyperOAuthProvider = Extract<Provider, 'google' | 'apple'>;

export function getAuthRedirectTo(): string | undefined {
  if (isNativeIOS()) return NATIVE_AUTH_REDIRECT_URL;
  if (typeof window === 'undefined' || !window.location?.origin) return undefined;
  return `${window.location.origin}/`;
}

export async function signInWithOAuthProvider(
  provider: HyperOAuthProvider,
): Promise<{ error: Error | null }> {
  const redirectTo = getAuthRedirectTo();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      ...(redirectTo ? { redirectTo } : {}),
      skipBrowserRedirect: true,
    },
  });

  if (error) return { error: new Error(error.message) };
  if (!data?.url) return { error: new Error('The sign-in provider did not return a login URL.') };

  if (!isNativeIOS()) {
    window.location.assign(data.url);
    return { error: null };
  }

  try {
    const { callbackUrl } = await NativeAuth.openOAuth({
      url: data.url,
      callbackScheme: NATIVE_AUTH_CALLBACK_SCHEME,
      callbackHost: 'auth',
      callbackPath: '/callback',
    });
    const { code } = parseNativeOAuthCallback(callbackUrl);
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    return { error: exchangeError ? new Error(exchangeError.message) : null };
  } catch (nativeError) {
    return {
      error: nativeError instanceof Error ? nativeError : new Error('Unable to complete sign-in.'),
    };
  }
}
