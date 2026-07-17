// Imports reconciled Google Health weight samples. EufyLife can feed Fitbit,
// and Google Health reconciles that third-party source before Hyper stores it.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  GOOGLE_HEALTH_API_BASE,
  corsHeaders,
  jsonResponse,
  refreshGoogleHealthToken,
} from '../_shared/google-health.ts';
import {
  normalizeGoogleHealthWeights,
  type ReconciledWeightPoint,
} from '../_shared/google-health-data.ts';

interface ReconciledWeightResponse {
  dataPoints?: ReconciledWeightPoint[];
  nextPageToken?: string;
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const FIRST_SYNC_DAYS = 90;
const MAX_PAGES = 10;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const clientId = Deno.env.get('GOOGLE_HEALTH_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_HEALTH_CLIENT_SECRET') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !clientId || !clientSecret) {
    return jsonResponse({ error: 'google-health-sync is not configured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);
  const authed = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await authed.auth.getUser();
  if (authError || !authData.user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const userId = authData.user.id;

  const service = createClient(supabaseUrl, serviceRoleKey);
  const [{ data: tokenRow }, { data: connection }] = await Promise.all([
    service.from('google_health_tokens').select('access_token, refresh_token, expires_at, scopes').eq('user_id', userId).maybeSingle(),
    service.from('google_health_connections').select('last_synced_at').eq('user_id', userId).maybeSingle(),
  ]);
  if (!tokenRow) return jsonResponse({ error: 'not_connected' }, 400);

  let accessToken = tokenRow.access_token as string;
  const refresh = async (): Promise<boolean> => {
    try {
      const refreshed = await refreshGoogleHealthToken({
        refreshToken: tokenRow.refresh_token as string,
        clientId,
        clientSecret,
      });
      const refreshToken = refreshed.refresh_token ?? tokenRow.refresh_token as string;
      const { error } = await service.from('google_health_tokens').upsert({
        user_id: userId,
        access_token: refreshed.access_token,
        refresh_token: refreshToken,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        scopes: refreshed.scope ?? tokenRow.scopes,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      accessToken = refreshed.access_token;
      tokenRow.refresh_token = refreshToken;
      return true;
    } catch (error) {
      console.error('Google Health token refresh failed:', error);
      return false;
    }
  };

  if (Date.parse(tokenRow.expires_at as string) < Date.now() + REFRESH_MARGIN_MS) {
    if (!await refresh()) return jsonResponse({ error: 'reauth_required' }, 401);
  }

  const fallbackSince = Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000;
  const lastSyncMs = connection?.last_synced_at ? Date.parse(connection.last_synced_at as string) : Number.NaN;
  const sinceIso = new Date(Number.isFinite(lastSyncMs) ? lastSyncMs - 24 * 60 * 60 * 1000 : fallbackSince).toISOString();
  const points: ReconciledWeightPoint[] = [];
  let pageToken = '';

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${GOOGLE_HEALTH_API_BASE}/users/me/dataTypes/weight/dataPoints:reconcile`);
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('filter', `weight.sample_time.physical_time >= "${sinceIso}"`);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    let response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (response.status === 401 && await refresh()) {
      response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Google Health weight fetch failed:', response.status, detail.slice(0, 300));
      await service.from('google_health_connections').update({ last_sync_status: `error_${response.status}`, updated_at: new Date().toISOString() }).eq('user_id', userId);
      return jsonResponse({ error: response.status === 401 ? 'reauth_required' : 'google_health_error', status: response.status }, response.status === 401 ? 401 : 502);
    }

    const payload = await response.json() as ReconciledWeightResponse;
    points.push(...(payload.dataPoints ?? []));
    pageToken = payload.nextPageToken ?? '';
    if (!pageToken) break;
  }

  const rows = normalizeGoogleHealthWeights(points, userId, new Date().toISOString());

  if (rows.length > 0) {
    const { error } = await service.from('body_measurements').upsert(rows, {
      onConflict: 'user_id,source,external_id',
    });
    if (error) {
      console.error('Google Health weight upsert failed:', error);
      return jsonResponse({ error: 'storage_error' }, 500);
    }
  }

  const nowIso = new Date().toISOString();
  await service.from('google_health_connections').update({
    last_synced_at: nowIso,
    last_sync_status: 'ok',
    updated_at: nowIso,
  }).eq('user_id', userId);

  return jsonResponse({ imported: rows.length, syncedAt: nowIso });
});
