// Strava OAuth custodian, mirroring whoop-oauth (verify_jwt = false because
// the /callback leg is a browser redirect; auth is enforced in-code).
//   POST {action:'start'}      — Supabase JWT required; returns the authorize URL
//   GET  /callback?code&state  — authenticated by the HMAC-signed state
//   POST {action:'disconnect'} — Supabase JWT required; deauthorizes + deletes
// Strava specifics: comma-separated scopes, ~6h access tokens with epoch
// `expires_at`, ROTATING refresh tokens, athlete embedded in the token response.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders, jsonResponse, signOAuthState, verifyOAuthState } from '../_shared/oauth.ts';

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_DEAUTH_URL = 'https://www.strava.com/oauth/deauthorize';
const STRAVA_SCOPES = 'read,activity:read_all';

interface OAuthActionRequest {
  action?: 'start' | 'disconnect';
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  athlete?: { id?: number | string } | null;
  scope?: string;
}

function getEnv() {
  const env = {
    clientId: Deno.env.get('STRAVA_CLIENT_ID') ?? '',
    clientSecret: Deno.env.get('STRAVA_CLIENT_SECRET') ?? '',
    stateSecret: Deno.env.get('STRAVA_STATE_SECRET') ?? '',
    appBaseUrl: (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, ''),
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  };
  const missing = Object.entries(env)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return { env, missing };
}

function callbackUrl(supabaseUrl: string): string {
  return `${supabaseUrl}/functions/v1/strava-oauth/callback`;
}

async function requireUser(req: Request, supabaseUrl: string, anonKey: string): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { env, missing } = getEnv();
  if (missing.length > 0) {
    return jsonResponse({ error: `strava-oauth is not configured. Missing: ${missing.join(', ')}` }, 500);
  }

  const url = new URL(req.url);

  /* ── GET /callback — browser redirect from Strava consent ── */
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
    const redirectTo = (status: 'connected' | 'error') =>
      new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: `${env.appBaseUrl}/settings?strava=${status}` },
      });

    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) return redirectTo('error');

      const payload = await verifyOAuthState(env.stateSecret, state);
      if (!payload) return redirectTo('error');

      const tokenResponse = await fetch(STRAVA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.clientId,
          client_secret: env.clientSecret,
          code,
          grant_type: 'authorization_code',
        }).toString(),
      });
      if (!tokenResponse.ok) {
        console.error('strava token exchange failed:', tokenResponse.status, await tokenResponse.text().catch(() => ''));
        return redirectTo('error');
      }
      const tokens = (await tokenResponse.json()) as StravaTokenResponse;

      const service = createClient(env.supabaseUrl, env.serviceRoleKey);
      const nowIso = new Date().toISOString();

      const { error: tokenError } = await service.from('strava_tokens').upsert({
        user_id: payload.userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(tokens.expires_at * 1000).toISOString(),
        updated_at: nowIso,
      });
      if (tokenError) throw tokenError;

      const { error: connectionError } = await service.from('strava_connections').upsert({
        user_id: payload.userId,
        strava_athlete_id: tokens.athlete?.id != null ? String(tokens.athlete.id) : null,
        scopes: tokens.scope ?? STRAVA_SCOPES,
        connected_at: nowIso,
        updated_at: nowIso,
      });
      if (connectionError) throw connectionError;

      return redirectTo('connected');
    } catch (error) {
      console.error('strava-oauth callback failed:', error);
      return redirectTo('error');
    }
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const userId = await requireUser(req, env.supabaseUrl, env.anonKey);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const body = (await req.json().catch(() => ({}))) as OAuthActionRequest;

  /* ── POST {action:'start'} ── */
  if (body.action === 'start') {
    const state = await signOAuthState(env.stateSecret, userId);
    const authorize = new URL(STRAVA_AUTH_URL);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', env.clientId);
    authorize.searchParams.set('redirect_uri', callbackUrl(env.supabaseUrl));
    authorize.searchParams.set('scope', STRAVA_SCOPES);
    authorize.searchParams.set('approval_prompt', 'auto');
    authorize.searchParams.set('state', state);
    return jsonResponse({ authorizeUrl: authorize.toString() });
  }

  /* ── POST {action:'disconnect'} ── */
  if (body.action === 'disconnect') {
    const service = createClient(env.supabaseUrl, env.serviceRoleKey);

    try {
      const { data: tokenRow } = await service
        .from('strava_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .maybeSingle();
      if (tokenRow?.access_token) {
        await fetch(STRAVA_DEAUTH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ access_token: tokenRow.access_token }).toString(),
        });
      }
    } catch (error) {
      console.error('strava deauthorize failed (continuing with local delete):', error);
    }

    await service.from('strava_tokens').delete().eq('user_id', userId);
    await service.from('strava_connections').delete().eq('user_id', userId);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
