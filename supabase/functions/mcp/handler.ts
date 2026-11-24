// Remote MCP Server (Streamable HTTP, JSON-RPC 2.0) with RFC 9728 OAuth 2.1
// Protected Resource Metadata discovery and fail-closed approval enforcement.
// Kept free of Deno and network imports so Vitest can test it directly
// (index.ts wires the real Supabase clients).

import { TOOL_DEFINITIONS, executeTool, hasTool } from './tools.ts';
import type {
  JsonRpcId,
  JsonRpcResponse,
  McpServices,
} from './types.ts';

export * from './types.ts';
export {
  DEFAULT_MACRO_TARGETS,
  DEVICE_ONLY_FOOD_NAME,
  KG_PER_LB,
  TOOL_DEFINITIONS,
  isDeviceOnlyFoodStub,
  kgToLb,
  lbToKg,
  todayUtcDate,
} from './tools.ts';

export const MCP_SERVER_INFO = {
  name: 'hyPer',
  version: '1.0.0',
} as const;

export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const MCP_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, mcp-session-id, mcp-protocol-version',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id',
} as const;

const SERVER_INSTRUCTIONS =
  'hyPer nutrition and body-weight tracker. Use get_day_summary to view daily macro targets, totals, meal groups, food logs, and recent weigh-ins. Use search_foods to find existing foods before calling log_food. Use update_food_log, delete_food_log, and log_body_weight to modify entries or record weigh-ins.';

const MAX_BODY_BYTES = 1_048_576;
const MAX_BATCH_SIZE = 20;

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

export function protectedResourceMetadataUrl(resourceUrl: string): string {
  return `${stripTrailingSlashes(resourceUrl)}/.well-known/oauth-protected-resource`;
}

export function buildProtectedResourceMetadata(resourceUrl: string, authIssuer: string) {
  return {
    resource: stripTrailingSlashes(resourceUrl),
    authorization_servers: [stripTrailingSlashes(authIssuer)],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile'],
  };
}

export function buildWwwAuthenticateHeader(resourceUrl: string): string {
  return `Bearer resource_metadata="${protectedResourceMetadataUrl(resourceUrl)}"`;
}

function isProtectedResourceMetadataPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '');
  return (
    normalized === '/.well-known/oauth-protected-resource'
    || normalized.endsWith('/.well-known/oauth-protected-resource')
    || normalized.includes('/.well-known/oauth-protected-resource/')
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...MCP_CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function unauthorizedResponse(resourceUrl: string): Response {
  return jsonResponse(
    { error: 'Unauthorized' },
    401,
    { 'WWW-Authenticate': buildWwwAuthenticateHeader(resourceUrl) },
  );
}

function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function isValidJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

async function readBoundedText(request: Request): Promise<{ ok: true; text: string } | { ok: false; status: 413 | 400; message: string }> {
  const lengthHeader = request.headers.get('content-length');
  if (lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > MAX_BODY_BYTES) {
    return { ok: false, status: 413, message: 'Request body exceeds limit.' };
  }
  try {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_BODY_BYTES) {
      return { ok: false, status: 413, message: 'Request body exceeds limit.' };
    }
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(buffer) };
  } catch {
    return { ok: false, status: 400, message: 'Invalid UTF-8 request body.' };
  }
}

export function createMcpHandler(services: McpServices) {
  const log = services.log ?? (() => {});
  const now = services.now ?? (() => new Date());
  const generateId = services.generateId ?? (() => crypto.randomUUID());

  async function dispatchRpcMessage(
    raw: unknown,
    userId: string,
    token: string,
  ): Promise<{ response: JsonRpcResponse | null; protocolVersion?: string }> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { response: rpcError(null, JSONRPC_INVALID_REQUEST, 'Invalid Request') };
    }

    const message = raw as Record<string, unknown>;
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');
    const id: JsonRpcId = hasId && isValidJsonRpcId(message.id) ? message.id : null;

    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method.trim()) {
      return { response: rpcError(id, JSONRPC_INVALID_REQUEST, 'Invalid Request') };
    }
    if (hasId && !isValidJsonRpcId(message.id)) {
      return { response: rpcError(null, JSONRPC_INVALID_REQUEST, 'Invalid Request: id must be a string, number, or null') };
    }

    const method = message.method;
    const isNotification = !hasId;

    if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
      return { response: isNotification ? null : rpcResult(id, {}) };
    }

    if (method === 'initialize') {
      const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params)
        ? (message.params as Record<string, unknown>)
        : {};
      const protocolVersion = negotiateProtocolVersion(params.protocolVersion);
      if (isNotification) return { response: null, protocolVersion };
      return {
        protocolVersion,
        response: rpcResult(id, {
          protocolVersion,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: MCP_SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        }),
      };
    }

    if (method === 'ping') {
      return { response: isNotification ? null : rpcResult(id, {}) };
    }

    if (method === 'tools/list') {
      return {
        response: isNotification ? null : rpcResult(id, { tools: TOOL_DEFINITIONS }),
      };
    }

    if (method === 'tools/call') {
      if (!message.params || typeof message.params !== 'object' || Array.isArray(message.params)) {
        return {
          response: isNotification ? null : rpcError(id, JSONRPC_INVALID_PARAMS, 'Invalid params: expected object'),
        };
      }
      const params = message.params as Record<string, unknown>;
      if (typeof params.name !== 'string' || !params.name.trim()) {
        return {
          response: isNotification ? null : rpcError(id, JSONRPC_INVALID_PARAMS, 'Invalid params: tool name is required'),
        };
      }
      if (!hasTool(params.name)) {
        return {
          response: isNotification ? null : rpcError(id, JSONRPC_INVALID_PARAMS, `Unknown tool: ${params.name}`),
        };
      }
      if (
        params.arguments !== undefined
        && (params.arguments === null || typeof params.arguments !== 'object' || Array.isArray(params.arguments))
      ) {
        return {
          response: isNotification ? null : rpcError(id, JSONRPC_INVALID_PARAMS, 'Invalid params: arguments must be an object'),
        };
      }

      const repo = services.repositoryFor(userId, token);
      const result = await executeTool(params.name, params.arguments ?? {}, {
        userId,
        repo,
        now,
        generateId,
      }, log);
      return { response: isNotification ? null : rpcResult(id, result) };
    }

    return {
      response: isNotification ? null : rpcError(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`),
    };
  }

  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
    }

    let pathname = '/';
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      pathname = '/';
    }

    // RFC 9728 OAuth Protected Resource Metadata discovery is public on GET.
    if (request.method === 'GET' && isProtectedResourceMetadataPath(pathname)) {
      return new Response(
        JSON.stringify(buildProtectedResourceMetadata(services.resourceUrl, services.authIssuer)),
        {
          status: 200,
          headers: {
            ...MCP_CORS_HEADERS,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
          },
        },
      );
    }

    if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE') {
      return jsonResponse({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST, DELETE, OPTIONS' });
    }

    // Authenticate Bearer token before serving any MCP endpoint.
    const token = bearerToken(request);
    if (!token) {
      return unauthorizedResponse(services.resourceUrl);
    }

    let userId: string | null = null;
    try {
      userId = await services.authenticate(token);
    } catch (error) {
      log('mcp: authentication check failed', error);
      return jsonResponse({ error: 'Could not verify authentication. Try again.' }, 503);
    }
    if (!userId) {
      return unauthorizedResponse(services.resourceUrl);
    }

    // Approval gate (fail closed: 403 when unapproved, 503 if check fails).
    try {
      const refusal = await services.checkApproval(userId);
      if (refusal) {
        return jsonResponse(refusal.body, refusal.status);
      }
    } catch (error) {
      log('mcp: approval check failed', error);
      return jsonResponse({ error: 'hyPer MCP is temporarily unavailable.' }, 503);
    }

    // Stateless Streamable HTTP: GET does not open a server-initiated SSE stream;
    // DELETE acknowledges stateless session teardown cleanly.
    if (request.method === 'GET') {
      return jsonResponse({ error: 'Method not allowed: SSE stream not offered' }, 405, { Allow: 'POST, DELETE, OPTIONS' });
    }
    if (request.method === 'DELETE') {
      return new Response(null, { status: 204, headers: { ...MCP_CORS_HEADERS, 'Cache-Control': 'no-store' } });
    }

    // POST: JSON-RPC 2.0 over Streamable HTTP.
    const contentType = request.headers.get('content-type');
    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      return jsonResponse({ error: 'Content-Type must be application/json' }, 415);
    }

    const rawBody = await readBoundedText(request);
    if (!rawBody.ok) {
      return jsonResponse(
        rpcError(null, JSONRPC_INVALID_REQUEST, rawBody.message),
        rawBody.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.text);
    } catch {
      return jsonResponse(rpcError(null, JSONRPC_PARSE_ERROR, 'Parse error: invalid JSON'), 400);
    }

    const requestProtocolHeader = request.headers.get('mcp-protocol-version');
    const responseProtocolHeader = (version?: string): Record<string, string> => {
      const chosen = version ?? (
        requestProtocolHeader && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requestProtocolHeader)
          ? requestProtocolHeader
          : undefined
      );
      return chosen ? { 'MCP-Protocol-Version': chosen } : {};
    };

    try {
      if (Array.isArray(parsed)) {
        if (parsed.length === 0 || parsed.length > MAX_BATCH_SIZE) {
          return jsonResponse(
            rpcError(null, JSONRPC_INVALID_REQUEST, `Invalid Request: batch must contain 1 to ${MAX_BATCH_SIZE} items`),
            400,
          );
        }
        const responses: JsonRpcResponse[] = [];
        let negotiatedVersion: string | undefined;
        for (const entry of parsed) {
          const outcome = await dispatchRpcMessage(entry, userId, token);
          if (outcome.protocolVersion) negotiatedVersion = outcome.protocolVersion;
          if (outcome.response) responses.push(outcome.response);
        }
        if (responses.length === 0) {
          return new Response(null, {
            status: 202,
            headers: {
              ...MCP_CORS_HEADERS,
              'Cache-Control': 'no-store',
              ...responseProtocolHeader(negotiatedVersion),
            },
          });
        }
        return jsonResponse(responses, 200, responseProtocolHeader(negotiatedVersion));
      }

      const outcome = await dispatchRpcMessage(parsed, userId, token);
      if (!outcome.response) {
        return new Response(null, {
          status: 202,
          headers: {
            ...MCP_CORS_HEADERS,
            'Cache-Control': 'no-store',
            ...responseProtocolHeader(outcome.protocolVersion),
          },
        });
      }
      return jsonResponse(outcome.response, 200, responseProtocolHeader(outcome.protocolVersion));
    } catch (error) {
      log('mcp: unexpected request error', error);
      return jsonResponse(rpcError(null, JSONRPC_INTERNAL_ERROR, 'Internal server error'), 500);
    }
  };
}
