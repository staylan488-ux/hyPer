// Production transport for the Strava pipeline: thin wrappers over the
// strava-oauth / strava-sync Edge Functions. Never used in /preview.
import { supabase } from '@/lib/supabase';
import type { StravaFetchBatchParams, StravaFetchBatchResult } from '@/lib/stravaSync';
import type { StravaActivityRecord } from '@/lib/stravaImport';

function extractError(data: unknown): string | null {
  const body = data as { error?: string } | null;
  return body && typeof body.error === 'string' ? body.error : null;
}

export async function startStravaConnect(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('strava-oauth', {
    body: { action: 'start' },
  });
  if (error) throw new Error(`strava-oauth start failed: ${error.message}`);

  const failure = extractError(data);
  if (failure) throw new Error(failure);

  const authorizeUrl = (data as { authorizeUrl?: string })?.authorizeUrl;
  if (!authorizeUrl) throw new Error('strava-oauth start returned no authorize URL');
  return authorizeUrl;
}

export async function disconnectStravaRemote(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('strava-oauth', {
    body: { action: 'disconnect' },
  });
  if (error) throw new Error(`strava-oauth disconnect failed: ${error.message}`);

  const failure = extractError(data);
  if (failure) throw new Error(failure);
}

export async function fetchStravaBatchRemote(params: StravaFetchBatchParams): Promise<StravaFetchBatchResult> {
  const { data, error } = await supabase.functions.invoke('strava-sync', {
    body: { start: params.start, end: params.end, page: params.page },
  });
  if (error) throw new Error(`strava-sync failed: ${error.message}`);

  const failure = extractError(data);
  if (failure) throw new Error(failure);

  const pageResult = data as { records?: StravaActivityRecord[]; nextPage?: number | null };
  return { records: pageResult.records ?? [], nextPage: pageResult.nextPage ?? null };
}
