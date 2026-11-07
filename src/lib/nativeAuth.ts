// Google and Apple sign-in for shared code outside the app. The app signs in
// through native/src/platform/nativeAuth.ts instead (iOS's sign-in sheet), which
// native/metro.config.js swaps in for this file; it must stay so the swap can
// resolve. This default sends the page to the provider and back.
import type { Provider } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type HyperOAuthProvider = Extract<Provider, 'google' | 'apple'>;

export function getAuthRedirectTo(): string | undefined {
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

  window.location.assign(data.url);
  return { error: null };
}
