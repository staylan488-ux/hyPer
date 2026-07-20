export const WHOOP_AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1_000;

export function shouldAttemptWhoopAutoSync(
  nowMs: number,
  lastAttemptMs: number | undefined,
  lastSyncedAt: string | null | undefined,
): boolean {
  if (lastAttemptMs != null && nowMs - lastAttemptMs < WHOOP_AUTO_SYNC_INTERVAL_MS) return false;
  const lastSyncedMs = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
  return !Number.isFinite(lastSyncedMs) || nowMs - lastSyncedMs >= WHOOP_AUTO_SYNC_INTERVAL_MS;
}

