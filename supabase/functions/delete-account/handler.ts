// Deletes the signed-in person's account: everything they logged and the
// sign-in itself. Kept free of Deno and network imports so tests can run it
// (index.ts wires in the real services).
//
// Order matters. The stored WHOOP and Sign in with Apple tokens are read
// first, while their rows still exist; the food analysis records are removed
// next; then the account goes, and its rows in every table go with it (each
// one cascades from auth.users through profiles, or directly from auth.users).
// WHOOP and Apple are told last, only once the account is gone: a deletion
// that failed leaves them connected for the account that is still there.
// Their revocation is best-effort; legacy Storage cleanup must succeed while
// sign-in still works so a failure can be retried without orphaning the
// saved analyses.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface DeleteAccountServices {
  /** The user id the bearer token belongs to, or null for a bad or expired token. */
  authenticate(token: string): Promise<string | null>;
  /** The stored WHOOP access token, or null when this account never connected WHOOP. */
  whoopAccess(userId: string): Promise<string | null>;
  /** Tell WHOOP to drop hyPer's access. */
  revokeWhoop(accessToken: string): Promise<void>;
  /** The Sign in with Apple refresh token kept for this account, or null. */
  appleRefreshToken?(userId: string): Promise<string | null>;
  /** Tell Apple to revoke it, which ends the account's link with hyPer in Apple's settings. */
  revokeApple?(refreshToken: string): Promise<void>;
  /** Remove the account's saved food analysis results and quota records. */
  removeFoodRecords(userId: string): Promise<void>;
  /** Delete the auth user; its data cascades. Throws when it fails. */
  deleteUser(userId: string): Promise<void>;
  log?(message: string, error?: unknown): void;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function bearer(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function createDeleteAccountHandler(services: DeleteAccountServices) {
  const log = services.log ?? (() => {});
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const token = bearer(request);
    let userId: string | null = null;
    try {
      userId = token ? await services.authenticate(token) : null;
    } catch (error) {
      log('delete-account: sign-in check failed', error);
      return json({ error: 'Could not check your sign-in. Try again.' }, 503);
    }
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    let whoopAccess: string | null = null;
    try {
      whoopAccess = await services.whoopAccess(userId);
    } catch (error) {
      log('delete-account: WHOOP token not read (continuing)', error);
    }
    let appleToken: string | null = null;
    try {
      appleToken = await services.appleRefreshToken?.(userId) ?? null;
    } catch (error) {
      log('delete-account: Apple token not read (continuing)', error);
    }
    try {
      await services.removeFoodRecords(userId);
    } catch (error) {
      log('delete-account: food analysis records not removed', error);
      return json({ error: 'Could not remove saved food analyses. Try again.' }, 503);
    }

    try {
      await services.deleteUser(userId);
    } catch (error) {
      log('delete-account: account not deleted', error);
      return json({ error: 'Could not delete the account. Try again.' }, 500);
    }
    if (whoopAccess) {
      try {
        await services.revokeWhoop(whoopAccess);
      } catch (error) {
        log('delete-account: WHOOP revoke failed (the account is deleted)', error);
      }
    }
    if (appleToken && services.revokeApple) {
      try {
        await services.revokeApple(appleToken);
      } catch (error) {
        log('delete-account: Apple revoke failed (the account is deleted)', error);
      }
    }
    return json({ ok: true }, 200);
  };
}

/** One page of a storage folder: files carry an id, subfolders don't. */
export type StorageEntry = { name: string; id: string | null };

/**
 * Every file under a storage folder, however deep. Storage lists one level
 * at a time, so this walks the subfolders (the food ledger keeps
 * <user>/<day>/{claims,results,slots}/<file>.json).
 */
export async function listFilesUnder(
  list: (prefix: string, offset: number) => Promise<StorageEntry[]>,
  prefix: string,
  pageSize = 1000,
): Promise<string[]> {
  const files: string[] = [];
  const folders = [prefix.replace(/\/+$/, '')];
  while (folders.length > 0) {
    const folder = folders.shift() as string;
    for (let offset = 0; ; offset += pageSize) {
      const page = await list(folder, offset);
      for (const entry of page) {
        const path = `${folder}/${entry.name}`;
        if (entry.id) files.push(path);
        else folders.push(path);
      }
      if (page.length < pageSize) break;
    }
  }
  return files;
}

/** Legacy writers must be stopped before cleanup. A concurrent deleter can
 * shrink any page while it is being listed, so walk the folder again and
 * require no file left (a day folder that still lists with nothing in it is
 * not a record). Never delete auth after an incomplete sweep; the signed-in
 * user can retry.
 */
export async function removeFilesUnder(
  list: (prefix: string, offset: number) => Promise<StorageEntry[]>,
  remove: (paths: string[]) => Promise<void>,
  prefix: string,
  pageSize = 1000,
): Promise<void> {
  const files = await listFilesUnder(list, prefix, pageSize);
  for (let start = 0; start < files.length; start += 100) {
    await remove(files.slice(start, start + 100));
  }
  if ((await listFilesUnder(list, prefix, pageSize)).length > 0) throw new Error('Food records remain; retry cleanup');
}
