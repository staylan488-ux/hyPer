import { useEffect } from 'react';

import {
  isHealthWeightSyncEnabled,
  syncNativeBodyWeights,
} from '@/lib/healthWeights';
import { NativeHealth, isNativeIOS } from '@/lib/nativeBridge';

export function useNativeHealthSync(userId: string | undefined): void {
  useEffect(() => {
    if (!userId || !isNativeIOS() || !isHealthWeightSyncEnabled()) return;
    let cancelled = false;
    let listener: { remove: () => Promise<void> } | null = null;
    let syncing = false;

    const sync = async () => {
      if (cancelled || syncing) return;
      syncing = true;
      try {
        await syncNativeBodyWeights(userId);
      } catch {
        // Settings exposes a manual retry. Background reconciliation is best effort.
      } finally {
        syncing = false;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void sync();
    };

    void (async () => {
      try {
        await NativeHealth.enableWeightUpdates();
        listener = await NativeHealth.addListener('weightSamplesChanged', () => void sync());
      } catch {
        // Foreground reconciliation below still runs.
      }
      await sync();
    })();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      void listener?.remove();
    };
  }, [userId]);
}

