// Private beta gate for the Edge Functions that spend hyPer's API keys or hold
// third-party tokens. An account may use them only with a row in
// public.approved_users (supabase/migrations/20261109120000_private_beta_and_ai_caps.sql).
// delete-account and WHOOP disconnect deliberately skip it, so an account that
// is not approved can still leave and revoke its tokens.

export const NOT_APPROVED_MESSAGE = 'hyPer is invite-only, and this account isn’t on the list yet.';

/** The 403 body every gated function sends. The app keys off `code`. */
export const NOT_APPROVED = { code: 'not_approved', error: NOT_APPROVED_MESSAGE } as const;

/** The slice of a supabase-js client this needs (any version). */
interface ApprovalClient {
  from(table: 'approved_users'): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

/**
 * True only when the account has an approved_users row. Pass a service-role
 * client: clients have no access to the table. Throws when the lookup fails,
 * so every caller fails closed.
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

/**
 * The refusal to send, or null when the account may go on: 403 when it is not
 * approved, 503 when approval could not be checked (never let it through).
 */
export async function approvalRefusal(
  client: unknown,
  userId: string,
  unavailable: string,
): Promise<{ status: 403 | 503; body: Record<string, string> } | null> {
  try {
    return await isApprovedUser(client, userId) ? null : { status: 403, body: { ...NOT_APPROVED } };
  } catch {
    return { status: 503, body: { error: unavailable } };
  }
}
