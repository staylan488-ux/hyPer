import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { createTrialHandler } from './gateway.ts';
import { createStorageLedger } from './storageLedger.ts';
import { createDatabaseLedger } from './databaseLedger.ts';
import { analyzeMeal } from './model.ts';
import { interpretServing } from './serving.ts';
import { suggestTargets } from './coach.ts';

const MICROS = 1_000_000;
const usd = (micros: unknown) => {
  const value = Number(micros);
  if (!Number.isFinite(value)) throw new Error('Budget unavailable');
  return value / MICROS;
};

// No client-provided API key, provider, model, URL or user ID is trusted.
// The operator applies the ledger migration and keeps the legacy bucket private.
Deno.serve(async (request: Request) => {
  try {
    const required = (name: string) => {
      const value = Deno.env.get(name)?.trim();
      if (!value) throw new Error('Food analysis configuration missing');
      return value;
    };
    const url = required('SUPABASE_URL');
    const key = required('SUPABASE_SERVICE_ROLE_KEY');
    const apiKey = required('GEMINI_API_KEY');
    const tavilyKey = required('TAVILY_API_KEY');
    const authClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
    });
    const handler = createTrialHandler({
      config: {
        // The ceiling for any one account; each account's own limit comes from
        // the database (app_config and approved_users). Out of range fails closed.
        maxAttempts: Number(Deno.env.get('FOOD_ANALYSIS_MAX_DAILY_REQUESTS') ?? '40'),
        // Browser origins only; the app sends none. The retired Capacitor
        // shell's capacitor:// origin is ignored if the secret still names it.
        allowedOrigins: (Deno.env.get('FOOD_ANALYSIS_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim())
          .filter(value => value && !value.startsWith('capacitor:')),
      },
      ledger: createDatabaseLedger({
        url, serviceRoleKey: key,
        legacy: createStorageLedger({ url, serviceRoleKey: key, bucket: required('FOOD_ANALYSIS_BUCKET') }),
      }),
      async authenticate(token) {
        const { data, error } = await authClient.auth.getUser(token);
        return error ? null : data.user?.id ?? null;
      },
      async access(userId) {
        const { data, error } = await authClient.rpc('ai_access', { p_user_id: userId });
        const answer = data as { approved?: unknown; daily_limit?: unknown } | null;
        if (error || !answer || typeof answer.approved !== 'boolean' || typeof answer.daily_limit !== 'number') throw new Error('Access unavailable');
        return { approved: answer.approved, dailyLimit: answer.daily_limit };
      },
      budget: {
        async status(date) {
          const { data, error } = await authClient.rpc('ai_budget_status', { p_usage_date: date });
          const answer = data as { enabled?: unknown; budget_micros?: unknown; committed_micros?: unknown } | null;
          if (error || !answer || typeof answer.enabled !== 'boolean') throw new Error('Budget unavailable');
          return { enabled: answer.enabled, budgetUsd: usd(answer.budget_micros), committedUsd: usd(answer.committed_micros) };
        },
        async claim({ key, userId, date, feature, reserveUsd }) {
          const { data, error } = await authClient.rpc('claim_ai_spend', {
            p_claim_key: key, p_user_id: userId, p_feature: feature, p_usage_date: date,
            p_reserve_micros: Math.ceil(reserveUsd * MICROS),
          });
          if (error || !['claimed', 'exhausted', 'disabled', 'duplicate'].includes(data as string)) throw new Error('Budget unavailable');
          return data as 'claimed' | 'exhausted' | 'disabled' | 'duplicate';
        },
        async settle(key, costUsd) {
          const { error } = await authClient.rpc('settle_ai_spend', { p_claim_key: key, p_cost_micros: Math.ceil(costUsd * MICROS) });
          if (error) throw new Error('Budget not settled');
        },
      },
      analyze: (input, onProgress) => analyzeMeal(input, apiKey, tavilyKey, onProgress),
      // Supabase's runtime keeps the function alive for this work after the app disconnects.
      waitUntil: work => (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(work),
      interpretServing: input => interpretServing(input, apiKey),
      suggestTargets: input => suggestTargets(input, apiKey),
    });
    return handler(request);
  } catch {
    // Avoid revealing missing secret names, upstream bodies or configuration values.
    return new Response(JSON.stringify({ code: 'analysis_not_configured', error: 'Hosted food analysis is not configured yet.' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
});
