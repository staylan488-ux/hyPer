/**
 * Segment ingestion and calendar reconciliation are separate writes. Keep the
 * earliest unfinished reconciliation window independently of the newest
 * imported segment, which is only a fetch watermark.
 */
export interface WhoopReconciliationCheckpoint {
  pendingFromIso: string | null;
  historyReconciled: boolean;
}

const keyFor = (userId: string) => `hyper:whoop-reconciliation:v1:${userId}`;

export function readWhoopReconciliation(userId: string): WhoopReconciliationCheckpoint {
  const raw = localStorage.getItem(keyFor(userId));
  if (!raw) return { pendingFromIso: null, historyReconciled: false };
  try {
    const value = JSON.parse(raw) as Partial<WhoopReconciliationCheckpoint>;
    if (value.pendingFromIso != null && !Number.isFinite(Date.parse(value.pendingFromIso))) {
      return { pendingFromIso: null, historyReconciled: false };
    }
    return {
      pendingFromIso: value.pendingFromIso ?? null,
      historyReconciled: value.historyReconciled === true,
    };
  } catch {
    // An unreadable checkpoint requires the same historical repair as a new
    // installation. A storage access error above still stops the sync.
    return { pendingFromIso: null, historyReconciled: false };
  }
}

export function beginWhoopReconciliation(
  userId: string,
  checkpoint: WhoopReconciliationCheckpoint,
  fromIso: string,
): string {
  const pendingFromIso = checkpoint.pendingFromIso
    && Date.parse(checkpoint.pendingFromIso) < Date.parse(fromIso)
    ? checkpoint.pendingFromIso : fromIso;
  // Must succeed BEFORE ingesting segments. Without a durable checkpoint a
  // partial import could advance the fetch watermark past unfinished work.
  localStorage.setItem(keyFor(userId), JSON.stringify({ ...checkpoint, pendingFromIso }));
  return pendingFromIso;
}

export function completeWhoopReconciliation(userId: string): void {
  localStorage.setItem(keyFor(userId), JSON.stringify({ pendingFromIso: null, historyReconciled: true }));
}
