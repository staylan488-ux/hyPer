// Sign in with Apple token revocation, for account deletion (Apple's account
// deletion guidance asks apps with Sign in with Apple to revoke the user's
// tokens). Checked against Apple's documentation on 2026-11-11:
//   Revoke tokens: POST https://appleid.apple.com/auth/revoke, form-encoded
//   client_id, client_secret, token, token_type_hint (refresh_token or
//   access_token). 200 with no body when revoked or already invalid.
//   Creating a client secret: an ES256 JWT, header alg + kid (the key's
//   10-character id), claims iss (Team ID), iat, exp (at most 15,777,000
//   seconds, six months, ahead), aud https://appleid.apple.com, sub (the same
//   App ID or Services ID used as client_id).
// client_id must be the identifier the token was issued to. Supabase's web
// sign-in sheet uses the first client ID in its Apple provider settings (the
// Services ID), so APPLE_CLIENT_ID must name that one.
// Kept free of Deno imports so tests can run it.

export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

export interface AppleSigningConfig {
  teamId: string;
  keyId: string;
  clientId: string;
  /** The .p8 key's PEM text (PKCS #8, P-256). */
  privateKeyPem: string;
}

/** The config from environment values, or null when any part is missing. */
export function appleConfigFrom(get: (name: string) => string | undefined): AppleSigningConfig | null {
  const teamId = get('APPLE_TEAM_ID')?.trim();
  const keyId = get('APPLE_KEY_ID')?.trim();
  const clientId = get('APPLE_CLIENT_ID')?.trim();
  // Secrets often hold the key with escaped line breaks.
  const privateKeyPem = get('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n').trim();
  return teamId && keyId && clientId && privateKeyPem ? { teamId, keyId, clientId, privateKeyPem } : null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemBytes(pem: string): ArrayBuffer {
  const binary = atob(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, ''));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

/** A short-lived client secret (five minutes is plenty for one request). */
export async function appleClientSecret(config: AppleSigningConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const encoder = new TextEncoder();
  const header = base64Url(encoder.encode(JSON.stringify({ alg: 'ES256', kid: config.keyId })));
  const claims = base64Url(encoder.encode(JSON.stringify({
    iss: config.teamId, iat: nowSeconds, exp: nowSeconds + 300, aud: 'https://appleid.apple.com', sub: config.clientId,
  })));
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(config.privateKeyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto's ECDSA signature is already the raw r||s form a JWT uses.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${header}.${claims}`)));
  return `${header}.${claims}.${base64Url(signature)}`;
}

/** Tells Apple to revoke a user's refresh token. Throws unless Apple answers 200. */
export async function revokeAppleRefreshToken(
  refreshToken: string,
  config: AppleSigningConfig,
  send: typeof fetch = fetch,
): Promise<void> {
  const response = await send(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: await appleClientSecret(config),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200) throw new Error(`Apple revoke failed (${response.status})`);
}
