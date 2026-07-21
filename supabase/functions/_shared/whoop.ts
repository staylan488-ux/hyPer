// WHOOP-specific Edge Function helpers: endpoints + token exchange/refresh.
// Generic CORS/JSON/signed-state helpers live in ./oauth.ts and are re-exported
// here so the whoop-* functions keep a single import.

export {
  corsHeaders,
  jsonResponse,
  signOAuthState,
  verifyOAuthState,
  type OAuthStatePayload,
} from './oauth.ts';

export const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
export const WHOOP_SCOPES = 'read:workout offline';

/* ── Token endpoint calls ── */

export interface WhoopTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

async function postTokenForm(form: Record<string, string>): Promise<WhoopTokenResponse> {
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`whoop token endpoint ${response.status}: ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as WhoopTokenResponse;
}

export function exchangeAuthorizationCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<WhoopTokenResponse> {
  return postTokenForm({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  });
}

// WHOOP rotates refresh tokens: the returned pair replaces BOTH stored tokens
export function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<WhoopTokenResponse> {
  return postTokenForm({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    scope: 'offline',
  });
}
