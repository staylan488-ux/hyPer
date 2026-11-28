import { describe, expect, it, vi } from 'vitest';

import {
  MCP_SERVER_HOST,
  MCP_SERVER_URL,
  agentConnectedLabel,
  agentDetail,
  agentHost,
  connectionsSummaryLabel,
  listAgentGrants,
  normalizeAgentGrant,
  revokeAgentGrant,
  sortAgentGrants,
  type AgentGrant,
} from '@/lib/agentGrants';
import { createMockClient } from '@/preview/mockSupabase';

describe('agentGrants pure helpers', () => {
  it('exposes the production MCP server address', () => {
    expect(MCP_SERVER_URL).toBe('https://mcp.thehyper.app');
    expect(MCP_SERVER_HOST).toBe('mcp.thehyper.app');
  });

  it('extracts a clean host from http(s) URIs and rejects invalid or non-http schemes', () => {
    expect(agentHost('https://www.claude.ai/oauth')).toBe('claude.ai');
    expect(agentHost('https://chatgpt.com')).toBe('chatgpt.com');
    expect(agentHost('http://localhost:3000/callback')).toBe('localhost:3000');
    expect(agentHost('javascript:alert(1)')).toBeNull();
    expect(agentHost('not a url')).toBeNull();
    expect(agentHost('')).toBeNull();
    expect(agentHost(null)).toBeNull();
  });

  it('normalizes raw OAuth grants with sensible fallbacks', () => {
    expect(normalizeAgentGrant({
      client: { id: 'c1', name: '  Claude  ', uri: 'https://www.claude.ai' },
      granted_at: '2026-11-23T18:00:00Z',
    })).toEqual({
      clientId: 'c1',
      name: 'Claude',
      host: 'claude.ai',
      grantedAt: '2026-11-23T18:00:00Z',
    });

    expect(normalizeAgentGrant({
      client: { id: 'c2', name: '   ', uri: 'https://chatgpt.com' },
      granted_at: '2026-11-23T18:00:00Z',
    })).toEqual({
      clientId: 'c2',
      name: 'chatgpt.com',
      host: 'chatgpt.com',
      grantedAt: '2026-11-23T18:00:00Z',
    });

    expect(normalizeAgentGrant({
      client: { id: 'c3', name: '', uri: '' },
      granted_at: '',
    })).toEqual({
      clientId: 'c3',
      name: 'Connected agent',
      host: null,
      grantedAt: '',
    });

    expect(normalizeAgentGrant({ client: { id: '  ' }, granted_at: '2026-11-23T18:00:00Z' })).toBeNull();
    expect(normalizeAgentGrant(null)).toBeNull();
  });

  it('deduplicates by clientId (keeping newest) and sorts newest first then by name', () => {
    const sorted = sortAgentGrants([
      { clientId: 'a', name: 'Zeta', host: null, grantedAt: '2026-11-20T12:00:00Z' },
      { clientId: 'b', name: 'Claude', host: 'claude.ai', grantedAt: '2026-11-23T12:00:00Z' },
      { clientId: 'a', name: 'Zeta', host: null, grantedAt: '2026-11-24T12:00:00Z' },
      { clientId: 'c', name: 'Alpha', host: null, grantedAt: '2026-11-23T12:00:00Z' },
    ]);
    expect(sorted.map((grant) => [grant.clientId, grant.name])).toEqual([
      ['a', 'Zeta'],
      ['c', 'Alpha'],
      ['b', 'Claude'],
    ]);
  });

  it('formats connected date relative to todayKey without calling the wall clock', () => {
    const today = new Date(2026, 10, 23, 9, 30);
    const earlierThisYear = new Date(2026, 9, 5, 14, 0);
    const lastYear = new Date(2025, 11, 12, 8, 0);

    expect(agentConnectedLabel(today.toISOString(), '2026-11-23')).toBe('Connected today');
    expect(agentConnectedLabel(today.toISOString(), '2026-11-24')).toBe('Connected Nov 23');
    expect(agentConnectedLabel(earlierThisYear.toISOString(), '2026-11-23')).toBe('Connected Oct 5');
    expect(agentConnectedLabel(lastYear.toISOString(), '2026-11-23')).toBe('Connected Dec 12, 2025');
    expect(agentConnectedLabel('invalid', '2026-11-23')).toBe('Connected');
  });

  it('omits repeating the host in detail when the name is already the host', () => {
    const today = new Date(2026, 10, 23, 9, 30).toISOString();
    expect(agentDetail({ name: 'Claude', host: 'claude.ai', grantedAt: today }, '2026-11-23')).toEqual([
      'claude.ai',
      'Connected today',
    ]);
    expect(agentDetail({ name: 'chatgpt.com', host: 'chatgpt.com', grantedAt: today }, '2026-11-23')).toBe(
      'Connected today',
    );
    expect(agentDetail({ name: 'Local CLI', host: null, grantedAt: today }, '2026-11-23')).toBe('Connected today');
  });

  it('summarizes Connections for the You screen cleanly', () => {
    const claude: AgentGrant = { clientId: 'c1', name: 'Claude', host: 'claude.ai', grantedAt: '2026-11-23T12:00:00Z' };
    const chatgpt: AgentGrant = { clientId: 'c2', name: 'ChatGPT', host: 'chatgpt.com', grantedAt: '2026-11-22T12:00:00Z' };

    expect(connectionsSummaryLabel({ whoop: false, health: false, agents: null })).toBeUndefined();
    expect(connectionsSummaryLabel({ whoop: false, health: false, agents: [] })).toBeUndefined();
    expect(connectionsSummaryLabel({ whoop: false, health: false, agents: [claude] })).toBe('Claude');
    expect(connectionsSummaryLabel({ whoop: false, health: false, agents: [claude, chatgpt] })).toBe('2 agents');
    expect(connectionsSummaryLabel({ whoop: true, health: true, agents: [claude] })).toBe('Claude, WHOOP, Health');
    expect(connectionsSummaryLabel({ whoop: true, health: true, agents: [] })).toBe('WHOOP, Health');
  });
});

describe('listAgentGrants and revokeAgentGrant', () => {
  it('lists and normalizes grants from supabase.auth.oauth', async () => {
    const listGrants = vi.fn(async () => ({
      data: [
        { client: { id: 'c1', name: 'Older', uri: 'https://old.example' }, granted_at: '2026-11-20T10:00:00Z' },
        { client: { id: 'c2', name: 'Claude', uri: 'https://claude.ai' }, granted_at: '2026-11-23T10:00:00Z' },
        { client: { id: '' }, granted_at: '2026-11-24T10:00:00Z' },
      ],
      error: null,
    }));

    const result = await listAgentGrants({ auth: { oauth: { listGrants } } });
    expect(listGrants).toHaveBeenCalledTimes(1);
    expect(result.map((g) => g.clientId)).toEqual(['c2', 'c1']);
  });

  it('returns an empty list when oauth is unavailable and throws on API errors', async () => {
    await expect(listAgentGrants({})).resolves.toEqual([]);
    const error = new Error('network down');
    await expect(
      listAgentGrants({ auth: { oauth: { listGrants: async () => ({ data: null, error }) } } }),
    ).rejects.toThrow('network down');
  });

  it('revokes a grant by clientId and throws on error or unsupported client', async () => {
    const revokeGrant = vi.fn(async () => ({ data: {}, error: null }));
    await revokeAgentGrant('client-123', { auth: { oauth: { revokeGrant } } });
    expect(revokeGrant).toHaveBeenCalledWith({ clientId: 'client-123' });

    await expect(revokeAgentGrant('client-123', {})).rejects.toThrow('Could not disconnect this agent right now.');
    await expect(
      revokeAgentGrant('client-123', {
        auth: { oauth: { revokeGrant: async () => ({ data: null, error: new Error('forbidden') }) } },
      }),
    ).rejects.toThrow('forbidden');
  });

  it('supports listing and revoking preview grants in mockSupabase', async () => {
    const mock = createMockClient();
    const initial = await listAgentGrants(mock as unknown as Parameters<typeof listAgentGrants>[0]);
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ clientId: 'preview-claude', name: 'Claude', host: 'claude.ai' });

    await revokeAgentGrant('preview-claude', mock as unknown as Parameters<typeof revokeAgentGrant>[1]);
    const after = await listAgentGrants(mock as unknown as Parameters<typeof listAgentGrants>[0]);
    expect(after).toEqual([]);
  });
});
