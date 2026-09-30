import { cancelRestEndNotification } from '@/lib/restNotifications';
import { clearRestTimerSession, readRestTimerSession } from '@/lib/restTimer';

interface ActiveWorkoutStore {
  getState(): { currentWorkout: { id: string } | null };
  subscribe(listener: (state: { currentWorkout: { id: string } | null }) => void): () => void;
}

/**
 * The rest timer outlives the Train page, so a workout that ends elsewhere
 * (deleted in History, finished on another device, sign-out) must not leave a
 * "Rest over" notification armed. Reacts only when a known workout id goes
 * away: the cold-start null → id restore is left alone.
 */
export function watchRestTimerWorkoutEnd(store: ActiveWorkoutStore): () => void {
  let activeId = store.getState().currentWorkout?.id ?? null;

  return store.subscribe((state) => {
    const nextId = state.currentWorkout?.id ?? null;
    if (nextId === activeId) return;
    const endedId = activeId;
    activeId = nextId;
    if (!endedId) return;

    const stored = readRestTimerSession();
    if (stored?.workoutId !== endedId) return;
    clearRestTimerSession();
    void cancelRestEndNotification();
  });
}
