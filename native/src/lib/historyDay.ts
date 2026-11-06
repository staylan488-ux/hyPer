// The chosen day's list in History: its workouts and activities as one log,
// in the order they happened.
import { getWorkoutStartDate } from '@/lib/workoutSessions';
import type { ActivitySession, Workout } from '@/types';

export type DayEntry<W, A> = { kind: 'workout'; workout: W } | { kind: 'activity'; activity: A };

const time = (value?: string | null) => {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
};

/** When an activity started, as History has always sorted them: its start, else when it was saved, else its day. */
const activityTime = (activity: Pick<ActivitySession, 'started_at' | 'created_at' | 'date'>) =>
  time(activity.started_at) ?? time(activity.created_at) ?? time(`${activity.date}T00:00:00`) ?? 0;

/**
 * One day's workouts and activities together, earliest first, as a day's log
 * reads. The workout running now (`liveWorkoutId`) leads, since it is what
 * the person is doing; a workout and an activity at the same minute keep the
 * workout first.
 */
export function dayEntries<W extends Pick<Workout, 'id' | 'created_at' | 'date'>, A extends Pick<ActivitySession, 'started_at' | 'created_at' | 'date'>>(
  workouts: readonly W[],
  activities: readonly A[],
  liveWorkoutId?: string | null,
): DayEntry<W, A>[] {
  const timed = [
    ...workouts.map((workout) => ({
      entry: { kind: 'workout', workout } as DayEntry<W, A>,
      at: getWorkoutStartDate(workout)?.getTime() ?? 0,
      live: Boolean(liveWorkoutId) && workout.id === liveWorkoutId,
    })),
    ...activities.map((activity) => ({ entry: { kind: 'activity', activity } as DayEntry<W, A>, at: activityTime(activity), live: false })),
  ];
  // Array sort is stable: equal times keep workouts before activities.
  return timed.sort((a, b) => Number(b.live) - Number(a.live) || a.at - b.at).map(({ entry }) => entry);
}
