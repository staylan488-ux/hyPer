// Dumb WHOOP fetch proxy (verify_jwt = true). Loads the caller's tokens with
// the service role, refreshes them when close to expiry (persisting the
// ROTATED pair before any workout fetch), and returns one raw page of v2
// workout records. All normalization/grouping happens client-side so the
// sandbox and production share one pipeline.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { WHOOP_API_BASE, corsHeaders, jsonResponse, refreshAccessToken } from '../_shared/whoop.ts';

interface SyncRequest {
  start?: string;
  end?: string;
  nextToken?: string | null;
}

interface WhoopWorkoutPage {
  records?: unknown[];
  next_token?: string | null;
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const clientId = Deno.env.get('WHOOP_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('WHOOP_CLIENT_SECRET') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !clientId || !clientSecret) {
    return jsonResponse({ error: 'whoop-sync is not configured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await authed.auth.getUser();
  if (authError || !authData.user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const userId = authData.user.id;

  const service = createClient(supabaseUrl, serviceRoleKey);
  const { data: tokenRow } = await service
    .from('whoop_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!tokenRow) return jsonResponse({ error: 'not_connected' }, 400);

  let accessToken = tokenRow.access_token as string;

  // WHOOP rotates refresh tokens — persist the new pair BEFORE fetching, or a
  // crash mid-sync would strand us with a dead refresh token
  const refresh = async (): Promise<boolean> => {
    try {
      const rotated = await refreshAccessToken({
        refreshToken: tokenRow.refresh_token as string,
        clientId,
        clientSecret,
      });
      const { error } = await service.from('whoop_tokens').upsert({
        user_id: userId,
        access_token: rotated.access_token,
        refresh_token: rotated.refresh_token,
        expires_at: new Date(Date.now() + rotated.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      accessToken = rotated.access_token;
      tokenRow.refresh_token = rotated.refresh_token;
      return true;
    } catch (error) {
      console.error('whoop token refresh failed:', error);
      return false;
    }
  };

  if (Date.parse(tokenRow.expires_at as string) < Date.now() + REFRESH_MARGIN_MS) {
    const ok = await refresh();
    if (!ok) return jsonResponse({ error: 'reauth_required' }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as SyncRequest;
  const workoutsUrl = new URL(`${WHOOP_API_BASE}/v2/activity/workout`);
  workoutsUrl.searchParams.set('limit', '25');
  if (body.start) workoutsUrl.searchParams.set('start', body.start);
  if (body.end) workoutsUrl.searchParams.set('end', body.end);
  if (body.nextToken) workoutsUrl.searchParams.set('nextToken', body.nextToken);

  const fetchPage = () =>
    fetch(workoutsUrl, { headers: { Authorization: `Bearer ${accessToken}` } });

  let response = await fetchPage();
  if (response.status === 401) {
    // stale access token despite the margin — refresh once and retry
    const ok = await refresh();
    if (!ok) return jsonResponse({ error: 'reauth_required' }, 401);
    response = await fetchPage();
  }

  if (response.status === 429) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('whoop workouts fetch failed:', response.status, detail.slice(0, 300));
    return jsonResponse({ error: 'whoop_error', status: response.status }, 502);
  }

  const page = (await response.json()) as WhoopWorkoutPage;
  const nextToken = page.next_token ?? null;

  // stamp sync bookkeeping on the final page
  if (!nextToken) {
    await service
      .from('whoop_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_status: 'ok',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }

  return jsonResponse({ records: page.records ?? [], nextToken });
});
