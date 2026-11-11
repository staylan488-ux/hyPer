import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn(async () => ({ data: true, error: null })));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { rememberAppleRefreshToken } from '@/lib/appleSignIn';

const session = (token?: string) => ({ provider_refresh_token: token }) as never;

beforeEach(() => rpc.mockClear());

describe('the Apple refresh token after sign-in', () => {
  it('goes to the server after an Apple sign-in', async () => {
    await rememberAppleRefreshToken('apple', session('apple-refresh'));
    expect(rpc).toHaveBeenCalledWith('save_apple_refresh_token', { p_refresh_token: 'apple-refresh' });
  });

  it('is not sent for Google, or when Supabase passed none', async () => {
    await rememberAppleRefreshToken('google', session('google-refresh'));
    await rememberAppleRefreshToken('apple', session());
    await rememberAppleRefreshToken('apple', null);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never throws into sign-in', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    await expect(rememberAppleRefreshToken('apple', session('apple-refresh'))).resolves.toBeUndefined();
  });
});
