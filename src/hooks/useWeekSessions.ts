import { useEffect, useState } from 'react';
import { readWeekSessionDates } from '@/lib/weekSessions';

/**
 * Completed sessions this training week, for Today's week figures. `dates`
 * is null until the first read lands (or after a failed read), so the screen
 * can leave the figure out instead of showing a wrong zero.
 */
export function useWeekSessions(userId: string | undefined, dayKey: string, refreshKey: unknown): string[] | null {
  const [result, setResult] = useState<{ key: string; dates: string[] } | null>(null);
  const key = `${userId}:${dayKey}`;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    readWeekSessionDates(userId, dayKey)
      .then((dates) => { if (!cancelled) setResult({ key: `${userId}:${dayKey}`, dates }); })
      .catch((error: unknown) => { console.error('Error loading this week’s sessions:', error); });
    return () => { cancelled = true; };
  }, [userId, dayKey, refreshKey]);
  return result?.key === key ? result.dates : null;
}
