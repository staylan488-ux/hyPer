import { describe, expect, it, vi } from 'vitest';
import {
  handleWorkerRequest,
  isMcpHostname,
  isOAuthMetadataPath,
  resolveMcpUpstreamUrl,
  resolveOAuthUpstreamUrl,
  rewriteOAuthServerMetadata,
  type WorkerEnv,
} from '../cloudflare/worker';

const UPSTREAM_MCP = 'https://nnwfaaxmyvqsdnfcdxom.supabase.co/functions/v1/mcp';
const UPSTREAM_AUTH = 'https://auth.thehyper.app/auth/v1';

function makeEnv(assetResponse = new Response('ok', { status: 200 })) {
  const assetsFetch = vi.fn(async () => assetResponse);
  const env: WorkerEnv = {
    ASSETS: { fetch: assetsFetch },
    SUPABASE_MCP_URL: UPSTREAM_MCP,
    SUPABASE_AUTH_URL: UPSTREAM_AUTH,
  };
  return { env, assetsFetch };
}

describe('thehyper.app Cloudflare Worker gateway', () => {
  it('routes thehyper.app requests straight to static assets', async () => {
    const { env, assetsFetch } = makeEnv(new Response('<html>consent</html>', { status: 200 }));
    const upstreamFetch = vi.fn();

    const response = await handleWorkerRequest(
      new Request('https://thehyper.app/oauth/consent?authorization_id=abc'),
      env,
      upstreamFetch,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>consent</html>');
    expect(assetsFetch).toHaveBeenCalledOnce();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('resolves valid MCP paths and rejects unknown paths', () => {
    expect(isMcpHostname('mcp.thehyper.app')).toBe(true);
    expect(isMcpHostname('MCP.THEHYPER.APP')).toBe(true);
    expect(isMcpHostname('thehyper.app')).toBe(false);

    expect(resolveMcpUpstreamUrl('/', `${UPSTREAM_MCP}/`)).toBe(UPSTREAM_MCP);
    expect(resolveMcpUpstreamUrl('/mcp', UPSTREAM_MCP)).toBe(UPSTREAM_MCP);
    expect(resolveMcpUpstreamUrl('/mcp/', UPSTREAM_MCP)).toBe(UPSTREAM_MCP);
    expect(resolveMcpUpstreamUrl('/.well-known/oauth-protected-resource', UPSTREAM_MCP)).toBe(
      `${UPSTREAM_MCP}/.well-known/oauth-protected-resource`,
    );
    expect(resolveMcpUpstreamUrl('/.well-known/oauth-protected-resource/mcp', UPSTREAM_MCP)).toBe(
      `${UPSTREAM_MCP}/.well-known/oauth-protected-resource`,
    );
    expect(resolveMcpUpstreamUrl('/admin', UPSTREAM_MCP)).toBeNull();
  });

  it('rewrites RFC 8414 OAuth server metadata to mcp.thehyper.app with zero supabase.co leaks', async () => {
    expect(isOAuthMetadataPath('/.well-known/oauth-authorization-server')).toBe(true);
    expect(isOAuthMetadataPath('/.well-known/openid-configuration')).toBe(true);
    expect(isOAuthMetadataPath('/.well-known/oauth-protected-resource')).toBe(false);

    const { env } = makeEnv();
    const upstreamFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          issuer: 'https://nnwfaaxmyvqsdnfcdxom.supabase.co/auth/v1',
          authorization_endpoint: 'https://nnwfaaxmyvqsdnfcdxom.supabase.co/auth/v1/oauth/authorize',
          token_endpoint: 'https://nnwfaaxmyvqsdnfcdxom.supabase.co/auth/v1/oauth/token',
          jwks_uri: 'https://nnwfaaxmyvqsdnfcdxom.supabase.co/auth/v1/.well-known/jwks.json',
          userinfo_endpoint: 'https://nnwfaaxmyvqsdnfcdxom.supabase.co/auth/v1/oauth/userinfo',
          registration_endpoint: 'https://nnwfaaxmyvqsdnfcdxom.supabase.co/auth/v1/oauth/clients/register',
          response_types_supported: ['code'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await handleWorkerRequest(
      new Request('https://mcp.thehyper.app/.well-known/oauth-authorization-server'),
      env,
      upstreamFetch,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(
      rewriteOAuthServerMetadata(
        { registration_endpoint: 'https://x', response_types_supported: ['code'] },
        'https://mcp.thehyper.app',
      ),
    );
    expect(body.issuer).toBe('https://mcp.thehyper.app');
    expect(body.authorization_endpoint).toBe('https://mcp.thehyper.app/oauth/authorize');
    expect(body.token_endpoint).toBe('https://mcp.thehyper.app/oauth/token');
    expect(body.registration_endpoint).toBe('https://mcp.thehyper.app/oauth/clients/register');
    expect(JSON.stringify(body)).not.toContain('supabase.co');
  });

  it('proxies OAuth endpoints preserving query string and 302 Location redirects', async () => {
    expect(resolveOAuthUpstreamUrl('/oauth/authorize', '?client_id=c1', UPSTREAM_AUTH)).toBe(
      `${UPSTREAM_AUTH}/oauth/authorize?client_id=c1`,
    );
    expect(resolveOAuthUpstreamUrl('/oauth/token', '', UPSTREAM_AUTH)).toBe(`${UPSTREAM_AUTH}/oauth/token`);
    expect(resolveOAuthUpstreamUrl('/oauth/clients/register', '', UPSTREAM_AUTH)).toBe(
      `${UPSTREAM_AUTH}/oauth/clients/register`,
    );
    expect(resolveOAuthUpstreamUrl('/admin/users', '', UPSTREAM_AUTH)).toBeNull();

    const { env } = makeEnv();
    const upstreamFetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: {
          Location: 'https://thehyper.app/oauth/consent/?authorization_id=req-123',
        },
      }),
    );

    const response = await handleWorkerRequest(
      new Request('https://mcp.thehyper.app/oauth/authorize?client_id=c1&response_type=code'),
      env,
      upstreamFetch,
    );

    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [calledUrl] = upstreamFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(`${UPSTREAM_AUTH}/oauth/authorize?client_id=c1&response_type=code`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://thehyper.app/oauth/consent/?authorization_id=req-123');
  });

  it('proxies MCP requests with an explicit header allowlist and strips cookies', async () => {
    const { env, assetsFetch } = makeEnv();
    const upstreamFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.thehyper.app/.well-known/oauth-protected-resource"',
          'Set-Cookie': 'upstream=should-not-pass',
        },
      }),
    );

    const request = new Request('https://mcp.thehyper.app/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        Cookie: 'session=secret',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    const response = await handleWorkerRequest(request, env, upstreamFetch);

    expect(assetsFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [calledUrl, init] = upstreamFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(UPSTREAM_MCP);
    const sentHeaders = init.headers as Headers;
    expect(sentHeaders.get('authorization')).toBe('Bearer tok');
    expect(sentHeaders.get('mcp-protocol-version')).toBe('2025-06-18');
    expect(sentHeaders.get('cookie')).toBeNull();

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('https://mcp.thehyper.app/.well-known/oauth-protected-resource');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns 404 for unknown paths on mcp.thehyper.app', async () => {
    const { env } = makeEnv();
    const upstreamFetch = vi.fn();

    const response = await handleWorkerRequest(
      new Request('https://mcp.thehyper.app/nope'),
      env,
      upstreamFetch,
    );

    expect(response.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
