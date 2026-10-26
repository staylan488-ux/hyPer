// Replaces ../src/lib/keepAwake.ts (see metro.config.js): hold the screen awake
// while `active`, so a live workout never locks mid-set. Each caller holds its
// own tag, so one releasing does not let the screen sleep under another.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useId } from 'react';

export function useKeepAwakeWhile(active: boolean): void {
  const tag = `hyper-${useId()}`;
  useEffect(() => {
    if (!active) return;
    void activateKeepAwakeAsync(tag).catch(() => {});
    return () => {
      void deactivateKeepAwake(tag).catch(() => {});
    };
  }, [active, tag]);
}
