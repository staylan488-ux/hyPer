import { describe, expect, it } from 'vitest';

import { isInviteRefusal } from '@/lib/betaAccess';
import { loadNativeModule } from './helpers/loadNativeModule';

let signupMode: 'open' | 'invite_only' | null = null;
const { authErrorWords } = loadNativeModule<{ authErrorWords: (message: string) => string }>('lib/auth.ts', {
  zustand: { create: () => () => ({}) },
  '~/lib/appConfig': {
    useAppConfigStore: { getState: () => ({ config: signupMode ? { signupMode, aiEnabled: true, minAppVersion: null } : null }) },
    useUpdateRequired: () => false,
  },
  '@/lib/authScreen': { authScreen: () => 'app' },
  '@/lib/betaAccess': { isInviteRefusal },
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

  it('says a sign-up the invite list refused plainly, however Supabase Auth words it', () => {
    const invite = 'hyPer is invite-only for now. Use the email your invite was sent to.';
    expect(authErrorWords('Database error saving new user')).toBe(invite);
    expect(authErrorWords('hyPer is invite-only: this email is not invited')).toBe(invite);
    expect(authErrorWords('Signups not allowed for this instance')).toBe(invite);
    expect(authErrorWords('signup_disabled')).toBe(invite);
  });

  it('says a refused sign-up without mentioning invites while sign-up is open', () => {
    signupMode = 'open';
    try {
      expect(authErrorWords('Database error saving new user')).toBe('This email can’t sign up for hyPer. If that seems wrong, contact support.');
    } finally {
      signupMode = null;
    }
    signupMode = 'invite_only';
    try {
      expect(authErrorWords('Database error saving new user')).toBe('hyPer is invite-only for now. Use the email your invite was sent to.');
    } finally {
      signupMode = null;
    }
  });

  it('says a reused password plainly', () => {
    expect(authErrorWords('New password should be different from the old password.')).toBe('That’s your current password. Choose a new one.');
  });

  it('keeps any other message as written', () => {
    expect(authErrorWords('Please verify your email before signing in.')).toBe('Please verify your email before signing in.');
  });
});
