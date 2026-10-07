/**
 * Private beta access. The server is the real gate: row-level security and the
 * Edge Functions refuse accounts without a row in public.approved_users, and a
 * database trigger refuses sign-ups whose email has no beta invite. This module
 * only decides which screen to show, so an unapproved account sees a friendly
 * explanation instead of an empty or broken app.
 */

export type BetaAccess = 'unknown' | 'approved' | 'not-approved';

export const PRIVATE_BETA_TITLE = 'hyPer is in private beta';
export const PRIVATE_BETA_MESSAGE =
  'This account hasn’t been approved yet. hyPer is invite-only while we test it with a small group. Ask the hyPer team for an invite, then sign in again.';
export const SIGNUP_PRIVATE_BETA_MESSAGE =
  'hyPer is in private beta, so new accounts are invite-only. If you were invited, use the exact email address the invite was sent to.';

interface ApprovalQueryResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

// PostgREST reports a table that does not exist yet (migration not applied).
const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);

/**
 * `readOwnApproval` reads the caller's own approved_users row, e.g.
 * `supabase.from('approved_users').select('user_id').eq('user_id', id).maybeSingle()`.
 * RLS only ever returns the caller's own row.
 */
export async function fetchBetaAccess(readOwnApproval: () => PromiseLike<ApprovalQueryResult>): Promise<BetaAccess> {
  try {
    const { data, error } = await readOwnApproval();
    if (error) {
      // Before the migration runs there is no gate at all, so keep the app open.
      if (error.code && MISSING_TABLE_CODES.has(error.code)) return 'approved';
      // Offline or a transient failure: do not lock anyone out; the server
      // still enforces access on every request.
      return 'unknown';
    }
    return data ? 'approved' : 'not-approved';
  } catch {
    return 'unknown';
  }
}

/**
 * Sign-up refusals from the invite trigger or from disabled sign-ups arrive as
 * generic Supabase Auth errors. Translate them into the private-beta message.
 */
export function friendlyAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('database error saving new user')
    || normalized.includes('signups not allowed')
    || normalized.includes('signup is disabled')
    || normalized.includes('signup_disabled')
    || normalized.includes('not invited')
    || normalized.includes('private beta')
  ) {
    return SIGNUP_PRIVATE_BETA_MESSAGE;
  }
  return message;
}
