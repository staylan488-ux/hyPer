// Dumb Strava fetch proxy (verify_jwt = true), mirroring whoop-sync: loads the
// caller's tokens with the service role, refreshes when close to expiry
// (Strava ROTATES refresh tokens — persist the new pair before fetching), and
// returns one raw page of activities. Normalization happens client-side.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders, jsonResponse } from '../_shared/oauth.ts';

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const PER_PAGE = 50;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface SyncRequest {
  start?: string; // ISO — mapped to Strava's epoch-seconds `after`
  end?: string;   // ISO — mapped to `before`
  page?: number;
}

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
  const clientId = Deno.env.get('STRAVA_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('STRAVA_CLIENT_SECRET') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !clientId || !clientSecret) {
    return jsonResponse({ error: 'strava-sync is not configured' }, 500);
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
    .from('strava_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!tokenRow) return jsonResponse({ error: 'not_connected' }, 400);

  let accessToken = tokenRow.access_token as string;

  const refresh = async (): Promise<boolean> => {
    try {
      const response = await fetch(STRAVA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: tokenRow.refresh_token as string,
        }).toString(),
      });
      if (!response.ok) throw new Error(`token refresh ${response.status}`);
      const rotated = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      };
      const { error } = await service.from('strava_tokens').upsert({
        user_id: userId,
        access_token: rotated.access_token,
        refresh_token: rotated.refresh_token,
        expires_at: new Date(rotated.expires_at * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      accessToken = rotated.access_token;
      tokenRow.refresh_token = rotated.refresh_token;
      return true;
    } catch (error) {
      console.error('strava token refresh failed:', error);
      return false;
    }
  };

  if (Date.parse(tokenRow.expires_at as string) < Date.now() + REFRESH_MARGIN_MS) {
    const ok = await refresh();
    if (!ok) return jsonResponse({ error: 'reauth_required' }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as SyncRequest;
  const page = Math.max(1, body.page ?? 1);
  const activitiesUrl = new URL(STRAVA_ACTIVITIES_URL);
  activitiesUrl.searchParams.set('per_page', String(PER_PAGE));
  activitiesUrl.searchParams.set('page', String(page));
  if (body.start) activitiesUrl.searchParams.set('after', String(Math.floor(Date.parse(body.start) / 1000)));
  if (body.end) activitiesUrl.searchParams.set('before', String(Math.ceil(Date.parse(body.end) / 1000)));

  const fetchPage = () =>
    fetch(activitiesUrl, { headers: { Authorization: `Bearer ${accessToken}` } });

  let response = await fetchPage();
  if (response.status === 401) {
    const ok = await refresh();
    if (!ok) return jsonResponse({ error: 'reauth_required' }, 401);
    response = await fetchPage();
  }

  if (response.status === 429) {
    return jsonResponse({ error: 'rate_limited' }, 429);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('strava activities fetch failed:', response.status, detail.slice(0, 300));
    return jsonResponse({ error: 'strava_error', status: response.status }, 502);
  }

  const records = (await response.json()) as unknown[];
  const hasMore = records.length === PER_PAGE;

  // stamp sync bookkeeping on the final page
  if (!hasMore) {
    await service
      .from('strava_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_status: 'ok',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }

  return jsonResponse({ records, nextPage: hasMore ? page + 1 : null });
});
