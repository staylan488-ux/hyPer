import { describe, expect, it, vi } from 'vitest';

import { fetchPublicConfig, isOlderThan, parsePublicConfig } from '@/lib/appConfig';
import { authScreen } from '@/lib/authScreen';

describe('the server’s public switches', () => {
  it('reads a clear answer', () => {
    expect(parsePublicConfig({ signup_mode: 'open', ai_enabled: true, min_app_version: null })).toEqual({ signupMode: 'open', aiEnabled: true, minAppVersion: null });
    expect(parsePublicConfig({ signup_mode: 'invite_only', ai_enabled: false, min_app_version: '2.0.4' })).toEqual({ signupMode: 'invite_only', aiEnabled: false, minAppVersion: '2.0.4' });
  });

  it('treats anything unclear as no answer', () => {
    expect(parsePublicConfig(null)).toBeNull();
    expect(parsePublicConfig([])).toBeNull();
    expect(parsePublicConfig({ signup_mode: 'closed', ai_enabled: true })).toBeNull();
    expect(parsePublicConfig({ signup_mode: 'open', ai_enabled: 'yes' })).toBeNull();
    expect(parsePublicConfig({ signup_mode: 'open', ai_enabled: true, min_app_version: 'latest' })).toBeNull();
  });

  it('turns errors, throws and slow answers into no answer', async () => {
    expect(await fetchPublicConfig(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }))).toBeNull();
    expect(await fetchPublicConfig(() => { throw new TypeError('Network request failed'); })).toBeNull();
    vi.useFakeTimers();
    try {
      const pending = fetchPublicConfig(() => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(await fetchPublicConfig(async () => ({ data: { signup_mode: 'open', ai_enabled: true, min_app_version: '2.1' }, error: null }))).toMatchObject({ minAppVersion: '2.1' });
  });
});

describe('the oldest build the server allows', () => {
  it('compares versions part by part', () => {
    expect(isOlderThan('2.0.3', '2.0.4')).toBe(true);
    expect(isOlderThan('2.0.4', '2.0.4')).toBe(false);
    expect(isOlderThan('2.0.10', '2.0.9')).toBe(false);
    expect(isOlderThan('2.0.9', '2.0.10')).toBe(true);
    expect(isOlderThan('2.1.0', '2.0.10')).toBe(false);
    expect(isOlderThan('1.9.9', '2')).toBe(true);
    expect(isOlderThan('2.0.0', '2')).toBe(false);
  });

  it('never locks anyone out on a value it can’t read', () => {
    expect(isOlderThan('', '2.0.4')).toBe(false);
    expect(isOlderThan(undefined, '2.0.4')).toBe(false);
    expect(isOlderThan('2.0.3', null)).toBe(false);
    expect(isOlderThan('2.0.3-beta', '2.0.4')).toBe(false);
  });

  it('asks for the update before anything else, signed in or not', () => {
    expect(authScreen({ initialized: true, user: { id: 'a' }, reconnecting: false, betaAccess: 'approved', updateRequired: true })).toBe('update');
    expect(authScreen({ initialized: true, user: null, reconnecting: false, updateRequired: true })).toBe('update');
    expect(authScreen({ initialized: true, user: null, reconnecting: true, updateRequired: true })).toBe('update');
    // Still the launch screen until the saved session is read.
    expect(authScreen({ initialized: false, user: null, reconnecting: false, updateRequired: true })).toBe('boot');
    expect(authScreen({ initialized: true, user: { id: 'a' }, reconnecting: false, updateRequired: false })).toBe('app');
  });
});
