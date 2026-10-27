// What You and History say about the WHOOP connection, shared by the web and
// native apps.
import { formatDistanceStrict } from 'date-fns';

import type { WhoopSyncResult } from '@/lib/whoopSync';
import type { WhoopConnection } from '@/types';

/** "synced 5 minutes ago" or "never synced". */
export function whoopSyncedLabel(
  connection: Pick<WhoopConnection, 'last_synced_at'>,
  now: Date = new Date(),
): string {
  if (!connection.last_synced_at) return 'never synced';
  const syncedAt = new Date(connection.last_synced_at);
  if (!Number.isFinite(syncedAt.getTime())) return 'never synced';
  // A clock a little behind the server still reads as just now.
  if (syncedAt.getTime() >= now.getTime()) return 'synced just now';
  return `synced ${formatDistanceStrict(syncedAt, now, { addSuffix: true })}`;
}

/** The result of a manual sync, or why there is none. */
export function whoopSyncMessage(result: Pick<WhoopSyncResult, 'created' | 'updated'> | null): string {
  if (!result) return 'Sync unavailable';
  return result.created + result.updated > 0 ? `${result.created} new · ${result.updated} updated` : 'Up to date';
}

/**
 * WHOOP's consent screen returns to `…settings?whoop=connected` or
 * `?whoop=error`; anything else counts as a failed connection.
 */
export function whoopCallbackStatus(callbackUrl: string): 'connected' | 'error' {
  try {
    return new URL(callbackUrl).searchParams.get('whoop') === 'connected' ? 'connected' : 'error';
  } catch {
    return 'error';
  }
}
