// Deletes the signed-in account (App Store guideline 5.1.1(v)). Deployed with
// verify_jwt = false (see config.toml): the bearer token is checked in-code
// with getUser, which works with Supabase's current signing keys, as in
// analyze-food-trial. The service role never reaches the app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { WHOOP_API_BASE } from '../_shared/whoop.ts';
import { createDeleteAccountHandler, listFilesUnder } from './handler.ts';

const BATCH = 100;

Deno.serve(async (request: Request) => {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Account deletion is not configured.' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  // The food analysis ledger's private bucket; unset where food analysis isn't deployed.
  const foodBucket = Deno.env.get('FOOD_ANALYSIS_BUCKET')?.trim();
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });

  const handler = createDeleteAccountHandler({
    async authenticate(token) {
      const { data, error } = await service.auth.getUser(token);
      return error ? null : data.user?.id ?? null;
    },
    async revokeWhoop(userId) {
      const { data } = await service.from('whoop_tokens').select('access_token').eq('user_id', userId).maybeSingle();
      if (!data?.access_token) return;
      await fetch(`${WHOOP_API_BASE}/v2/user/access`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${data.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
    },
    async removeFoodRecords(userId) {
      if (!foodBucket) return;
      const bucket = service.storage.from(foodBucket);
      // The ledger names each account's folder by its lower-case id (gateway.ts).
      const files = await listFilesUnder(async (prefix, offset) => {
        const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
        if (error) throw error;
        return (data ?? []).map((entry) => ({ name: entry.name, id: entry.id ?? null }));
      }, `food-v1/${userId.toLowerCase()}`);
      for (let start = 0; start < files.length; start += BATCH) {
        const { error } = await bucket.remove(files.slice(start, start + BATCH));
        if (error) throw error;
      }
    },
    async deleteUser(userId) {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
    log: (message, error) => console.error(message, error instanceof Error ? error.message : error ?? ''),
  });
  return handler(request);
});
