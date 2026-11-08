import { describe, expect, it } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';

const { authErrorWords } = loadNativeModule<{ authErrorWords: (message: string) => string }>('lib/auth.ts', {
  zustand: { create: () => () => ({}) },
  '@/lib/authScreen': { authScreen: () => 'app' },
  '@/stores/authStore': { useAuthStore: () => null },
});

describe('sign-in errors in plain words', () => {
  it('says a wrong email or password plainly', () => {
    expect(authErrorWords('Invalid login credentials')).toBe('That email and password don’t match. Check them and try again.');
  });

  it('says no connection plainly', () => {
    expect(authErrorWords('TypeError: Network request failed')).toBe('Couldn’t reach hyPer. Check your connection and try again.');
    expect(authErrorWords('Failed to fetch')).toBe('Couldn’t reach hyPer. Check your connection and try again.');
  });

  it('says a rate limit plainly', () => {
    expect(authErrorWords('email rate limit exceeded')).toBe('Too many tries for now. Wait a minute, then try again.');
    expect(authErrorWords('For security purposes, you can only request this after 42 seconds.')).toBe('Too many tries for now. Wait a minute, then try again.');
  });

  it('says a reused password plainly', () => {
    expect(authErrorWords('New password should be different from the old password.')).toBe('That’s your current password. Choose a new one.');
  });

  it('keeps any other message as written', () => {
    expect(authErrorWords('Please verify your email before signing in.')).toBe('Please verify your email before signing in.');
  });
});
