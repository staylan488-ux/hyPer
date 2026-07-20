import { useEffect } from 'react';

import { useAppStore } from '@/stores/appStore';
import { shouldAttemptWhoopAutoSync } from '@/lib/whoopForegroundSync';

const lastAttemptByUser = new Map<string, number>();

export function useWhoopForegroundSync(userId: string | undefined): void {
  const fetchWhoopConnection = useAppStore((state) => state.fetchWhoopConnection);
  const syncWhoop = useAppStore((state) => state.syncWhoop);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let syncing = false;

    const reconcile = async () => {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        const connection = await fetchWhoopConnection();
        const nowMs = Date.now();
        if (
          connection
          && shouldAttemptWhoopAutoSync(
            nowMs,
            lastAttemptByUser.get(userId),
            connection.last_synced_at,
          )
        ) {
          lastAttemptByUser.set(userId, nowMs);
          await syncWhoop();
        }
      } finally {
        syncing = false;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };

    void reconcile();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchWhoopConnection, syncWhoop, userId]);
}
