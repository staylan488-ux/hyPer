import { useEffect, useMemo, useState } from 'react';
import { loadPlanSchedule, loadWithBackgroundSync, type PlanSchedule } from '@/lib/planSchedule';

export function usePlanSchedule(userId: string | undefined, splitId: string | undefined) {
  const key = `${userId}:${splitId}`;
  const cached = useMemo(() => userId && splitId ? loadPlanSchedule(userId, splitId) : null, [userId, splitId]);
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
    loading: Boolean(userId && splitId && result?.key !== key),
  };
}
