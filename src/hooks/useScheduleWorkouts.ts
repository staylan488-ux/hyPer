import { useCallback, useEffect, useState } from 'react';
import { loadScheduleWorkouts, type PlanSchedule, type ScheduleWorkout } from '@/lib/planSchedule';
import type { Split, Workout } from '@/types';

const emptyWorkouts: ScheduleWorkout[] = [];

/** Shared completion inputs for Today and the calendar; refresh after finishing. */
export function useScheduleWorkouts(userId: string | null | undefined, split: Split | null, schedule: PlanSchedule | null, currentWorkout: Workout | null) {
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const key = JSON.stringify([userId, split?.days.map((day) => day.id), schedule, currentWorkout?.id, currentWorkout?.completed, revision]);
  const [result, setResult] = useState<{ key: string; workouts: ScheduleWorkout[]; error: boolean } | null>(null);
  useEffect(() => {
    if (!userId || !split || !schedule) return;
    let cancelled = false;
    void loadScheduleWorkouts(userId, split.days, schedule)
      .then((workouts) => { if (!cancelled) setResult({ key, workouts, error: false }); })
      .catch((error: unknown) => {
        console.error('Error loading schedule completions:', error);
        if (!cancelled) setResult({ key, workouts: [], error: true });
      });
    return () => { cancelled = true; };
  }, [userId, split, schedule, key]);
  const enabled = Boolean(userId && split && schedule);
  const current = result?.key === key ? result : null;
  return {
    workouts: enabled ? current?.workouts ?? emptyWorkouts : emptyWorkouts,
    loading: enabled && !current,
    error: enabled && Boolean(current?.error),
    retry,
  };
}
