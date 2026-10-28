import { useEffect, useMemo, useState } from 'react';
import { loadPlanSchedule, loadWithBackgroundSync, type PlanSchedule } from '@/lib/planSchedule';

/**
 * The saved plan schedule: the device copy at once, then the cloud copy when
 * newer. A new `revision` re-reads it, for screens that save it elsewhere.
 */
export function usePlanSchedule(userId: string | undefined, splitId: string | undefined, revision = 0) {
  const key = `${userId}:${splitId}:${revision}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision forces a fresh read of the device copy
  const cached = useMemo(() => userId && splitId ? loadPlanSchedule(userId, splitId) : null, [userId, splitId, revision]);
  const [result, setResult] = useState<{ key: string; schedule: PlanSchedule | null } | null>(null);
  useEffect(() => {
    if (!userId || !splitId) return;
    let cancelled = false;
    let latest = cached;
    const sync = loadWithBackgroundSync(userId, splitId, (schedule) => { latest = schedule; });
    void sync.done.then(() => { if (!cancelled) setResult({ key, schedule: latest }); });
    return () => { cancelled = true; sync.cancel(); };
  }, [userId, splitId, key, cached]);
  return {
    schedule: result?.key === key ? result.schedule : cached,
    // A re-read after a save on this device shows the saved copy at once.
    loading: Boolean(userId && splitId && result?.key !== key && !(revision > 0 && cached)),
  };
}
