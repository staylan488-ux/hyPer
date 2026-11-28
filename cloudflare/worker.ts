// Cloudflare Worker for thehyper.app and mcp.thehyper.app.
// - mcp.thehyper.app proxies MCP Streamable HTTP + RFC 9728 discovery cleanly
//   to hyPer's Supabase Edge Function (strict header allowlist, no cookies), and
//   serves RFC 8414 OAuth 2.1 Authorization Server metadata + OAuth proxy paths
//   so custom-domain clients never hit Supabase's upstream supabase/auth#2486
//   issuer mismatch or see *.supabase.co in the iOS sign-in sheet.
// - thehyper.app serves the static Blanc site (including /oauth/consent) from
//   Cloudflare Workers Static Assets (site/).

export interface WorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  SUPABASE_MCP_URL: string;
  SUPABASE_AUTH_URL: string;
}

const MCP_HOST = 'mcp.thehyper.app';
const MCP_ORIGIN = `https://${MCP_HOST}`;

const FORWARDED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-protocol-version',
  'mcp-session-id',
  'origin',
  'access-control-request-method',
  'access-control-request-headers',
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'location',
  'www-authenticate',
  'cache-control',
  'allow',
  'vary',
  'mcp-protocol-version',
  'mcp-session-id',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
] as const;

const OAUTH_PROXY_PATHS: Record<string, string> = {
  '/oauth/authorize': '/oauth/authorize',
  '/oauth/token': '/oauth/token',
  '/oauth/clients/register': '/oauth/clients/register',
  '/oauth/userinfo': '/oauth/userinfo',
  '/.well-known/jwks.json': '/.well-known/jwks.json',
};

const OAUTH_METADATA_PATHS = new Set([
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
]);

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveMcpUpstreamUrl(pathname: string, supabaseMcpUrl: string): string | null {
  const base = stripTrailingSlashes(supabaseMcpUrl);
  const normalized = pathname.replace(/\/+$/, '') || '/';

  if (normalized === '/' || normalized === '/mcp') {
    return base;
  }
  if (
    normalized === '/.well-known/oauth-protected-resource'
    || normalized.startsWith('/.well-known/oauth-protected-resource/')
  ) {
    return `${base}/.well-known/oauth-protected-resource`;
  }
  return null;
}

export function resolveOAuthUpstreamUrl(
  pathname: string,
  search: string,
  supabaseAuthUrl: string,
): string | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const suffix = OAUTH_PROXY_PATHS[normalized];
  if (!suffix) return null;
  return `${stripTrailingSlashes(supabaseAuthUrl)}${suffix}${search}`;
}

export function isOAuthMetadataPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return OAUTH_METADATA_PATHS.has(normalized);
}

export function rewriteOAuthServerMetadata(
  upstream: Record<string, unknown>,
  publicIssuer = MCP_ORIGIN,
): Record<string, unknown> {
  const origin = stripTrailingSlashes(publicIssuer);
  return {
    ...upstream,
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    jwks_uri: `${origin}/.well-known/jwks.json`,
    userinfo_endpoint: `${origin}/oauth/userinfo`,
    ...(upstream.registration_endpoint ? { registration_endpoint: `${origin}/oauth/clients/register` } : {}),
  };
}

export function isMcpHostname(hostname: string): boolean {
  return hostname.toLowerCase() === MCP_HOST;
}

async function proxyToUpstream(
  request: Request,
  upstreamUrl: string,
  upstreamFetch: typeof fetch,
): Promise<Response> {
  const forwardHeaders = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) forwardHeaders.set(name, value);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstreamResponse = await upstreamFetch(upstreamUrl, {
    method: request.method,
    headers: forwardHeaders,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstreamResponse.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export async function handleWorkerRequest(
  request: Request,
  env: WorkerEnv,
  upstreamFetch: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);

  if (!isMcpHostname(url.hostname)) {
    return env.ASSETS.fetch(request);
  }

  if (request.method === 'GET' && isOAuthMetadataPath(url.pathname)) {
    const metadataUrl = `${stripTrailingSlashes(env.SUPABASE_AUTH_URL)}/.well-known/oauth-authorization-server`;
    const upstreamResponse = await upstreamFetch(metadataUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'manual',
    });
    if (!upstreamResponse.ok) {
      return new Response(JSON.stringify({ error: 'OAuth metadata unavailable' }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    const payload = await upstreamResponse.json() as Record<string, unknown>;
    const rewritten = rewriteOAuthServerMetadata(payload, url.origin);
    return new Response(JSON.stringify(rewritten), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const oauthUpstreamUrl = resolveOAuthUpstreamUrl(url.pathname, url.search, env.SUPABASE_AUTH_URL);
  if (oauthUpstreamUrl) {
    return proxyToUpstream(request, oauthUpstreamUrl, upstreamFetch);
  }

  const mcpUpstreamUrl = resolveMcpUpstreamUrl(url.pathname, env.SUPABASE_MCP_URL);
  if (mcpUpstreamUrl) {
    return proxyToUpstream(request, mcpUpstreamUrl, upstreamFetch);
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleWorkerRequest(request, env);
  },
};
