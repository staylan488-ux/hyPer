import { describe, expect, it } from 'vitest';

import {
  clearRestTimerSession,
  createRestTimerSession,
  getRestTimerRemainingSeconds,
  pauseRestTimerSession,
  readRestTimerSession,
  resumeRestTimerSession,
  saveRestTimerSession,
  syncRestTimerSession,
} from '@/lib/restTimer';

function createMemoryStorage() {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('restTimer helpers', () => {
  it('creates and synchronizes a running timer session', () => {
    const session = createRestTimerSession('workout-1', 90, new Date('2026-03-10T12:00:00.000Z'));

    expect(session.durationSeconds).toBe(90);
    expect(getRestTimerRemainingSeconds(session, new Date('2026-03-10T12:00:30.000Z'))).toBe(60);

    const completedSession = syncRestTimerSession(session, new Date('2026-03-10T12:01:31.000Z'));
    expect(completedSession.status).toBe('completed');
    expect(getRestTimerRemainingSeconds(completedSession)).toBe(0);
  });

  it('preserves paused timers and resumes them with a fresh deadline', () => {
    const session = createRestTimerSession('workout-1', 90, new Date('2026-03-10T12:00:00.000Z'));
    const paused = pauseRestTimerSession(session, new Date('2026-03-10T12:00:20.000Z'));

    expect(paused.status).toBe('paused');
    expect(paused.remainingSeconds).toBe(70);

    const resumed = resumeRestTimerSession(paused, new Date('2026-03-10T12:01:00.000Z'));
    expect(resumed.status).toBe('running');
    expect(getRestTimerRemainingSeconds(resumed, new Date('2026-03-10T12:01:20.000Z'))).toBe(50);
  });

  it('round-trips timer state through storage', () => {
    const storage = createMemoryStorage();
    const session = createRestTimerSession('workout-1', 120, new Date('2026-03-10T12:00:00.000Z'));

    saveRestTimerSession(session, storage);
    expect(readRestTimerSession(storage)).toMatchObject({
      workoutId: 'workout-1',
      durationSeconds: 120,
      status: 'running',
    });

    clearRestTimerSession(storage);
    expect(readRestTimerSession(storage)).toBeNull();
  });
});
