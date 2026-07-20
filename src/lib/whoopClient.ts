// Production transport for the WHOOP pipeline: thin wrappers over the
// whoop-oauth / whoop-sync Edge Functions. Never used in /preview — the mock
// client has no functions API; preview swaps in fixture ports instead.
import { supabase } from '@/lib/supabase';
import type { WhoopFetchBatchParams, WhoopFetchBatchResult } from '@/lib/whoopSync';
import type { WhoopWorkoutRecord } from '@/lib/whoopImport';

interface FunctionErrorBody {
  error?: string;
}

function extractError(data: unknown): string | null {
  const body = data as FunctionErrorBody | null;
  return body && typeof body.error === 'string' ? body.error : null;
}

// returns the WHOOP consent URL to redirect the browser to
export async function startWhoopConnect(returnTo?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('whoop-oauth', {
    body: { action: 'start', ...(returnTo ? { returnTo } : {}) },
  });
  if (error) throw new Error(`whoop-oauth start failed: ${error.message}`);

  const failure = extractError(data);
  if (failure) throw new Error(failure);

  const authorizeUrl = (data as { authorizeUrl?: string })?.authorizeUrl;
  if (!authorizeUrl) throw new Error('whoop-oauth start returned no authorize URL');
  return authorizeUrl;
}

export async function disconnectWhoopRemote(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('whoop-oauth', {
    body: { action: 'disconnect' },
  });
  if (error) throw new Error(`whoop-oauth disconnect failed: ${error.message}`);

  const failure = extractError(data);
  if (failure) throw new Error(failure);
}

// one page of raw WHOOP workout records via the whoop-sync proxy
export async function fetchWhoopBatchRemote(params: WhoopFetchBatchParams): Promise<WhoopFetchBatchResult> {
  const { data, error } = await supabase.functions.invoke('whoop-sync', {
    body: { start: params.start, end: params.end, nextToken: params.nextToken ?? undefined },
  });
  if (error) throw new Error(`whoop-sync failed: ${error.message}`);

  const failure = extractError(data);
  if (failure) throw new Error(failure);

  const page = data as { records?: WhoopWorkoutRecord[]; nextToken?: string | null };
  return { records: page.records ?? [], nextToken: page.nextToken ?? null };
}
