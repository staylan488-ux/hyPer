import { useEffect, useState } from 'react';
import { readWeekSessionDates } from '@/lib/weekSessions';

export interface WeekSessions {
  /** Null until the first read lands, so the screen never shows a wrong zero. */
  dates: string[] | null;
  /** The read failed; the screen should leave the figure out rather than wait. */
  failed: boolean;
}

/** Completed sessions this training week, for Today's week figures. */
export function useWeekSessions(userId: string | undefined, dayKey: string, refreshKey: unknown): WeekSessions {
  const [result, setResult] = useState<{ key: string; dates: string[] | null; failed: boolean } | null>(null);
  const key = `${userId}:${dayKey}`;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const readKey = `${userId}:${dayKey}`;
    readWeekSessionDates(userId, dayKey)
      .then((dates) => { if (!cancelled) setResult({ key: readKey, dates, failed: false }); })
      .catch((error: unknown) => {
        console.error('Error loading this week’s sessions:', error);
        if (!cancelled) setResult((prev) => ({ key: readKey, dates: prev?.key === readKey ? prev.dates : null, failed: true }));
      });
    return () => { cancelled = true; };
  }, [userId, dayKey, refreshKey]);
  if (result?.key !== key) return { dates: null, failed: false };
  return { dates: result.dates, failed: result.failed && result.dates === null };
}
