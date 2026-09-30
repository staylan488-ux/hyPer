import { endWorkoutActivity, syncWorkoutActivityRest } from '@/lib/liveActivity';
import { cancelRestEndNotification } from '@/lib/restNotifications';
import { clearRestTimerSession, readRestTimerSession } from '@/lib/restTimer';

interface ActiveWorkoutStore {
  getState(): { currentWorkout: { id: string } | null };
  subscribe(listener: (state: { currentWorkout: { id: string } | null }) => void): () => void;
}

interface SignedInUserStore {
  getState(): { user: { id: string } | null };
  subscribe(listener: (state: { user: { id: string } | null }) => void): () => void;
}

/**
 * The rest timer outlives the Train page, so a workout that ends elsewhere
 * (deleted in History, finished on another device) must not leave a
 * "Rest over" notification or lock-screen countdown armed. Reacts only when a
 * known workout id goes away: the cold-start null → id restore is left alone.
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
    if (stored?.workoutId === endedId) {
      clearRestTimerSession();
      void cancelRestEndNotification();
      syncWorkoutActivityRest(null);
    }
    // No workout left: take the card down, as the Train page does on return.
    if (!nextId) endWorkoutActivity();
  });
}

/**
 * Signing out keeps the workout store as is, so the watcher above never sees
 * it. A signed-out device must not chime "Rest over" or keep the card up.
 */
export function watchRestTimerSignOut(store: SignedInUserStore): () => void {
  let signedIn = store.getState().user !== null;

  return store.subscribe((state) => {
    const nextSignedIn = state.user !== null;
    if (nextSignedIn === signedIn) return;
    signedIn = nextSignedIn;
    if (nextSignedIn) return;

    clearRestTimerSession();
    void cancelRestEndNotification();
    endWorkoutActivity();
  });
}
