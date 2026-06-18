import { describe, expect, it } from 'vitest';

import {
  clearRestTimerSession,
  createRestTimerSession,
  getRestTimerRemainingSeconds,
  parseRestInput,
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

describe('parseRestInput', () => {
  it('parses m:ss strings', () => {
    expect(parseRestInput('4:30')).toBe(270);
    expect(parseRestInput('0:30')).toBe(30);
    expect(parseRestInput('10:00')).toBe(600);
    expect(parseRestInput('60:00')).toBe(3600);
  });

  it('parses bare numbers as whole minutes', () => {
    expect(parseRestInput('4')).toBe(240);
    expect(parseRestInput('1')).toBe(60);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseRestInput('  2:15 ')).toBe(135);
  });

  it('rejects invalid seconds, out-of-range values, and junk', () => {
    expect(parseRestInput('4:60')).toBeNull(); // seconds must be < 60
    expect(parseRestInput('0:04')).toBeNull(); // below the 5s floor
    expect(parseRestInput('61:00')).toBeNull(); // above the 60min ceiling
    expect(parseRestInput('90')).toBeNull(); // bare 90 = 90min > ceiling
    expect(parseRestInput('')).toBeNull();
    expect(parseRestInput('abc')).toBeNull();
    expect(parseRestInput('4:3:2')).toBeNull();
  });
});
