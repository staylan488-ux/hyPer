import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { APPLE_REVOKE_URL, appleClientSecret, appleConfigFrom, revokeAppleRefreshToken } from '../supabase/functions/_shared/apple';
import { createDeleteAccountHandler, type DeleteAccountServices } from '../supabase/functions/delete-account/handler';

const USER = '11111111-1111-4111-8111-111111111111';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const config = {
  teamId: 'TEAM123456',
  keyId: 'KEY1234567',
  clientId: 'app.hyper.signin',
  privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
};
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('Sign in with Apple client secret', () => {
  it('is an ES256 JWT with the claims Apple asks for, signed by the key', async () => {
    const jwt = await appleClientSecret(config, 1_800_000_000);
    const [header, claims, signature] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'ES256', kid: 'KEY1234567' });
    expect(decode(claims)).toEqual({ iss: 'TEAM123456', iat: 1_800_000_000, exp: 1_800_000_300, aud: 'https://appleid.apple.com', sub: 'app.hyper.signin' });
    const valid = verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
    expect(valid).toBe(true);
  });

  it('reads its settings from the environment, with escaped line breaks, and needs all four', () => {
    const env: Record<string, string> = {
      APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_CLIENT_ID: 'app.hyper.signin',
      APPLE_PRIVATE_KEY: config.privateKeyPem.replace(/\n/g, '\\n'),
    };
    expect(appleConfigFrom(name => env[name])).toEqual({ ...config, privateKeyPem: config.privateKeyPem.trim() });
    expect(appleConfigFrom(name => (name === 'APPLE_KEY_ID' ? undefined : env[name]))).toBeNull();
  });
});

describe('revoking an Apple refresh token', () => {
  it('posts the documented form to Apple', async () => {
    const send = vi.fn(async () => new Response(null, { status: 200 }));
    await revokeAppleRefreshToken('apple-refresh', config, send as unknown as typeof fetch);
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(APPLE_REVOKE_URL);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = init.body as URLSearchParams;
    expect(form.get('client_id')).toBe('app.hyper.signin');
    expect(form.get('token')).toBe('apple-refresh');
    expect(form.get('token_type_hint')).toBe('refresh_token');
    expect(form.get('client_secret')?.split('.')).toHaveLength(3);
  });

  it('throws on anything but 200', async () => {
    const send = vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 400 }));
    await expect(revokeAppleRefreshToken('apple-refresh', config, send as unknown as typeof fetch)).rejects.toThrow('400');
  });
});

describe('account deletion and Apple', () => {
  function services(overrides: Partial<DeleteAccountServices> = {}) {
    const steps: string[] = [];
    const s: DeleteAccountServices = {
      authenticate: vi.fn(async () => USER),
      whoopAccess: vi.fn(async () => null),
      revokeWhoop: vi.fn(async () => {}),
      appleRefreshToken: vi.fn(async (id: string) => { steps.push(`apple-token:${id}`); return 'apple-refresh'; }),
      revokeApple: vi.fn(async (token: string) => { steps.push(`apple:${token}`); }),
      removeFoodRecords: vi.fn(async (id: string) => { steps.push(`food:${id}`); }),
      deleteUser: vi.fn(async (id: string) => { steps.push(`user:${id}`); }),
      log: vi.fn(),
      ...overrides,
    };
    return { steps, s };
  }
  const post = () => new Request('https://example.invalid', { method: 'POST', headers: { Authorization: 'Bearer good' } });

  it('reads the token first and revokes it only once the account is gone', async () => {
    const { steps, s } = services();
    expect((await createDeleteAccountHandler(s)(post())).status).toBe(200);
    expect(steps).toEqual([`apple-token:${USER}`, `food:${USER}`, `user:${USER}`, 'apple:apple-refresh']);
  });

  it('keeps the Apple link when the account was not deleted', async () => {
    const { s } = services({ deleteUser: vi.fn(async () => { throw new Error('down'); }) });
    expect((await createDeleteAccountHandler(s)(post())).status).toBe(500);
    expect(s.revokeApple).not.toHaveBeenCalled();
  });

  it('still deletes when the token cannot be read or Apple refuses', async () => {
    const unread = services({ appleRefreshToken: vi.fn(async () => { throw new Error('read failed'); }) });
    expect((await createDeleteAccountHandler(unread.s)(post())).status).toBe(200);
    expect(unread.s.revokeApple).not.toHaveBeenCalled();
    const refused = services({ revokeApple: vi.fn(async () => { throw new Error('Apple revoke failed (400)'); }) });
    expect((await createDeleteAccountHandler(refused.s)(post())).status).toBe(200);
    expect(refused.s.deleteUser).toHaveBeenCalledOnce();
    expect(refused.s.log).toHaveBeenCalledWith('delete-account: Apple revoke failed (the account is deleted)', expect.any(Error));
  });

  it('tells Apple nothing for an account without an Apple token', async () => {
    const { s } = services({ appleRefreshToken: vi.fn(async () => null) });
    expect((await createDeleteAccountHandler(s)(post())).status).toBe(200);
    expect(s.revokeApple).not.toHaveBeenCalled();
  });
});
