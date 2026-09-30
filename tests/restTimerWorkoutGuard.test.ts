import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifications = vi.hoisted(() => ({ cancelRestEndNotification: vi.fn(async () => {}) }));
vi.mock('@/lib/restNotifications', () => notifications);
const liveActivity = vi.hoisted(() => ({ endWorkoutActivity: vi.fn(), syncWorkoutActivityRest: vi.fn() }));
vi.mock('@/lib/liveActivity', () => liveActivity);

import { createRestTimerSession, readRestTimerSession, saveRestTimerSession } from '@/lib/restTimer';
import { watchRestTimerSignOut, watchRestTimerWorkoutEnd } from '@/lib/restTimerWorkoutGuard';

type State = { currentWorkout: { id: string } | null };

function createStore<State>(initial: State) {
  let state = initial;
  const listeners = new Set<(next: State) => void>();
  return {
    getState: () => state,
    subscribe: (listener: (next: State) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: State) {
      state = next;
      listeners.forEach((listener) => listener(next));
    },
  };
}

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
}

describe('watchRestTimerWorkoutEnd', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: createMemoryStorage() });
  });

  it('leaves a restored rest alone on the cold-start null → workout transition', () => {
    saveRestTimerSession(createRestTimerSession('workout-1', 90));
    const store = createStore<State>({ currentWorkout: null });
    watchRestTimerWorkoutEnd(store);

    store.set({ currentWorkout: { id: 'workout-1' } });
    store.set({ currentWorkout: { id: 'workout-1' } });

    expect(readRestTimerSession()?.workoutId).toBe('workout-1');
    expect(notifications.cancelRestEndNotification).not.toHaveBeenCalled();
    expect(liveActivity.syncWorkoutActivityRest).not.toHaveBeenCalled();
    expect(liveActivity.endWorkoutActivity).not.toHaveBeenCalled();
  });

  it('clears and cancels when the resting workout goes away', () => {
    saveRestTimerSession(createRestTimerSession('workout-1', 90));
    const store = createStore<State>({ currentWorkout: { id: 'workout-1' } });
    watchRestTimerWorkoutEnd(store);

    store.set({ currentWorkout: null });

    expect(readRestTimerSession()).toBeNull();
    expect(notifications.cancelRestEndNotification).toHaveBeenCalledTimes(1);
    expect(liveActivity.syncWorkoutActivityRest).toHaveBeenCalledWith(null);
    expect(liveActivity.endWorkoutActivity).toHaveBeenCalledTimes(1);
  });

  it('drops the lock-screen rest but keeps the card when another workout takes over', () => {
    saveRestTimerSession(createRestTimerSession('workout-1', 90));
    const store = createStore<State>({ currentWorkout: { id: 'workout-1' } });
    watchRestTimerWorkoutEnd(store);

    store.set({ currentWorkout: { id: 'workout-2' } });

    expect(readRestTimerSession()).toBeNull();
    expect(notifications.cancelRestEndNotification).toHaveBeenCalledTimes(1);
    expect(liveActivity.syncWorkoutActivityRest).toHaveBeenCalledWith(null);
    expect(liveActivity.endWorkoutActivity).not.toHaveBeenCalled();
  });

  it('ignores the end of a workout that does not own the stored rest', () => {
    saveRestTimerSession(createRestTimerSession('workout-2', 90));
    const store = createStore<State>({ currentWorkout: null });
    const stop = watchRestTimerWorkoutEnd(store);

    store.set({ currentWorkout: { id: 'workout-1' } });
    store.set({ currentWorkout: null });

    expect(readRestTimerSession()?.workoutId).toBe('workout-2');
    expect(notifications.cancelRestEndNotification).not.toHaveBeenCalled();
    expect(liveActivity.syncWorkoutActivityRest).not.toHaveBeenCalled();
    // The workout that ended still takes its own card down.
    expect(liveActivity.endWorkoutActivity).toHaveBeenCalledTimes(1);

    stop();
    saveRestTimerSession(createRestTimerSession('workout-3', 90));
    store.set({ currentWorkout: { id: 'workout-3' } });
    store.set({ currentWorkout: null });
    expect(readRestTimerSession()?.workoutId).toBe('workout-3');
  });
});

describe('watchRestTimerSignOut', () => {
  type AuthState = { user: { id: string } | null };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: createMemoryStorage() });
  });

  it('clears the rest and takes the card down when the user signs out', () => {
    saveRestTimerSession(createRestTimerSession('workout-1', 90));
    const store = createStore<AuthState>({ user: { id: 'user-1' } });
    watchRestTimerSignOut(store);

    store.set({ user: { id: 'user-1' } });
    expect(readRestTimerSession()?.workoutId).toBe('workout-1');
    expect(notifications.cancelRestEndNotification).not.toHaveBeenCalled();

    store.set({ user: null });

    expect(readRestTimerSession()).toBeNull();
    expect(notifications.cancelRestEndNotification).toHaveBeenCalledTimes(1);
    expect(liveActivity.endWorkoutActivity).toHaveBeenCalledTimes(1);
  });

  it('leaves a restored rest alone while the session is being restored', () => {
    saveRestTimerSession(createRestTimerSession('workout-1', 90));
    const store = createStore<AuthState>({ user: null });
    watchRestTimerSignOut(store);

    store.set({ user: null });
    store.set({ user: { id: 'user-1' } });

    expect(readRestTimerSession()?.workoutId).toBe('workout-1');
    expect(notifications.cancelRestEndNotification).not.toHaveBeenCalled();
    expect(liveActivity.endWorkoutActivity).not.toHaveBeenCalled();
  });
});
