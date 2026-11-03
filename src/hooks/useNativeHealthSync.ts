import { useEffect } from 'react';

import { onAppVisible } from '@/lib/appVisibility';
import {
  isHealthWeightSyncEnabled,
  syncNativeBodyWeights,
} from '@/lib/healthWeights';
import { NativeHealth, hasNativeHealth } from '@/lib/nativeBridge';

/**
 * Keeps Apple Health weights flowing in once the person turned sync on: on
 * mount, each time Health reports new samples, and each return to the app.
 * One sync at a time; errors stay quiet (You has a manual retry).
 */
export function useNativeHealthSync(userId: string | undefined): void {
  useEffect(() => {
    if (!userId || !hasNativeHealth() || !isHealthWeightSyncEnabled()) return;
    const controller = new AbortController();
    let listener: { remove: () => Promise<void> } | null = null;
    let syncing = false;

    const sync = async () => {
      if (controller.signal.aborted || syncing) return;
      syncing = true;
      try {
        await syncNativeBodyWeights(userId, controller.signal);
      } catch {
        // Settings exposes a manual retry. Background reconciliation is best effort.
      } finally {
        syncing = false;
      }
    };

    void (async () => {
      try {
        await NativeHealth.enableWeightUpdates();
        if (controller.signal.aborted) return;
        listener = await NativeHealth.addListener('weightSamplesChanged', () => void sync());
        // Unmounted while the listener was being added: drop it at once.
        if (controller.signal.aborted) void listener.remove();
      } catch {
        // Foreground reconciliation below still runs.
      }
      await sync();
    })();
    const stopWatching = onAppVisible(() => void sync());

    return () => {
      controller.abort();
      stopWatching();
      void listener?.remove();
    };
  }, [userId]);
}
