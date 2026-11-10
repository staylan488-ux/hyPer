// Deletes the signed-in account (App Store guideline 5.1.1(v)). Deployed with
// verify_jwt = false (see config.toml): the bearer token is checked in-code
// with getUser, which works with Supabase's current signing keys, as in
// analyze-food-trial. The service role never reaches the app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { WHOOP_API_BASE } from '../_shared/whoop.ts';
import { createDeleteAccountHandler, removeFilesUnder } from './handler.ts';

Deno.serve(async (request: Request) => {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  const foodBucket = Deno.env.get('FOOD_ANALYSIS_BUCKET')?.trim();
  // Enable only after the new writer is deployed and old Storage writes have
  // quiesced; see docs/food-analysis-ledger.md. A deploy alone is not a drain.
  const ledgerReady = Deno.env.get('FOOD_ANALYSIS_DATABASE_LEDGER_READY') === 'true';
  if (!url || !serviceKey || !foodBucket || !ledgerReady) {
    return new Response(JSON.stringify({ error: 'Account deletion is not configured.' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });

  const handler = createDeleteAccountHandler({
    async authenticate(token) {
      const { data, error } = await service.auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    },
    async whoopAccess(userId) {
      const { data, error } = await service.from('whoop_tokens').select('access_token').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data?.access_token ?? null;
    },
    async revokeWhoop(accessToken) {
      await fetch(`${WHOOP_API_BASE}/v2/user/access`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
    },
    async removeFoodRecords(userId) {
      const bucket = service.storage.from(foodBucket);
      // The ledger names each account's folder by its lower-case id (gateway.ts).
      await removeFilesUnder(async (prefix, offset) => {
        const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
        if (error) throw error;
        return (data ?? []).map((entry) => ({ name: entry.name, id: entry.id ?? null }));
      }, async (paths) => {
        const { error } = await bucket.remove(paths);
        if (error) throw error;
      }, `food-v1/${userId.toLowerCase()}`);
    },
    async deleteUser(userId) {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
    log: (message, error) => console.error(message, error instanceof Error ? error.message : error ?? ''),
  });
  return handler(request);
});
