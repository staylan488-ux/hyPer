// Google Health OAuth custodian. The callback has no Supabase JWT, so it is
// bound to the initiating user with a signed, short-lived state parameter.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  GOOGLE_AUTH_URL,
  GOOGLE_HEALTH_API_BASE,
  GOOGLE_HEALTH_SCOPES,
  GOOGLE_REVOKE_URL,
  corsHeaders,
  exchangeGoogleHealthCode,
  jsonResponse,
  signOAuthState,
  verifyOAuthState,
} from '../_shared/google-health.ts';

interface OAuthActionRequest {
  action?: 'start' | 'disconnect';
}

function getEnv() {
  const env = {
    clientId: Deno.env.get('GOOGLE_HEALTH_CLIENT_ID') ?? '',
    clientSecret: Deno.env.get('GOOGLE_HEALTH_CLIENT_SECRET') ?? '',
    stateSecret: Deno.env.get('GOOGLE_HEALTH_STATE_SECRET') ?? '',
    appBaseUrl: (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, ''),
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  };
  const missing = Object.entries(env).filter(([, value]) => !value).map(([key]) => key);
  return { env, missing };
}

function callbackUrl(supabaseUrl: string): string {
  return `${supabaseUrl}/functions/v1/google-health-oauth/callback`;
}

async function requireUser(req: Request, supabaseUrl: string, anonKey: string): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

async function fetchHealthUserId(accessToken: string): Promise<string | null> {
  const response = await fetch(`${GOOGLE_HEALTH_API_BASE}/users/me/identity`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const identity = await response.json() as { healthUserId?: string };
  return identity.healthUserId ?? null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { env, missing } = getEnv();
  if (missing.length > 0) {
    return jsonResponse({ error: `google-health-oauth is not configured. Missing: ${missing.join(', ')}` }, 500);
  }

  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
    const redirectTo = (status: 'connected' | 'error') => new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: `${env.appBaseUrl}/settings?google_health=${status}` },
    });

    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) return redirectTo('error');

      const payload = await verifyOAuthState(env.stateSecret, state);
      if (!payload) return redirectTo('error');

      const tokens = await exchangeGoogleHealthCode({
        code,
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        redirectUri: callbackUrl(env.supabaseUrl),
      });
      if (!tokens.refresh_token) throw new Error('Google returned no refresh token');

      const service = createClient(env.supabaseUrl, env.serviceRoleKey);
      const nowIso = new Date().toISOString();
      const { error: tokenError } = await service.from('google_health_tokens').upsert({
        user_id: payload.userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scopes: tokens.scope ?? GOOGLE_HEALTH_SCOPES,
        updated_at: nowIso,
      });
      if (tokenError) throw tokenError;

      const healthUserId = await fetchHealthUserId(tokens.access_token);
      const { error: connectionError } = await service.from('google_health_connections').upsert({
        user_id: payload.userId,
        health_user_id: healthUserId,
        scopes: tokens.scope ?? GOOGLE_HEALTH_SCOPES,
        connected_at: nowIso,
        last_sync_status: 'connected',
        updated_at: nowIso,
      });
      if (connectionError) throw connectionError;
      return redirectTo('connected');
    } catch (error) {
      console.error('google-health-oauth callback failed:', error);
      return redirectTo('error');
    }
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const userId = await requireUser(req, env.supabaseUrl, env.anonKey);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({})) as OAuthActionRequest;

  if (body.action === 'start') {
    const authorize = new URL(GOOGLE_AUTH_URL);
    authorize.searchParams.set('client_id', env.clientId);
    authorize.searchParams.set('redirect_uri', callbackUrl(env.supabaseUrl));
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', GOOGLE_HEALTH_SCOPES);
    authorize.searchParams.set('access_type', 'offline');
    authorize.searchParams.set('prompt', 'consent');
    authorize.searchParams.set('include_granted_scopes', 'true');
    authorize.searchParams.set('state', await signOAuthState(env.stateSecret, userId));
    return jsonResponse({ authorizeUrl: authorize.toString() });
  }

  if (body.action === 'disconnect') {
    const service = createClient(env.supabaseUrl, env.serviceRoleKey);
    const { data: tokenRow } = await service
      .from('google_health_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (tokenRow?.refresh_token) {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(tokenRow.refresh_token as string)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(() => null);
    }
    await service.from('google_health_tokens').delete().eq('user_id', userId);
    await service.from('google_health_connections').delete().eq('user_id', userId);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Unknown action' }, 400);
});
