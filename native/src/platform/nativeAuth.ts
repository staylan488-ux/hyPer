// Replaces ../src/lib/nativeAuth.ts (see metro.config.js).
//
// Google sign-in will use the system web-authentication sheet. Until it is
// built, the provider button reports that it is not ready instead of trying
// the browser redirect the web app uses.
import type { Provider } from '@supabase/supabase-js';

import { NATIVE_AUTH_REDIRECT_URL } from './nativeBridge';

export type HyperOAuthProvider = Extract<Provider, 'google' | 'apple'>;

export function getAuthRedirectTo(): string | undefined {
  return NATIVE_AUTH_REDIRECT_URL;
}

export async function signInWithOAuthProvider(
  _provider: HyperOAuthProvider,
): Promise<{ error: Error | null }> {
  return { error: new Error('Signing in with a provider is not available in the native app yet.') };
}
