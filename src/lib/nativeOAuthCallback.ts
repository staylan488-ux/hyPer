import { NATIVE_AUTH_REDIRECT_URL } from '@/lib/nativeBridge';

export function parseNativeOAuthCallback(callbackUrl: string): { code: string } {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new Error('The sign-in provider returned an invalid callback.');
  }

  if (`${url.protocol}//${url.hostname}${url.pathname}` !== NATIVE_AUTH_REDIRECT_URL) {
    throw new Error('The sign-in callback did not belong to hyPer.');
  }

  const providerError = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (providerError) throw new Error(providerError);

  const code = url.searchParams.get('code');
  if (!code) throw new Error('The sign-in provider did not return an authorization code.');
  return { code };
}

