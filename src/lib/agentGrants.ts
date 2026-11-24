// Connected AI agents (OAuth 2.1 grants for hyPer's remote MCP server).
// Pure formatting and Supabase Auth OAuth grant helpers shared across native and tests.
import { format } from 'date-fns';

import { supabase } from '@/lib/supabase';

/** The remote MCP endpoint users paste into Claude, ChatGPT or another MCP app. */
export const MCP_SERVER_URL = 'https://mcp.thehyper.app';
export const MCP_SERVER_HOST = 'mcp.thehyper.app';

export interface AgentGrant {
  clientId: string;
  name: string;
  host: string | null;
  grantedAt: string;
}

export interface OAuthGrantLike {
  client?: {
    id?: string | null;
    name?: string | null;
    uri?: string | null;
  } | null;
  granted_at?: string | null;
}

type OAuthClientLike = {
  auth?: {
    oauth?: {
      listGrants?: () => Promise<{ data: OAuthGrantLike[] | null; error: unknown }>;
      revokeGrant?: (options: { clientId: string }) => Promise<{ data: unknown; error: unknown }>;
    };
  };
};

/** Clean host from a client URI (e.g. "https://www.claude.ai/..." -> "claude.ai"), or null. */
export function agentHost(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const parsed = new URL(uri.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.host.replace(/^www\./i, '').trim();
    return host || null;
  } catch {
    return null;
  }
}

/** Normalizes a raw Supabase OAuth grant into the shape Connections displays. */
export function normalizeAgentGrant(raw: OAuthGrantLike | null | undefined): AgentGrant | null {
  const clientId = raw?.client?.id?.trim() ?? '';
  if (!clientId) return null;
  const host = agentHost(raw?.client?.uri);
  const name = raw?.client?.name?.trim() || host || 'Connected agent';
  const grantedAt = typeof raw?.granted_at === 'string' ? raw.granted_at : '';
  return { clientId, name, host, grantedAt };
}

function grantTimeMs(grantedAt: string): number {
  const parsed = Date.parse(grantedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Deduplicates by clientId (newest wins) and sorts newest-connected first, then by name. */
export function sortAgentGrants(grants: readonly AgentGrant[]): AgentGrant[] {
  const byId = new Map<string, AgentGrant>();
  for (const grant of grants) {
    const existing = byId.get(grant.clientId);
    if (!existing || grantTimeMs(grant.grantedAt) > grantTimeMs(existing.grantedAt)) {
      byId.set(grant.clientId, grant);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const timeDiff = grantTimeMs(b.grantedAt) - grantTimeMs(a.grantedAt);
    if (timeDiff !== 0) return timeDiff;
    return a.name.localeCompare(b.name);
  });
}

/**
 * "Connected today", "Connected Nov 23", or "Connected Nov 23, 2025" before this year.
 * Takes `todayKey` ('yyyy-MM-dd') so React Compiler memoization stays accurate past midnight.
 */
export function agentConnectedLabel(grantedAt: string, todayKey: string): string {
  const date = new Date(grantedAt);
  if (!Number.isFinite(date.getTime())) return 'Connected';
  const day = format(date, 'yyyy-MM-dd');
  if (day === todayKey) return 'Connected today';
  return `Connected ${format(date, day.slice(0, 4) === todayKey.slice(0, 4) ? 'MMM d' : 'MMM d, yyyy')}`;
}

/** Quiet subtitle for a connected agent row, keeping the date intact if the host truncates. */
export function agentDetail(
  grant: Pick<AgentGrant, 'name' | 'host' | 'grantedAt'>,
  todayKey: string,
): string | readonly [string, string] {
  const connected = agentConnectedLabel(grant.grantedAt, todayKey);
  if (grant.host && grant.host.toLowerCase() !== grant.name.trim().toLowerCase()) {
    return [grant.host, connected] as const;
  }
  return connected;
}

/** Quiet summary value for You's Connections row (undefined when nothing is connected). */
export function connectionsSummaryLabel({
  whoop,
  health,
  agents,
}: {
  whoop: boolean;
  health: boolean;
  agents: readonly AgentGrant[] | null;
}): string | undefined {
  const agentPart = !agents || agents.length === 0
    ? null
    : agents.length === 1
      ? agents[0].name
      : `${agents.length} agents`;
  const parts = [agentPart, whoop ? 'WHOOP' : null, health ? 'Health' : null].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** Lists every OAuth agent grant authorized by the signed-in user, newest first. */
export async function listAgentGrants(
  client: OAuthClientLike = supabase as unknown as OAuthClientLike,
): Promise<AgentGrant[]> {
  const oauth = client.auth?.oauth;
  if (typeof oauth?.listGrants !== 'function') return [];
  const { data, error } = await oauth.listGrants();
  if (error) throw error;
  const normalized = (data ?? [])
    .map((grant) => normalizeAgentGrant(grant))
    .filter((grant): grant is AgentGrant => grant !== null);
  return sortAgentGrants(normalized);
}

/** Revokes a connected OAuth agent's grant and active sessions. */
export async function revokeAgentGrant(
  clientId: string,
  client: OAuthClientLike = supabase as unknown as OAuthClientLike,
): Promise<void> {
  const oauth = client.auth?.oauth;
  if (typeof oauth?.revokeGrant !== 'function') {
    throw new Error('Could not disconnect this agent right now.');
  }
  const { error } = await oauth.revokeGrant({ clientId });
  if (error) throw error;
}
