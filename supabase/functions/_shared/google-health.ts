import { corsHeaders, jsonResponse, signOAuthState, verifyOAuthState } from './oauth.ts';

export { corsHeaders, jsonResponse, signOAuthState, verifyOAuthState };

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_HEALTH_API_BASE = 'https://health.googleapis.com/v4';
export const GOOGLE_HEALTH_SCOPES = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly';

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  token_type: string;
}

async function tokenRequest(params: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google token endpoint ${response.status}: ${detail.slice(0, 200)}`);
  }
  return await response.json() as GoogleTokenResponse;
}

export function exchangeGoogleHealthCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  return tokenRequest(new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  }));
}

export function refreshGoogleHealthToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  return tokenRequest(new URLSearchParams({
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
  }));
}
