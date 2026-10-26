import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

// The native app swaps @/lib/nativeBridge for its own (native/metro.config.js).
// Run the shared OAuth callback parser against that swap.
vi.mock('@/lib/nativeBridge', () => import('../native/src/platform/nativeBridge'));

import { parseNativeOAuthCallback } from '@/lib/nativeOAuthCallback';

import { NATIVE_AUTH_CALLBACK_SCHEME } from '../native/src/platform/nativeBridge';

const appConfig = JSON.parse(readFileSync(new URL('../native/app.json', import.meta.url), 'utf8')) as {
  expo: { scheme: string };
};

describe('native app sign-in callback', () => {
  it('uses the URL scheme the native app registers', () => {
    expect(NATIVE_AUTH_CALLBACK_SCHEME).toBe(appConfig.expo.scheme);
  });

  it('accepts its own callback and returns the PKCE code', () => {
    expect(parseNativeOAuthCallback('hyper-native://auth/callback?code=pkce-code')).toEqual({
      code: 'pkce-code',
    });
  });

  it("rejects the Capacitor app's callback while both apps are installed", () => {
    expect(() => parseNativeOAuthCallback('app.hyper.mobile://auth/callback?code=pkce-code')).toThrow(
      'did not belong to hyPer',
    );
  });
});
