import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { createTrialHandler } from './gateway.ts';
import { createStorageLedger } from './storageLedger.ts';
import { analyzeMeal } from './model.ts';
import { interpretServing } from './serving.ts';
import { isApprovedUser } from '../_shared/approval.ts';

// Meal analysis and serving interpretation share one project-wide daily counter.
const GLOBAL_FEATURE = 'food-analysis';

// No client-provided API key, provider, model, URL or user ID is trusted.
// The operator provisions a private bucket and these secrets before deployment.
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
        maxAttempts: Number(Deno.env.get('FOOD_ANALYSIS_MAX_DAILY_REQUESTS') ?? '24'),
        // All users combined. Out-of-range values make validateConfig fail closed.
        maxGlobalAttempts: Number(Deno.env.get('FOOD_ANALYSIS_MAX_GLOBAL_DAILY_REQUESTS') ?? '50'),
        allowedOrigins: required('FOOD_ANALYSIS_ALLOWED_ORIGINS').split(',').map(value => value.trim()),
      },
      ledger: createStorageLedger({ url, serviceRoleKey: key, bucket: required('FOOD_ANALYSIS_BUCKET') }),
      async authenticate(token) {
        const { data, error } = await authClient.auth.getUser(token);
        return error ? null : data.user?.id ?? null;
      },
      isApproved: userId => isApprovedUser(authClient, userId),
      globalQuota: {
        async used(date) {
          const { data, error } = await authClient.rpc('ai_usage_count', { p_feature: GLOBAL_FEATURE, p_usage_date: date });
          if (error || typeof data !== 'number') throw new Error('Global quota unavailable');
          return data;
        },
        async claim(date, max) {
          const { data, error } = await authClient.rpc('claim_ai_request', { p_feature: GLOBAL_FEATURE, p_usage_date: date, p_max: max });
          if (error || typeof data !== 'boolean') throw new Error('Global quota unavailable');
          return data;
        },
      },
      analyze: input => analyzeMeal(input, apiKey, tavilyKey),
      interpretServing: input => interpretServing(input, apiKey),
    });
    return handler(request);
  } catch {
    // Avoid revealing missing secret names, upstream bodies or configuration values.
    return new Response(JSON.stringify({ code: 'analysis_not_configured', error: 'Hosted food analysis is not configured yet.' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
});
