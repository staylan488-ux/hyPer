import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { NOT_APPROVED, approvalRefusal } from '../supabase/functions/_shared/approval';
import {
  DEFAULT_MACRO_TARGETS,
  DEVICE_ONLY_FOOD_NAME,
  LATEST_PROTOCOL_VERSION,
  MCP_CORS_HEADERS,
  MCP_SERVER_INFO,
  createMcpHandler,
  kgToLb,
  lbToKg,
  type BodyWeightRow,
  type FoodRow,
  type MacroTargetRow,
  type McpRepository,
  type McpServices,
  type McpToolCallResult,
  type McpToolDefinition,
  type NewBodyWeightInsert,
  type NewFoodInsert,
  type NewNutritionGroupInsert,
  type NewNutritionLogInsert,
  type NutritionGroupRow,
  type NutritionLogPatch,
  type NutritionLogRow,
  type NutritionProfileRow,
} from '../supabase/functions/mcp/handler';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_URL = 'https://project.supabase.co/functions/v1/mcp';
const AUTH_ISSUER = 'https://project.supabase.co/auth/v1';
const METADATA_URL = `${RESOURCE_URL}/.well-known/oauth-protected-resource`;
const FIXED_NOW = new Date('2026-11-22T15:30:00.000Z');

interface MemoryDb {
  foods: FoodRow[];
  groups: NutritionGroupRow[];
  logs: NutritionLogRow[];
  macroTargets: Map<string, MacroTargetRow>;
  profiles: Map<string, NutritionProfileRow>;
  weights: BodyWeightRow[];
}

function makeUuid(counter: number): string {
  const hex = counter.toString(16).padStart(12, '0');
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

function createMemoryDb(seed: Partial<MemoryDb> = {}) {
  let idSeq = 1;
  const nextId = () => makeUuid(idSeq++);

  const db: MemoryDb = {
    foods: [...(seed.foods ?? [])],
    groups: [...(seed.groups ?? [])],
    logs: [...(seed.logs ?? [])],
    macroTargets: new Map(seed.macroTargets ?? []),
    profiles: new Map(seed.profiles ?? []),
    weights: [...(seed.weights ?? [])],
  };

  function repositoryFor(callerUserId: string): McpRepository {
    return {
      async getMacroTargets(userId: string) {
        if (userId !== callerUserId) return null;
        return db.macroTargets.get(userId) ?? null;
      },
      async getNutritionProfile(userId: string) {
        if (userId !== callerUserId) return null;
        return db.profiles.get(userId) ?? null;
      },
      async getNutritionGroupsForDate(userId: string, date: string) {
        return db.groups
          .filter((g) => g.user_id === callerUserId && g.user_id === userId && g.date === date)
          .sort((a, b) => a.sort_order - b.sort_order || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
      },
      async getNutritionLogsForDate(userId: string, date: string) {
        return db.logs
          .filter((l) => l.user_id === callerUserId && l.user_id === userId && l.date === date)
          .sort((a, b) => a.sort_order - b.sort_order || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
      },
      async getNutritionLogById(userId: string, logId: string) {
        return db.logs.find((l) => l.id === logId && l.user_id === callerUserId && l.user_id === userId) ?? null;
      },
      async getFoodsByIds(ids: string[]) {
        const set = new Set(ids);
        return db.foods.filter((f) => set.has(f.id) && (f.user_id === callerUserId || f.user_id === null));
      },
      async getFoodById(foodId: string) {
        return db.foods.find((f) => f.id === foodId && (f.user_id === callerUserId || f.user_id === null)) ?? null;
      },
      async searchUserFoods(userId: string, query: string | null, limit: number) {
        const needle = query?.toLowerCase() ?? null;
        return db.foods
          .filter((f) => f.user_id === callerUserId && f.user_id === userId)
          .filter((f) => !needle || f.name.toLowerCase().includes(needle))
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
          .slice(0, limit);
      },
      async insertFood(food: NewFoodInsert) {
        const row: FoodRow = {
          id: nextId(),
          ...food,
          description: food.description ?? null,
          created_at: FIXED_NOW.toISOString(),
        };
        db.foods.push(row);
        return row;
      },
      async insertNutritionGroup(group: NewNutritionGroupInsert) {
        if (
          group.label !== null
          && db.groups.some((g) => g.user_id === group.user_id && g.date === group.date && g.label === group.label)
        ) {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        }
        const row: NutritionGroupRow = {
          id: nextId(),
          ...group,
          created_at: FIXED_NOW.toISOString(),
          updated_at: FIXED_NOW.toISOString(),
        };
        db.groups.push(row);
        return row;
      },
      async updateNutritionGroupSortOrder(userId: string, groupId: string, sortOrder: number) {
        const found = db.groups.find((g) => g.id === groupId && g.user_id === callerUserId && g.user_id === userId);
        if (found) found.sort_order = sortOrder;
      },
      async insertNutritionLogs(logs: NewNutritionLogInsert[]) {
        const inserted: NutritionLogRow[] = logs.map((entry) => ({
          id: nextId(),
          ...entry,
          created_at: FIXED_NOW.toISOString(),
        }));
        db.logs.push(...inserted);
        return inserted;
      },
      async updateNutritionLog(userId: string, logId: string, patch: NutritionLogPatch) {
        const found = db.logs.find((l) => l.id === logId && l.user_id === callerUserId && l.user_id === userId);
        if (!found) return null;
        Object.assign(found, patch);
        return { ...found };
      },
      async deleteNutritionLog(userId: string, logId: string) {
        const index = db.logs.findIndex((l) => l.id === logId && l.user_id === callerUserId && l.user_id === userId);
        if (index < 0) return false;
        db.logs.splice(index, 1);
        return true;
      },
      async getRecentBodyWeights(userId: string, limit: number) {
        return db.weights
          .filter((w) => w.user_id === callerUserId && w.user_id === userId)
          .sort((a, b) => b.measured_at.localeCompare(a.measured_at) || a.id.localeCompare(b.id))
          .slice(0, limit);
      },
      async insertBodyWeight(row: NewBodyWeightInsert) {
        const inserted: BodyWeightRow = {
          ...row,
          created_at: FIXED_NOW.toISOString(),
        };
        db.weights.push(inserted);
        return inserted;
      },
    };
  }

  return { db, repositoryFor, nextId };
}

function makeHarness(
  seed: Partial<MemoryDb> = {},
  overrides: Partial<McpServices> = {},
) {
  const { db, repositoryFor, nextId } = createMemoryDb(seed);
  const services: McpServices = {
    resourceUrl: RESOURCE_URL,
    authIssuer: AUTH_ISSUER,
    authenticate: vi.fn(async (token: string) => {
      if (token === 'valid-token') return USER_ID;
      if (token === 'other-token') return OTHER_USER_ID;
      return null;
    }),
    checkApproval: vi.fn(async () => null),
    repositoryFor: vi.fn((userId: string) => repositoryFor(userId)),
    now: () => FIXED_NOW,
    generateId: nextId,
    log: vi.fn(),
    ...overrides,
  };
  const handler = createMcpHandler(services);
  return { db, services, handler };
}

function mcpPost(
  body: unknown,
  options: { token?: string | null; headers?: Record<string, string>; url?: string } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...options.headers,
  };
  if (options.token !== null) {
    headers.Authorization = `Bearer ${options.token ?? 'valid-token'}`;
  }
  return new Request(options.url ?? RESOURCE_URL, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function callTool(
  handler: (request: Request) => Promise<Response>,
  name: string,
  args: Record<string, unknown> = {},
  token: string | null = 'valid-token',
): Promise<{ status: number; rpc: { jsonrpc: string; id: number; result?: McpToolCallResult; error?: { code: number; message: string } } }> {
  const response = await handler(
    mcpPost({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }, { token }),
  );
  return { status: response.status, rpc: await response.json() };
}

describe('hyPer MCP HTTP transport, CORS, OAuth discovery & approval gate', () => {
  it('answers CORS preflight with required methods and MCP headers', async () => {
    const { handler } = makeHarness();
    const response = await handler(new Request(RESOURCE_URL, { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(MCP_CORS_HEADERS['Access-Control-Allow-Methods']);
    const allowedHeaders = (response.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
    for (const header of ['authorization', 'x-client-info', 'apikey', 'content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version']) {
      expect(allowedHeaders).toContain(header);
    }
  });

  it('serves RFC 9728 OAuth Protected Resource Metadata without auth on well-known paths', async () => {
    const { handler, services } = makeHarness();
    const paths = [
      METADATA_URL,
      'https://project.supabase.co/mcp/.well-known/oauth-protected-resource',
      'https://project.supabase.co/.well-known/oauth-protected-resource/mcp',
    ];
    for (const url of paths) {
      const response = await handler(new Request(url, { method: 'GET' }));
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(await response.json()).toEqual({
        resource: RESOURCE_URL,
        authorization_servers: [AUTH_ISSUER],
        bearer_methods_supported: ['header'],
        scopes_supported: ['openid', 'email', 'profile'],
      });
    }
    expect(services.authenticate).not.toHaveBeenCalled();
  });

  it('returns 401 with WWW-Authenticate resource_metadata when Bearer token is missing or invalid', async () => {
    const { handler, services } = makeHarness();
    const cases = [
      mcpPost({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: null }),
      mcpPost({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: 'bad-token' }),
      new Request(RESOURCE_URL, { method: 'POST', headers: { Authorization: 'Basic abc123' }, body: '{}' }),
      new Request(RESOURCE_URL, { method: 'GET' }),
    ];

    for (const request of cases) {
      const response = await handler(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toBe(`Bearer resource_metadata="${METADATA_URL}"`);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
    expect(services.repositoryFor).not.toHaveBeenCalled();
  });

  it('returns 503 when authentication check fails transiently instead of 401', async () => {
    const { handler } = makeHarness({}, {
      authenticate: vi.fn(async () => { throw new Error('auth upstream timeout'); }),
    });
    const response = await handler(mcpPost({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    expect(response.status).toBe(503);
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
  });

  it('fails closed on the approval gate (403 unapproved, 503 check error or throw)', async () => {
    const unapproved = makeHarness({}, {
      checkApproval: vi.fn(async () => ({ status: 403 as const, body: { ...NOT_APPROVED } })),
    });
    const res403 = await unapproved.handler(mcpPost({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(res403.status).toBe(403);
    expect(await res403.json()).toEqual(NOT_APPROVED);
    expect(unapproved.services.repositoryFor).not.toHaveBeenCalled();

    const unavailable = makeHarness({}, {
      checkApproval: vi.fn(async () => ({ status: 503 as const, body: { error: 'Approval unavailable' } })),
    });
    const res503 = await unavailable.handler(mcpPost({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(res503.status).toBe(503);

    const throwing = makeHarness({}, {
      checkApproval: vi.fn(async () => { throw new Error('db down'); }),
    });
    const resThrow = await throwing.handler(mcpPost({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(resThrow.status).toBe(503);

    // Also confirm direct compatibility with _shared/approval.ts `approvalRefusal`.
    const fakeService = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
    const sharedGate = makeHarness({}, {
      checkApproval: (userId) => approvalRefusal(fakeService, userId, 'Unavailable'),
    });
    const resShared = await sharedGate.handler(mcpPost({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    expect(resShared.status).toBe(403);
    expect(await resShared.json()).toEqual(NOT_APPROVED);
  });

  it('handles Streamable HTTP GET (405), DELETE (204), unsupported method (405), and bad Content-Type (415)', async () => {
    const { handler } = makeHarness();
    const authHeaders = { Authorization: 'Bearer valid-token' };

    const getRes = await handler(new Request(RESOURCE_URL, { method: 'GET', headers: authHeaders }));
    expect(getRes.status).toBe(405);

    const delRes = await handler(new Request(RESOURCE_URL, { method: 'DELETE', headers: authHeaders }));
    expect(delRes.status).toBe(204);

    const putRes = await handler(new Request(RESOURCE_URL, { method: 'PUT', headers: authHeaders }));
    expect(putRes.status).toBe(405);

    const ctRes = await handler(new Request(RESOURCE_URL, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'text/plain' },
      body: '{}',
    }));
    expect(ctRes.status).toBe(415);
  });
});

describe('MCP JSON-RPC 2.0 protocol lifecycle', () => {
  it('negotiates protocol versions on initialize and sets MCP-Protocol-Version', async () => {
    const { handler } = makeHarness();

    for (const requested of ['2025-03-26', '2025-06-18']) {
      const response = await handler(mcpPost({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: requested,
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0' },
        },
      }));
      expect(response.status).toBe(200);
      expect(response.headers.get('MCP-Protocol-Version')).toBe(requested);
      const body = await response.json();
      expect(body).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: MCP_SERVER_INFO,
        },
      });
    }

    // Unsupported version falls back to server's latest supported version.
    const fallbackRes = await handler(mcpPost({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2099-01-01' },
    }));
    const fallbackBody = await fallbackRes.json();
    expect(fallbackBody.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it('returns HTTP 202 with empty body for notifications/initialized', async () => {
    const { handler } = makeHarness();
    const response = await handler(mcpPost({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('responds to ping with an empty result object', async () => {
    const { handler } = makeHarness();
    const response = await handler(mcpPost({ jsonrpc: '2.0', id: 'p-1', method: 'ping' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 'p-1', result: {} });
  });

  it('lists all 6 v1 tools with expected MCP annotations', async () => {
    const { handler } = makeHarness();
    const response = await handler(mcpPost({ jsonrpc: '2.0', id: 3, method: 'tools/list' }));
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tools: McpToolDefinition[] } };
    const tools = body.result.tools;
    expect(tools.map((t) => t.name)).toEqual([
      'get_day_summary',
      'search_foods',
      'log_food',
      'update_food_log',
      'delete_food_log',
      'log_body_weight',
    ]);

    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('get_day_summary')?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.get('search_foods')?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.get('log_food')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(byName.get('update_food_log')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(byName.get('delete_food_log')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(byName.get('log_body_weight')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  });

  it('returns standard JSON-RPC errors for invalid JSON, bad envelopes, unknown methods, and unknown tools', async () => {
    const { handler } = makeHarness();

    const parseErr = await handler(mcpPost('{bad-json'));
    expect(parseErr.status).toBe(400);
    expect((await parseErr.json()).error.code).toBe(-32700);

    const invalidReq = await handler(mcpPost({ jsonrpc: '1.0', id: 1, method: 'ping' }));
    expect((await invalidReq.json()).error.code).toBe(-32600);

    const emptyBatch = await handler(mcpPost([]));
    expect(emptyBatch.status).toBe(400);
    expect((await emptyBatch.json()).error.code).toBe(-32600);

    const unknownMethod = await handler(mcpPost({ jsonrpc: '2.0', id: 9, method: 'resources/list' }));
    expect((await unknownMethod.json()).error.code).toBe(-32601);

    const unknownTool = await callTool(handler, 'does_not_exist', {});
    expect(unknownTool.rpc.error?.code).toBe(-32602);
  });

  it('supports JSON-RPC batch requests and notification-only batches', async () => {
    const { handler } = makeHarness();
    const res = await handler(mcpPost([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 10, method: 'ping' },
    ]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ jsonrpc: '2.0', id: 10, result: {} }]);

    const notifBatch = await handler(mcpPost([
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]));
    expect(notifBatch.status).toBe(202);
  });
});

describe('Tool 1: get_day_summary', () => {
  it('returns full day summary with totals, remaining, profile, groups, entries, and 7 weigh-ins', async () => {
    const foodId = 'f1111111-1111-4111-8111-111111111111';
    const breakfastId = 'b1111111-1111-4111-8111-111111111111';
    const lunchId = 'b2222222-2222-4222-8222-222222222222';
    const logId = 'c1111111-1111-4111-8111-111111111111';
    const weights: BodyWeightRow[] = Array.from({ length: 9 }, (_, i) => ({
      id: `d0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      user_id: USER_ID,
      source: i % 2 === 0 ? 'manual' : 'apple_health',
      external_id: `ext:${i}`,
      measured_at: `2026-11-${String(14 + i).padStart(2, '0')}T08:00:00.000Z`,
      kilograms: (80 + i * 0.2).toFixed(3),
      source_bundle: 'manual',
      source_name: i % 2 === 0 ? 'Manual entry' : 'Apple Health',
    }));

    const { handler } = makeHarness({
      foods: [{
        id: foodId,
        user_id: USER_ID,
        name: 'Greek Yogurt',
        calories: '150.0',
        protein: '18.0',
        carbs: '8.0',
        fat: '4.5',
        serving_size: '170.00',
        serving_unit: 'g',
        source: 'custom',
      }],
      groups: [
        { id: lunchId, user_id: USER_ID, date: '2026-11-22', kind: 'meal', label: 'lunch', sort_order: 1 },
        { id: breakfastId, user_id: USER_ID, date: '2026-11-22', kind: 'meal', label: 'breakfast', sort_order: 0 },
      ],
      logs: [{
        id: logId,
        user_id: USER_ID,
        date: '2026-11-22',
        logged_at: '2026-11-22T08:15:00.000Z',
        food_id: foodId,
        servings: '1.50',
        meal_type: 'breakfast',
        group_id: breakfastId,
        sort_order: 0,
        source: 'manual',
      }],
      macroTargets: new Map([[USER_ID, {
        user_id: USER_ID,
        calories: 2400,
        protein: 180,
        carbs: 260,
        fat: 70,
        source: 'adaptive',
      }]]),
      profiles: new Map([[USER_ID, {
        user_id: USER_ID,
        unit_system: 'imperial',
        goal: 'lean_bulk',
        adaptive_enabled: true,
      }]]),
      weights,
    });

    const { status, rpc } = await callTool(handler, 'get_day_summary', {});
    expect(status).toBe(200);
    expect(rpc.result?.isError).toBeUndefined();
    const data = rpc.result?.structuredContent as Record<string, unknown>;
    expect(data.date).toBe('2026-11-22');
    expect(data.macro_targets).toEqual({
      calories: 2400,
      protein: 180,
      carbs: 260,
      fat: 70,
      source: 'adaptive',
      is_default: false,
    });
    expect(data.totals).toEqual({ calories: 225, protein: 27, carbs: 12, fat: 6.8 });
    expect(data.remaining).toEqual({ calories: 2175, protein: 153, carbs: 248, fat: 63.2 });
    expect(data.nutrition_profile).toEqual({
      unit_system: 'imperial',
      goal: 'lean_bulk',
      adaptive_enabled: true,
    });
    expect((data.groups as Array<{ label: string }>).map((g) => g.label)).toEqual(['breakfast', 'lunch']);
    expect(data.entries).toEqual([{
      id: logId,
      date: '2026-11-22',
      food_id: foodId,
      food_name: 'Greek Yogurt',
      servings: 1.5,
      serving_size: 170,
      serving_unit: 'g',
      calories: 225,
      protein: 27,
      carbs: 12,
      fat: 6.8,
      meal_type: 'breakfast',
      group_id: breakfastId,
      logged_at: '2026-11-22T08:15:00.000Z',
    }]);

    const recent = data.recent_weigh_ins as Array<{ kilograms: number; pounds: number; measured_at: string }>;
    expect(recent).toHaveLength(7);
    expect(recent[0].measured_at).toBe('2026-11-22T08:00:00.000Z');
    expect(recent[0].kilograms).toBe(81.6);
    expect(recent[0].pounds).toBe(kgToLb(81.6));
  });

  it('uses default macro targets when none are saved, flags device-only stubs as incomplete, and rejects invalid dates', async () => {
    const stubFoodId = 'f8888888-8888-4888-8888-888888888888';
    const { handler } = makeHarness({
      foods: [{
        id: stubFoodId,
        user_id: USER_ID,
        name: DEVICE_ONLY_FOOD_NAME,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        serving_size: 1,
        serving_unit: 'serving',
        source: 'fatsecret',
        external_source: 'fatsecret',
        external_id: '100:200',
      }],
      logs: [{
        id: 'c8888888-8888-4888-8888-888888888888',
        user_id: USER_ID,
        date: '2026-11-20',
        logged_at: '2026-11-20T12:00:00.000Z',
        food_id: stubFoodId,
        servings: 1,
        meal_type: 'lunch',
        group_id: null,
        sort_order: 0,
        source: 'barcode_fatsecret',
      }],
    });
    const ok = await callTool(handler, 'get_day_summary', { date: '2026-11-20' });
    expect(ok.rpc.result?.structuredContent?.macro_targets).toEqual({
      ...DEFAULT_MACRO_TARGETS,
      source: 'default',
      is_default: true,
    });
    expect(ok.rpc.result?.structuredContent?.nutrition_profile).toBeNull();
    expect(ok.rpc.result?.structuredContent?.incomplete).toBe(true);
    expect((ok.rpc.result?.structuredContent?.entries as Array<{ device_only_stub?: boolean }>)[0]?.device_only_stub).toBe(true);

    const bad = await callTool(handler, 'get_day_summary', { date: '2026-02-30' });
    expect(bad.rpc.result?.isError).toBe(true);
    expect(bad.rpc.result?.content[0].text).toContain('valid calendar date');
  });
});

describe('Tool 2: search_foods', () => {
  it('filters out FatSecret device-only stubs, deduplicates identical entries preferring saved_meal, and supports empty query', async () => {
    const { handler, db } = makeHarness({
      foods: [
        {
          id: 'f1111111-1111-4111-8111-111111111111',
          user_id: USER_ID,
          name: DEVICE_ONLY_FOOD_NAME,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          serving_size: 1,
          serving_unit: 'serving',
          source: 'fatsecret',
          external_source: 'fatsecret',
          external_id: '12345:67890',
          created_at: '2026-11-22T12:00:00Z',
        },
        {
          id: 'f2222222-2222-4222-8222-222222222222',
          user_id: USER_ID,
          name: 'Chicken Breast',
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
          serving_size: 100,
          serving_unit: 'g',
          source: 'manual_entry',
          created_at: '2026-11-22T11:00:00Z',
        },
        {
          id: 'f3333333-3333-4333-8333-333333333333',
          user_id: USER_ID,
          name: 'Chicken Breast',
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
          serving_size: 100,
          serving_unit: 'g',
          source: 'saved_meal',
          created_at: '2026-11-20T11:00:00Z',
        },
        {
          id: 'f4444444-4444-4444-8444-444444444444',
          user_id: USER_ID,
          name: 'Grilled Chicken Bowl',
          calories: 550,
          protein: 45,
          carbs: 55,
          fat: 14,
          serving_size: 1,
          serving_unit: 'bowl',
          source: 'custom',
          created_at: '2026-11-21T10:00:00Z',
        },
        {
          id: 'f5555555-5555-4555-8555-555555555555',
          user_id: OTHER_USER_ID,
          name: 'Chicken Secret',
          calories: 200,
          protein: 30,
          carbs: 0,
          fat: 5,
          serving_size: 1,
          serving_unit: 'serving',
          source: 'custom',
          created_at: '2026-11-22T14:00:00Z',
        },
      ],
    });

    const initialCount = db.foods.length;

    const search = await callTool(handler, 'search_foods', { query: 'chicken' });
    expect(search.rpc.result?.isError).toBeUndefined();
    const foods = search.rpc.result?.structuredContent?.foods as Array<{ id: string; name: string; source: string }>;
    // Starts-with "Chicken Breast" first (and saved_meal deduplicates over manual_entry),
    // then "Grilled Chicken Bowl"; other user's food and FatSecret stub are excluded.
    expect(foods.map((f) => f.id)).toEqual([
      'f3333333-3333-4333-8333-333333333333',
      'f4444444-4444-4444-8444-444444444444',
    ]);

    const recent = await callTool(handler, 'search_foods', { limit: 10 });
    const recentFoods = recent.rpc.result?.structuredContent?.foods as Array<{ name: string }>;
    expect(recentFoods.some((f) => f.name === DEVICE_ONLY_FOOD_NAME)).toBe(false);
    expect(recentFoods).toHaveLength(2);
    expect(db.foods.length).toBe(initialCount);

    const badLimit = await callTool(handler, 'search_foods', { limit: 51 });
    expect(badLimit.rpc.result?.isError).toBe(true);
  });
});

describe('Tool 3: log_food', () => {
  it('logs a single inline food, inserts foods (manual_entry) and creates the named meal group', async () => {
    const { handler, db } = makeHarness();

    const { rpc } = await callTool(handler, 'log_food', {
      date: '2026-11-22',
      meal: 'breakfast',
      name: 'Scrambled Eggs',
      calories: 210,
      protein: 18,
      carbs: 2,
      fat: 14,
      servings: 2,
      serving_size: 3,
      serving_unit: 'eggs',
      description: 'Cooked in butter',
    });

    expect(rpc.result?.isError).toBeUndefined();
    const data = rpc.result?.structuredContent as Record<string, unknown>;
    expect(data.date).toBe('2026-11-22');
    expect(data.meal).toBe('breakfast');
    expect(data.logged_totals).toEqual({ calories: 420, protein: 36, carbs: 4, fat: 28 });

    expect(db.foods).toHaveLength(1);
    expect(db.foods[0]).toMatchObject({
      user_id: USER_ID,
      name: 'Scrambled Eggs',
      source: 'manual_entry',
      serving_size: 3,
      serving_unit: 'eggs',
      description: 'Cooked in butter',
    });

    expect(db.groups).toHaveLength(1);
    expect(db.groups[0]).toMatchObject({
      user_id: USER_ID,
      date: '2026-11-22',
      kind: 'meal',
      label: 'breakfast',
      sort_order: 0,
    });

    expect(db.logs).toHaveLength(1);
    expect(db.logs[0]).toMatchObject({
      user_id: USER_ID,
      date: '2026-11-22',
      food_id: db.foods[0].id,
      servings: 2,
      meal_type: 'breakfast',
      group_id: db.groups[0].id,
      sort_order: 0,
      source: 'manual',
    });
  });

  it('logs multiple items mixing existing food_id and inline food, reusing snack group (label: null)', async () => {
    const usdaFoodId = 'f1111111-1111-4111-8111-111111111111';
    const { handler, db } = makeHarness({
      foods: [{
        id: usdaFoodId,
        user_id: USER_ID,
        name: 'Banana',
        calories: 105,
        protein: 1.3,
        carbs: 27,
        fat: 0.4,
        serving_size: 1,
        serving_unit: 'medium',
        source: 'usda',
      }],
    });

    const first = await callTool(handler, 'log_food', {
      logged_at: '2026-11-22T15:00:00Z',
      items: [
        { food_id: usdaFoodId, servings: 1 },
        { name: 'Whey Shake', calories: 120, protein: 24, carbs: 3, fat: 1.5, servings: 1.5 },
      ],
    });
    expect(first.rpc.result?.isError).toBeUndefined();
    expect(db.groups).toHaveLength(1);
    expect(db.groups[0]).toMatchObject({ kind: 'snack', label: null });
    expect(db.logs).toHaveLength(2);
    expect(db.logs[0]).toMatchObject({ food_id: usdaFoodId, source: 'usda', meal_type: 'snack', sort_order: 0 });
    expect(db.logs[1]).toMatchObject({ source: 'manual', meal_type: 'snack', sort_order: 1, servings: 1.5 });
    expect(first.rpc.result?.structuredContent?.logged_totals).toEqual({
      calories: 285,
      protein: 37.3,
      carbs: 31.5,
      fat: 2.7,
    });

    // Second snack log on the same day reuses the existing snack group and advances sort_order.
    const second = await callTool(handler, 'log_food', {
      meal: 'snack',
      food_id: usdaFoodId,
      servings: 0.5,
    });
    expect(second.rpc.result?.isError).toBeUndefined();
    expect(db.groups).toHaveLength(1);
    expect(db.logs).toHaveLength(3);
    expect(db.logs[2]).toMatchObject({ group_id: db.groups[0].id, sort_order: 2 });
  });

  it('preserves Breakfast < Lunch < Dinner sort_order when inserting lunch between breakfast and dinner', async () => {
    const bId = 'b1111111-1111-4111-8111-111111111111';
    const dId = 'b2222222-2222-4222-8222-222222222222';
    const { handler, db } = makeHarness({
      groups: [
        { id: bId, user_id: USER_ID, date: '2026-11-22', kind: 'meal', label: 'breakfast', sort_order: 0 },
        { id: dId, user_id: USER_ID, date: '2026-11-22', kind: 'meal', label: 'dinner', sort_order: 1 },
      ],
    });

    const res = await callTool(handler, 'log_food', {
      date: '2026-11-22',
      meal: 'lunch',
      name: 'Turkey Sandwich',
      calories: 450,
      protein: 35,
      carbs: 42,
      fat: 14,
    });
    expect(res.rpc.result?.isError).toBeUndefined();

    const ordered = [...db.groups].sort((a, b) => a.sort_order - b.sort_order);
    expect(ordered.map((g) => `${g.label}:${g.sort_order}`)).toEqual(['breakfast:0', 'lunch:1', 'dinner:2']);
  });

  it('recovers cleanly when concurrent named-meal group creation triggers unique violation (23505)', async () => {
    const racedGroupId = 'b9999999-9999-4999-8999-999999999999';
    const { db, repositoryFor, nextId } = createMemoryDb();
    let getCount = 0;
    const baseRepo = repositoryFor(USER_ID);
    const racingRepo: McpRepository = {
      ...baseRepo,
      async getNutritionGroupsForDate(userId, date) {
        getCount += 1;
        if (getCount === 1) return [];
        return baseRepo.getNutritionGroupsForDate(userId, date);
      },
      async insertNutritionGroup(group) {
        db.groups.push({
          id: racedGroupId,
          ...group,
          created_at: FIXED_NOW.toISOString(),
          updated_at: FIXED_NOW.toISOString(),
        });
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      },
    };
    const handler = createMcpHandler({
      resourceUrl: RESOURCE_URL,
      authIssuer: AUTH_ISSUER,
      authenticate: async () => USER_ID,
      checkApproval: async () => null,
      repositoryFor: () => racingRepo,
      now: () => FIXED_NOW,
      generateId: nextId,
    });

    const res = await callTool(handler, 'log_food', {
      date: '2026-11-22',
      meal: 'breakfast',
      name: 'Oatmeal',
      calories: 300,
      protein: 10,
      carbs: 54,
      fat: 5,
    });
    expect(res.rpc.result?.isError).toBeUndefined();
    expect(db.logs[0]?.group_id).toBe(racedGroupId);
  });

  it('validates all items before writing anything (fail-fast) and rejects device-only stubs and invalid inputs', async () => {
    const stubId = 'f9999999-9999-4999-8999-999999999999';
    const { handler, db } = makeHarness({
      foods: [{
        id: stubId,
        user_id: USER_ID,
        name: DEVICE_ONLY_FOOD_NAME,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        serving_size: 1,
        serving_unit: 'serving',
        source: 'fatsecret',
        external_source: 'fatsecret',
        external_id: '11:22',
      }],
    });

    // Item 1 valid inline, item 2 missing food_id -> zero rows created.
    const missingFood = await callTool(handler, 'log_food', {
      meal: 'lunch',
      items: [
        { name: 'Rice', calories: 200, protein: 4, carbs: 44, fat: 0.4 },
        { food_id: 'f0000000-0000-4000-8000-000000000000', servings: 1 },
      ],
    });
    expect(missingFood.rpc.result?.isError).toBe(true);
    expect(db.foods).toHaveLength(1); // Only the pre-seeded stub
    expect(db.logs).toHaveLength(0);
    expect(db.groups).toHaveLength(0);

    const stubAttempt = await callTool(handler, 'log_food', { food_id: stubId, servings: 1 });
    expect(stubAttempt.rpc.result?.isError).toBe(true);
    expect(stubAttempt.rpc.result?.content[0].text).toContain('device-only');

    const invalidCases: Record<string, unknown>[] = [
      { items: [] },
      { items: [{ name: 'A', calories: 100, protein: 10, carbs: 10, fat: 2 }], name: 'B' },
      { food_id: stubId, name: 'Mixed', calories: 100, protein: 10, carbs: 10, fat: 2 },
      { name: 'Zero Servings', calories: 100, protein: 10, carbs: 10, fat: 2, servings: 0 },
      { name: 'Neg Cal', calories: -10, protein: 10, carbs: 10, fat: 2 },
      { name: 'Bad Meal', calories: 100, protein: 10, carbs: 10, fat: 2, meal: 'brunch' },
      { name: 'Bad Time', calories: 100, protein: 10, carbs: 10, fat: 2, logged_at: 'yesterday' },
    ];
    for (const args of invalidCases) {
      const res = await callTool(handler, 'log_food', args);
      expect(res.rpc.result?.isError).toBe(true);
    }
    expect(db.logs).toHaveLength(0);
  });
});

describe('Tool 4: update_food_log', () => {
  it('updates servings, logged_at, meal, and date (moving into target day group)', async () => {
    const foodId = 'f1111111-1111-4111-8111-111111111111';
    const logId = 'c1111111-1111-4111-8111-111111111111';
    const bGroupId = 'b1111111-1111-4111-8111-111111111111';
    const { handler, db } = makeHarness({
      foods: [{
        id: foodId,
        user_id: USER_ID,
        name: 'Oats',
        calories: 300,
        protein: 10,
        carbs: 54,
        fat: 5,
        serving_size: 80,
        serving_unit: 'g',
        source: 'custom',
      }],
      groups: [{
        id: bGroupId,
        user_id: USER_ID,
        date: '2026-11-22',
        kind: 'meal',
        label: 'breakfast',
        sort_order: 0,
      }],
      logs: [{
        id: logId,
        user_id: USER_ID,
        date: '2026-11-22',
        logged_at: '2026-11-22T08:00:00.000Z',
        food_id: foodId,
        servings: 1,
        meal_type: 'breakfast',
        group_id: bGroupId,
        sort_order: 0,
        source: 'manual',
      }],
    });

    // Update servings only -> keeps same group_id and date.
    const step1 = await callTool(handler, 'update_food_log', { log_id: logId, servings: 1.5 });
    expect(step1.rpc.result?.isError).toBeUndefined();
    expect(step1.rpc.result?.structuredContent?.entry).toMatchObject({
      id: logId,
      servings: 1.5,
      calories: 450,
      protein: 15,
      group_id: bGroupId,
      date: '2026-11-22',
    });

    // Move to another date and meal -> creates matching group on target date.
    const step2 = await callTool(handler, 'update_food_log', {
      log_id: logId,
      date: '2026-11-21',
      meal: 'dinner',
      logged_at: '2026-11-21T19:00:00Z',
    });
    expect(step2.rpc.result?.isError).toBeUndefined();
    const entry = step2.rpc.result?.structuredContent?.entry as Record<string, unknown>;
    expect(entry.date).toBe('2026-11-21');
    expect(entry.meal_type).toBe('dinner');
    expect(entry.logged_at).toBe('2026-11-21T19:00:00.000Z');
    expect(entry.group_id).not.toBe(bGroupId);

    const movedGroup = db.groups.find((g) => g.id === entry.group_id);
    expect(movedGroup).toMatchObject({ date: '2026-11-21', kind: 'meal', label: 'dinner' });

    // Moving date without specifying meal keeps meal_type ('dinner') and binds to new date's dinner group.
    const step3 = await callTool(handler, 'update_food_log', {
      log_id: logId,
      date: '2026-11-20',
    });
    expect(step3.rpc.result?.isError).toBeUndefined();
    const entry3 = step3.rpc.result?.structuredContent?.entry as Record<string, unknown>;
    const movedGroup3 = db.groups.find((g) => g.id === entry3.group_id);
    expect(movedGroup3).toMatchObject({ date: '2026-11-20', kind: 'meal', label: 'dinner' });
  });

  it('enforces ownership and rejects invalid inputs', async () => {
    const otherLogId = 'c9999999-9999-4999-8999-999999999999';
    const { handler } = makeHarness({
      logs: [{
        id: otherLogId,
        user_id: OTHER_USER_ID,
        date: '2026-11-22',
        logged_at: '2026-11-22T08:00:00.000Z',
        food_id: 'f1111111-1111-4111-8111-111111111111',
        servings: 1,
        meal_type: 'breakfast',
        group_id: null,
        sort_order: 0,
        source: 'manual',
      }],
    });

    const foreign = await callTool(handler, 'update_food_log', { log_id: otherLogId, servings: 2 });
    expect(foreign.rpc.result?.isError).toBe(true);
    expect(foreign.rpc.result?.content[0].text).toContain('not found');

    const empty = await callTool(handler, 'update_food_log', { log_id: otherLogId });
    expect(empty.rpc.result?.isError).toBe(true);

    const badServings = await callTool(handler, 'update_food_log', { log_id: otherLogId, servings: -2 });
    expect(badServings.rpc.result?.isError).toBe(true);

    const badId = await callTool(handler, 'update_food_log', { log_id: 'not-a-uuid', servings: 1 });
    expect(badId.rpc.result?.isError).toBe(true);
  });
});

describe('Tool 5: delete_food_log', () => {
  it('deletes an owned entry, returns deleted summary, and preserves the food row', async () => {
    const foodId = 'f1111111-1111-4111-8111-111111111111';
    const logId = 'c1111111-1111-4111-8111-111111111111';
    const { handler, db } = makeHarness({
      foods: [{
        id: foodId,
        user_id: USER_ID,
        name: 'Protein Bar',
        calories: 200,
        protein: 20,
        carbs: 22,
        fat: 7,
        serving_size: 1,
        serving_unit: 'bar',
        source: 'custom',
      }],
      logs: [{
        id: logId,
        user_id: USER_ID,
        date: '2026-11-22',
        logged_at: '2026-11-22T14:00:00.000Z',
        food_id: foodId,
        servings: 2,
        meal_type: 'snack',
        group_id: null,
        sort_order: 0,
        source: 'manual',
      }],
    });

    const res = await callTool(handler, 'delete_food_log', { log_id: logId });
    expect(res.rpc.result?.isError).toBeUndefined();
    expect(res.rpc.result?.structuredContent).toMatchObject({
      deleted: true,
      entry: {
        id: logId,
        food_id: foodId,
        food_name: 'Protein Bar',
        servings: 2,
        calories: 400,
        protein: 40,
      },
    });
    expect(db.logs).toHaveLength(0);
    expect(db.foods).toHaveLength(1);

    // Deleting a second time reports not found.
    const second = await callTool(handler, 'delete_food_log', { log_id: logId });
    expect(second.rpc.result?.isError).toBe(true);
    expect(second.rpc.result?.content[0].text).toContain('not found');
  });
});

describe('Tool 6: log_body_weight', () => {
  it('converts lb to kg accurately (3 decimals), writes agent metadata, and returns kg + lb', async () => {
    const { handler, db } = makeHarness();

    const lbRes = await callTool(handler, 'log_body_weight', { weight: 180.5, unit: 'lb' });
    expect(lbRes.rpc.result?.isError).toBeUndefined();

    const expectedKg = lbToKg(180.5); // 81.873
    expect(expectedKg).toBe(81.873);
    expect(lbRes.rpc.result?.structuredContent).toMatchObject({
      measured_at: FIXED_NOW.toISOString(),
      kilograms: 81.873,
      pounds: 180.5,
      source: 'manual',
      source_bundle: 'agent',
      source_name: 'Agent',
    });
    expect(db.weights).toHaveLength(1);
    expect(db.weights[0].external_id).toBe(`agent:${db.weights[0].id}`);
    expect(db.weights[0].source).toBe('manual');
    expect(db.weights[0].source_bundle).toBe('agent');
    expect(db.weights[0].source_name).toBe('Agent');

    const kgRes = await callTool(handler, 'log_body_weight', {
      weight: 80,
      unit: 'kg',
      measured_at: '2026-11-21T07:30:00-08:00',
    });
    expect(kgRes.rpc.result?.isError).toBeUndefined();
    expect(kgRes.rpc.result?.structuredContent).toMatchObject({
      measured_at: '2026-11-21T15:30:00.000Z',
      kilograms: 80,
      pounds: 176.37,
    });
    expect(db.weights).toHaveLength(2);
  });

  it('rejects non-positive, out-of-range (>= 500 kg), invalid unit, and invalid timestamp', async () => {
    const { handler, db } = makeHarness();

    const badCases: Record<string, unknown>[] = [
      { weight: 0, unit: 'lb' },
      { weight: -150, unit: 'lb' },
      { weight: 500, unit: 'kg' },
      { weight: 1103, unit: 'lb' },
      { weight: 0.0001, unit: 'lb' },
      { weight: 180, unit: 'st' },
      { weight: 180, unit: 'lb', measured_at: 'not-a-timestamp' },
    ];
    for (const args of badCases) {
      const res = await callTool(handler, 'log_body_weight', args);
      expect(res.rpc.result?.isError).toBe(true);
    }
    expect(db.weights).toHaveLength(0);
  });
});

describe('MCP Edge Function module boundaries & security wiring', () => {
  it('keeps handler/tools/types free of Deno globals and esm.sh imports', () => {
    for (const file of ['handler.ts', 'tools.ts', 'types.ts']) {
      const source = readFileSync(new URL(`../supabase/functions/mcp/${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/\bDeno\./);
      expect(source).not.toContain('https://esm.sh/');
    }
  });

  it('wires index.ts with user-scoped RLS client and restricts service role to approvalRefusal', () => {
    const source = readFileSync(new URL('../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
    expect(source).toContain('SUPABASE_ANON_KEY');
    expect(source).toContain('Authorization: `Bearer ${token}`');
    expect(source).toContain('approvalRefusal(service, userId');
    expect(source).not.toContain('createUserRepository(service)');
  });
});
