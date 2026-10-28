// Apple Health weight sync carries over at cutover.
//
// The Capacitor app kept "sync is on" in its web view's storage, which this app
// cannot read. HealthKit's permission does carry over with the bundle ID, so
// the released app turns sync back on once, the first time it runs, for an
// account that already has weights from Apple Health. Nothing is asked: if the
// permission is gone, the sync simply finds nothing.
import { useEffect, useState } from 'react';

import { isHealthWeightSyncEnabled, setHealthWeightSyncEnabled } from '@/lib/healthWeightCore';
import { supabase } from '@/lib/supabase';

import { runningBundleIdentifier } from '../../modules/hyper-keychain/bundle';

const CHECKED_KEY = 'hyper:health-carry-over-checked';
const RELEASED_APP = runningBundleIdentifier() === 'app.hyper.mobile';

/** True once Health sync may start (after the one-time check, if one is due). */
export function useHealthCarryOver(userId: string | undefined): boolean {
  const [ready, setReady] = useState(() => !RELEASED_APP || readChecked());
  useEffect(() => {
    if (ready || !userId) return;
    let current = true;
    void (async () => {
      try {
        if (!isHealthWeightSyncEnabled()) {
          const { data, error } = await supabase
            .from('body_weight_measurements')
            .select('id')
            .eq('user_id', userId)
            .eq('source', 'apple_health')
            .limit(1);
          if (error) return; // try again next launch
          if ((data ?? []).length > 0) setHealthWeightSyncEnabled(true);
        }
        localStorage.setItem(CHECKED_KEY, '1');
      } catch {
        // next launch
      } finally {
        if (current) setReady(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [ready, userId]);
  return ready;
}

function readChecked(): boolean {
  try {
    return localStorage.getItem(CHECKED_KEY) === '1';
  } catch {
    return false;
  }
}
