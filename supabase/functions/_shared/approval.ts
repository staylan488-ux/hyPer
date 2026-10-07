// Private beta gate shared by the Edge Functions that spend hyPer's API keys.
// An account may use them only when it has a row in public.approved_users
// (see supabase/migrations/20261007120000_private_beta_and_ai_caps.sql).

export const PRIVATE_BETA_ERROR = {
  code: 'not_approved',
  error: 'hyPer is in private beta and this account has not been approved yet. Ask the hyPer team for an invite.',
} as const;

interface ApprovalQueryResult {
  data: unknown;
  error: unknown;
}

/** Any supabase-js client: service role, or the caller's own JWT client. */
interface ApprovalClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<ApprovalQueryResult>;
      };
    };
  };
}

/**
 * True only when the user has an approved_users row. Works with a service-role
 * client or with the caller's own JWT client (RLS lets a user read their own
 * row). Throws on lookup failure so callers fail closed.
 */
export async function isApprovedUser(client: unknown, userId: string): Promise<boolean> {
  const { data, error } = await (client as ApprovalClient)
    .from('approved_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('Approval check failed');
  return Boolean(data);
}
