import { describe, expect, it, vi } from 'vitest';
import {
  fetchBetaAccess,
  friendlyAuthError,
  SIGNUP_PRIVATE_BETA_MESSAGE,
} from '@/lib/betaAccess';
import { authScreen } from '@/lib/authScreen';
import { isApprovedUser, PRIVATE_BETA_ERROR } from '../supabase/functions/_shared/approval';

const approval = (result: { data: unknown; error: { code?: string; message?: string } | null }) =>
  vi.fn(async () => result);

describe('private beta access check (client)', () => {
  it('reports approved only when the own approved_users row exists', async () => {
    expect(await fetchBetaAccess(approval({ data: { user_id: 'u1' }, error: null }))).toBe('approved');
    expect(await fetchBetaAccess(approval({ data: null, error: null }))).toBe('not-approved');
  });

  it('never locks anyone out on a transient failure; the server still enforces access', async () => {
    expect(await fetchBetaAccess(approval({ data: null, error: { code: 'PGRST301', message: 'timeout' } }))).toBe('unknown');
    expect(await fetchBetaAccess(vi.fn(async () => { throw new TypeError('Failed to fetch'); }))).toBe('unknown');
  });

  it('keeps the app open before the migration has created the table', async () => {
    expect(await fetchBetaAccess(approval({ data: null, error: { code: 'PGRST205', message: 'missing table' } }))).toBe('approved');
    expect(await fetchBetaAccess(approval({ data: null, error: { code: '42P01', message: 'relation does not exist' } }))).toBe('approved');
  });

  it('shows the private-beta screen only for a signed-in account confirmed as not approved', () => {
    const base = { initialized: true, user: { id: 'u1' }, reconnecting: false };
    expect(authScreen({ ...base, betaAccess: 'not-approved' })).toBe('private-beta');
    expect(authScreen({ ...base, betaAccess: 'approved' })).toBe('app');
    expect(authScreen({ ...base, betaAccess: 'unknown' })).toBe('app');
    expect(authScreen(base)).toBe('app');
    expect(authScreen({ ...base, user: null, betaAccess: 'not-approved' })).toBe('sign-in');
    expect(authScreen({ ...base, initialized: false, betaAccess: 'not-approved' })).toBe('boot');
  });

  it('translates refused sign-ups into the private-beta message and leaves other errors alone', () => {
    for (const message of [
      'Database error saving new user',
      'Signups not allowed for this instance',
      'signup_disabled',
      'hyPer is in private beta: someone@example.com is not invited',
    ]) {
      expect(friendlyAuthError(message)).toBe(SIGNUP_PRIVATE_BETA_MESSAGE);
    }
    expect(friendlyAuthError('Invalid login credentials')).toBe('Invalid login credentials');
  });
});

describe('private beta gate (Edge Functions)', () => {
  const client = (result: { data: unknown; error: unknown }) => {
    const chain = {
      from: vi.fn(() => chain),
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => result),
    };
    return chain;
  };

  it('looks up the caller in approved_users', async () => {
    const approved = client({ data: { user_id: 'u1' }, error: null });
    expect(await isApprovedUser(approved, 'u1')).toBe(true);
    expect(approved.from).toHaveBeenCalledWith('approved_users');
    expect(approved.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(await isApprovedUser(client({ data: null, error: null }), 'u2')).toBe(false);
  });

  it('throws on lookup failure so callers fail closed', async () => {
    await expect(isApprovedUser(client({ data: null, error: { message: 'boom' } }), 'u1')).rejects.toThrow('Approval check failed');
  });

  it('returns a stable error code the app can recognize', () => {
    expect(PRIVATE_BETA_ERROR.code).toBe('not_approved');
  });
});
