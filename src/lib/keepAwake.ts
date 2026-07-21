import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';

/**
 * Hold the screen awake while `active` (native app only — chalky gym hands
 * shouldn't have to fight auto-lock mid-set). The web app keeps its existing
 * wake-lock inside RestTimerPill; this covers the whole live workout in the
 * iOS app. Balanced: released on unmount or when `active` goes false.
 */
export function useKeepAwakeWhile(active: boolean): void {
  useEffect(() => {
    if (!active || !Capacitor.isNativePlatform()) return;

    void KeepAwake.keepAwake().catch(() => {});

    return () => {
      void KeepAwake.allowSleep().catch(() => {});
    };
  }, [active]);
}
