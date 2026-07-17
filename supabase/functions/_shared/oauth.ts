// Provider-agnostic OAuth helpers used by the WHOOP Edge Functions and kept
// reusable for future integrations:
// CORS, JSON responses, and the stateless HMAC-signed OAuth `state` parameter
// that binds a browser callback to the Supabase user who initiated it.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/* ── Stateless signed OAuth state: base64url(payload).base64url(hmac) ── */

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(signature);
}

export interface OAuthStatePayload {
  userId: string;
  expiresAtMs: number;
  nonce: string;
}

export async function signOAuthState(secret: string, userId: string, ttlMs = 10 * 60 * 1000): Promise<string> {
  const payload: OAuthStatePayload = {
    userId,
    expiresAtMs: Date.now() + ttlMs,
    nonce: crypto.randomUUID(),
  };
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const mac = base64UrlEncode(await hmacSha256(secret, encoded));
  return `${encoded}.${mac}`;
}

export async function verifyOAuthState(secret: string, state: string): Promise<OAuthStatePayload | null> {
  const [encoded, mac] = state.split('.');
  if (!encoded || !mac) return null;

  const expected = base64UrlEncode(await hmacSha256(secret, encoded));
  if (expected !== mac) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as OAuthStatePayload;
    if (!payload.userId || typeof payload.expiresAtMs !== 'number') return null;
    if (payload.expiresAtMs < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
