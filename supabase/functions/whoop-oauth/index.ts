// WHOOP OAuth custodian. Deployed with verify_jwt = false (see config.toml)
// because the /callback leg is a browser redirect from WHOOP with no Supabase
// JWT. Auth is enforced in-code instead:
//   POST {action:'start'}      — Supabase JWT required; returns the authorize URL
//   GET  /callback?code&state  — authenticated by the HMAC-signed state
//   POST {action:'disconnect'} — Supabase JWT required; revokes + deletes tokens
// Tokens are written only here, with the service role; they never reach the client.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  WHOOP_API_BASE,
  WHOOP_AUTH_URL,
  WHOOP_SCOPES,
  corsHeaders,
  exchangeAuthorizationCode,
  jsonResponse,
  signOAuthState,
  verifyOAuthState,
} from '../_shared/whoop.ts';

interface OAuthActionRequest {
  action?: 'start' | 'disconnect';
  returnTo?: string;
}

function getEnv() {
  const env = {
    clientId: Deno.env.get('WHOOP_CLIENT_ID') ?? '',
    clientSecret: Deno.env.get('WHOOP_CLIENT_SECRET') ?? '',
    stateSecret: Deno.env.get('WHOOP_STATE_SECRET') ?? '',
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
  return `${supabaseUrl}/functions/v1/whoop-oauth/callback`;
}

function allowedReturnTo(value: string | undefined, appBaseUrl: string): string {
  const webDefault = `${appBaseUrl}/settings`;
  if (!value) return webDefault;
  if (value === 'app.hyper.mobile://settings') return value;
  try {
    const requested = new URL(value);
    const configured = new URL(appBaseUrl);
    if (requested.origin === configured.origin && requested.pathname === '/settings') {
      return requested.toString().replace(/[?&]whoop=[^&]*/g, '');
    }
  } catch {
    // Invalid return destinations fall back to the configured web app.
  }
  return webDefault;
}

function withWhoopStatus(returnTo: string, status: 'connected' | 'error'): string {
  const url = new URL(returnTo);
  url.searchParams.set('whoop', status);
  return url.toString();
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

async function fetchWhoopUserId(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(`${WHOOP_API_BASE}/v2/user/profile/basic`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const profile = (await response.json()) as { user_id?: number | string };
    return profile.user_id != null ? String(profile.user_id) : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { env, missing } = getEnv();
  if (missing.length > 0) {
    return jsonResponse({ error: `whoop-oauth is not configured. Missing: ${missing.join(', ')}` }, 500);
  }

  const url = new URL(req.url);

  /* ── GET /callback — browser redirect from WHOOP consent ── */
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
    const redirectTo = (status: 'connected' | 'error', returnTo = `${env.appBaseUrl}/settings`) =>
      new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: withWhoopStatus(returnTo, status) },
      });

    let callbackReturnTo = `${env.appBaseUrl}/settings`;
    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!state) return redirectTo('error');

      const payload = await verifyOAuthState(env.stateSecret, state);
      if (!payload) return redirectTo('error');
      callbackReturnTo = allowedReturnTo(payload.returnTo, env.appBaseUrl);
      if (!code) return redirectTo('error', callbackReturnTo);

      const tokens = await exchangeAuthorizationCode({
        code,
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        redirectUri: callbackUrl(env.supabaseUrl),
      });

      const service = createClient(env.supabaseUrl, env.serviceRoleKey);
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      const { error: tokenError } = await service.from('whoop_tokens').upsert({
        user_id: payload.userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        updated_at: nowIso,
      });
      if (tokenError) throw tokenError;

      const whoopUserId = await fetchWhoopUserId(tokens.access_token);
      const { error: connectionError } = await service.from('whoop_connections').upsert({
        user_id: payload.userId,
        whoop_user_id: whoopUserId,
        scopes: tokens.scope ?? WHOOP_SCOPES,
        connected_at: nowIso,
        updated_at: nowIso,
      });
      if (connectionError) throw connectionError;

      return redirectTo('connected', callbackReturnTo);
    } catch (error) {
      console.error('whoop-oauth callback failed:', error);
      return redirectTo('error', callbackReturnTo);
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
    const returnTo = allowedReturnTo(body.returnTo, env.appBaseUrl);
    const state = await signOAuthState(env.stateSecret, userId, 10 * 60 * 1000, returnTo);
    const authorize = new URL(WHOOP_AUTH_URL);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', env.clientId);
    authorize.searchParams.set('redirect_uri', callbackUrl(env.supabaseUrl));
    authorize.searchParams.set('scope', WHOOP_SCOPES);
    authorize.searchParams.set('state', state);
    return jsonResponse({ authorizeUrl: authorize.toString() });
  }

  /* ── POST {action:'disconnect'} ── */
  if (body.action === 'disconnect') {
    const service = createClient(env.supabaseUrl, env.serviceRoleKey);

    // best-effort remote revoke; local deletion is the source of truth
    try {
      const { data: tokenRow } = await service
        .from('whoop_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .maybeSingle();
      if (tokenRow?.access_token) {
        await fetch(`${WHOOP_API_BASE}/v2/user/access`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenRow.access_token}` },
        });
      }
    } catch (error) {
      console.error('whoop revoke failed (continuing with local delete):', error);
    }

    await service.from('whoop_tokens').delete().eq('user_id', userId);
    await service.from('whoop_connections').delete().eq('user_id', userId);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
