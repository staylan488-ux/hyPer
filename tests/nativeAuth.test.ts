import { describe, expect, it } from 'vitest';

import { parseNativeOAuthCallback } from '@/lib/nativeOAuthCallback';

describe('native OAuth callback validation', () => {
  it('accepts only the expected hyPer callback and returns its PKCE code', () => {
    expect(parseNativeOAuthCallback('com.alexanderroesler.hyper://auth/callback?code=pkce-code')).toEqual({
      code: 'pkce-code',
    });
  });

  it('rejects callbacks for another app or path', () => {
    expect(() => parseNativeOAuthCallback('other://auth/callback?code=stolen')).toThrow(
      'did not belong to hyPer',
    );
    expect(() => parseNativeOAuthCallback('com.alexanderroesler.hyper://auth/wrong?code=stolen')).toThrow(
      'did not belong to hyPer',
    );
  });

  it('surfaces provider errors and missing authorization codes', () => {
    expect(() => parseNativeOAuthCallback(
      'com.alexanderroesler.hyper://auth/callback?error_description=Access%20denied',
    )).toThrow('Access denied');
    expect(() => parseNativeOAuthCallback('com.alexanderroesler.hyper://auth/callback')).toThrow(
      'did not return an authorization code',
    );
  });
});
