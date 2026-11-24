// hyPer Remote MCP Server Edge Function.
// Deployed with verify_jwt = false (see supabase/config.toml) so RFC 9728 OAuth
// Protected Resource Metadata discovery and 401 WWW-Authenticate challenges work,
// and Bearer tokens are validated in-code via getUser.
//
// Security invariant:
// - The service-role client is used ONLY for approvalRefusal (approved_users has
//   no client grants).
// - All user authentication and table reads/writes run through a user-scoped
//   client created with SUPABASE_ANON_KEY + Authorization: Bearer <token>, so
//   Postgres RLS enforces tenant isolation automatically.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { approvalRefusal } from '../_shared/approval.ts';
import {
  MCP_CORS_HEADERS,
  createMcpHandler,
  type BodyWeightRow,
  type FoodRow,
  type MacroTargetRow,
  type McpRepository,
  type NewBodyWeightInsert,
  type NewFoodInsert,
  type NewNutritionGroupInsert,
  type NewNutritionLogInsert,
  type NutritionGroupRow,
  type NutritionLogPatch,
  type NutritionLogRow,
  type NutritionProfileRow,
} from './handler.ts';

const FETCH_TIMEOUT_MS = 15_000;
const FOOD_ID_CHUNK_SIZE = 200;

function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

function createUserRepository(client: SupabaseClient): McpRepository {
  return {
    async getMacroTargets(userId: string): Promise<MacroTargetRow | null> {
      const { data, error } = await client
        .from('macro_targets')
        .select('id, user_id, calories, protein, carbs, fat, source')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data as MacroTargetRow | null) ?? null;
    },

    async getNutritionProfile(userId: string): Promise<NutritionProfileRow | null> {
      const { data, error } = await client
        .from('nutrition_profiles')
        .select('user_id, unit_system, goal, adaptive_enabled')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data as NutritionProfileRow | null) ?? null;
    },

    async getNutritionGroupsForDate(userId: string, date: string): Promise<NutritionGroupRow[]> {
      const { data, error } = await client
        .from('nutrition_groups')
        .select('id, user_id, date, kind, label, sort_order, created_at, updated_at')
        .eq('user_id', userId)
        .eq('date', date)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as NutritionGroupRow[];
    },

    async getNutritionLogsForDate(userId: string, date: string): Promise<NutritionLogRow[]> {
      const { data, error } = await client
        .from('nutrition_logs')
        .select('id, user_id, date, logged_at, food_id, servings, meal_type, group_id, sort_order, source, created_at')
        .eq('user_id', userId)
        .eq('date', date)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as NutritionLogRow[];
    },

    async getNutritionLogById(userId: string, logId: string): Promise<NutritionLogRow | null> {
      const { data, error } = await client
        .from('nutrition_logs')
        .select('id, user_id, date, logged_at, food_id, servings, meal_type, group_id, sort_order, source, created_at')
        .eq('id', logId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data as NutritionLogRow | null) ?? null;
    },

    async getFoodsByIds(ids: string[]): Promise<FoodRow[]> {
      const unique = [...new Set(ids.filter(Boolean))];
      if (unique.length === 0) return [];
      const pages = await Promise.all(
        chunkIds(unique, FOOD_ID_CHUNK_SIZE).map((part) =>
          client
            .from('foods')
            .select('id, user_id, name, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id, external_source, external_id, description, created_at')
            .in('id', part),
        ),
      );
      const rows: FoodRow[] = [];
      for (const page of pages) {
        if (page.error) throw page.error;
        if (page.data) rows.push(...(page.data as FoodRow[]));
      }
      return rows;
    },

    async getFoodById(foodId: string): Promise<FoodRow | null> {
      const { data, error } = await client
        .from('foods')
        .select('id, user_id, name, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id, external_source, external_id, description, created_at')
        .eq('id', foodId)
        .maybeSingle();
      if (error) throw error;
      return (data as FoodRow | null) ?? null;
    },

    async searchUserFoods(userId: string, query: string | null, limit: number): Promise<FoodRow[]> {
      let builder = client
        .from('foods')
        .select('id, user_id, name, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id, external_source, external_id, description, created_at')
        .eq('user_id', userId);
      if (query) {
        builder = builder.ilike('name', `%${escapeIlikePattern(query)}%`);
      }
      const { data, error } = await builder
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as FoodRow[];
    },

    async insertFood(food: NewFoodInsert): Promise<FoodRow> {
      const { data, error } = await client
        .from('foods')
        .insert(food)
        .select('id, user_id, name, calories, protein, carbs, fat, serving_size, serving_unit, source, fdc_id, external_source, external_id, description, created_at')
        .single();
      if (error || !data) throw error ?? new Error('Could not insert food');
      return data as FoodRow;
    },

    async insertNutritionGroup(group: NewNutritionGroupInsert): Promise<NutritionGroupRow> {
      const { data, error } = await client
        .from('nutrition_groups')
        .insert(group)
        .select('id, user_id, date, kind, label, sort_order, created_at, updated_at')
        .single();
      if (error || !data) throw error ?? new Error('Could not insert nutrition group');
      return data as NutritionGroupRow;
    },

    async updateNutritionGroupSortOrder(userId: string, groupId: string, sortOrder: number): Promise<void> {
      const { error } = await client
        .from('nutrition_groups')
        .update({ sort_order: sortOrder })
        .eq('id', groupId)
        .eq('user_id', userId);
      if (error) throw error;
    },

    async insertNutritionLogs(logs: NewNutritionLogInsert[]): Promise<NutritionLogRow[]> {
      const { data, error } = await client
        .from('nutrition_logs')
        .insert(logs)
        .select('id, user_id, date, logged_at, food_id, servings, meal_type, group_id, sort_order, source, created_at');
      if (error || !data) throw error ?? new Error('Could not insert nutrition logs');
      return data as NutritionLogRow[];
    },

    async updateNutritionLog(userId: string, logId: string, patch: NutritionLogPatch): Promise<NutritionLogRow | null> {
      const { data, error } = await client
        .from('nutrition_logs')
        .update(patch)
        .eq('id', logId)
        .eq('user_id', userId)
        .select('id, user_id, date, logged_at, food_id, servings, meal_type, group_id, sort_order, source, created_at')
        .maybeSingle();
      if (error) throw error;
      return (data as NutritionLogRow | null) ?? null;
    },

    async deleteNutritionLog(userId: string, logId: string): Promise<boolean> {
      const { data, error } = await client
        .from('nutrition_logs')
        .delete()
        .eq('id', logId)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async getRecentBodyWeights(userId: string, limit: number): Promise<BodyWeightRow[]> {
      const { data, error } = await client
        .from('body_weight_measurements')
        .select('id, user_id, source, external_id, measured_at, kilograms, source_bundle, source_name, created_at')
        .eq('user_id', userId)
        .order('measured_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as BodyWeightRow[];
    },

    async insertBodyWeight(row: NewBodyWeightInsert): Promise<BodyWeightRow> {
      const { data, error } = await client
        .from('body_weight_measurements')
        .insert(row)
        .select('id, user_id, source, external_id, measured_at, kilograms, source_bundle, source_name, created_at')
        .single();
      if (error || !data) throw error ?? new Error('Could not insert body weight');
      return data as BodyWeightRow;
    },
  };
}

Deno.serve(async (request: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return new Response(JSON.stringify({ error: 'hyPer MCP is not configured.' }), {
      status: 503,
      headers: { ...MCP_CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const resourceUrl = Deno.env.get('MCP_RESOURCE_URL')?.trim() || `${baseUrl}/functions/v1/mcp`;
  const authIssuer = Deno.env.get('MCP_AUTH_ISSUER')?.trim() || `${baseUrl}/auth/v1`;
  // Pre-cutover projects without public.approved_users (docs/handoffs/current.md)
  // can opt out explicitly via MCP_APPROVAL_GATE=off; default stays fail-closed.
  const skipApprovalGate = Deno.env.get('MCP_APPROVAL_GATE') === 'off';

  // Service-role client is used ONLY for the approved_users lookup.
  const service = createClient(baseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timedFetch },
  });

  // Cache the user-scoped client for the lifetime of this single HTTP request.
  const userClients = new Map<string, SupabaseClient>();
  const getUserClient = (token: string): SupabaseClient => {
    let existing = userClients.get(token);
    if (!existing) {
      existing = createClient(baseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: `Bearer ${token}` },
          fetch: timedFetch,
        },
      });
      userClients.set(token, existing);
    }
    return existing;
  };

  const handler = createMcpHandler({
    resourceUrl,
    authIssuer,
    async authenticate(token: string): Promise<string | null> {
      const client = getUserClient(token);
      // Verify OAuth 2.1 asymmetric JWTs locally via JWKS (and fall back to
      // getUser for symmetric tokens). Only accept authenticated user tokens.
      const { data, error } = await client.auth.getClaims(token);
      if (error) {
        const status = (error as { status?: number }).status;
        if (status !== undefined && status >= 500) throw error;
        return null;
      }
      const claims = data?.claims as { sub?: unknown; role?: unknown } | undefined;
      if (claims?.role !== 'authenticated' || typeof claims.sub !== 'string' || !claims.sub.trim()) {
        return null;
      }
      return claims.sub;
    },
    checkApproval(userId: string) {
      if (skipApprovalGate) return Promise.resolve(null);
      return approvalRefusal(service, userId, 'hyPer MCP is temporarily unavailable.');
    },
    repositoryFor(_userId: string, token: string) {
      return createUserRepository(getUserClient(token));
    },
    log: (message, error) => console.error(message, error instanceof Error ? error.message : error ?? ''),
  });

  return handler(request);
});
