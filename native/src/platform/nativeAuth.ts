// Replaces ../src/lib/nativeAuth.ts (see metro.config.js).
//
// Google sign-in will use the system web-authentication sheet. Until it is
// built, the provider button reports that it is not ready instead of trying
// the browser redirect the web app uses.
import type { Provider } from '@supabase/supabase-js';

export type HyperOAuthProvider = Extract<Provider, 'google' | 'apple'>;

export function getAuthRedirectTo(): string | undefined {
  return 'hyper-native://auth/callback';
}

export async function signInWithOAuthProvider(
  _provider: HyperOAuthProvider,
): Promise<{ error: Error | null }> {
  return { error: new Error('Signing in with a provider is not available in the native app yet.') };
}
