import { withTimeout } from '@/lib/withTimeout';

/**
 * Private beta. The server is the gate: row-level security and the paid Edge
 * Functions refuse accounts that are not in public.approved_users, and a
 * database trigger refuses sign-ups whose email has no invite. This only
 * decides whether the app shows the "not on the list" screen.
 *
 * Only a clear answer from the server, about this very account, ever says
 * 'not-approved'. Anything unclear (offline, slow, an error, an answer for a
 * request that went out without the sign-in) is 'unknown', and 'unknown'
 * keeps the app open: an approved person is never locked out by a bad network.
 */
export type BetaAccess = 'unknown' | 'approved' | 'not-approved';

interface AccessAnswer {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

// PostgREST's "no such function": the migration is not applied yet, so the
// server has no gate either and the app stays open.
const NO_GATE_CODES = new Set(['PGRST202', '42883']);
const CHECK_TIMEOUT_MS = 15_000;

/**
 * The account's answer in full: approval, and whether it keeps the early
 * features (WHOOP and the Mac food worker), which only the accounts from
 * before public sign-up have. `earlyAccess` is null when the answer is
 * unclear. A server from before public sign-up (no early_access field, or no
 * gate at all) only ever had the owner's own people, so they keep them.
 */
export interface AccountAccess {
  access: BetaAccess;
  earlyAccess: boolean | null;
}

/**
 * Asks the server about `userId`. `ask` calls the my_beta_access() function,
 * e.g. `() => supabase.rpc('my_beta_access')`.
 */
export async function fetchAccountAccess(userId: string, ask: () => PromiseLike<AccessAnswer>): Promise<AccountAccess> {
  const unknown: AccountAccess = { access: 'unknown', earlyAccess: null };
  try {
    const { data, error } = await withTimeout(Promise.resolve(ask()), CHECK_TIMEOUT_MS, 'Approval check timed out');
    if (error) return error.code && NO_GATE_CODES.has(error.code) ? { access: 'approved', earlyAccess: true } : unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return unknown;
    const answer = data as { user_id?: unknown; approved?: unknown; early_access?: unknown };
    // An answer for someone else, or for a request without the sign-in, says nothing about this account.
    if (answer.user_id !== userId || typeof answer.approved !== 'boolean') return unknown;
    if (!answer.approved) return { access: 'not-approved', earlyAccess: false };
    return { access: 'approved', earlyAccess: typeof answer.early_access === 'boolean' ? answer.early_access : true };
  } catch {
    return unknown;
  }
}

/** Approval alone (see fetchAccountAccess). */
export async function fetchBetaAccess(userId: string, ask: () => PromiseLike<AccessAnswer>): Promise<BetaAccess> {
  return (await fetchAccountAccess(userId, ask)).access;
}

/** Sign-ups the invite list refused, in any of the ways Supabase Auth reports them. */
export function isInviteRefusal(message: string): boolean {
  return /database error saving new user|invite-only|not invited|signups? (are |is )?not allowed|signups? (is )?disabled|signup_disabled/i.test(message);
}
