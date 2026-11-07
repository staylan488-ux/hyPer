import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkoutActivitySync } from '@/lib/workoutActivitySync';

// The order the workout's Live Activity calls reach iOS in. The app runs these
// rules over its own module (native/src/platform/liveActivity.ts).

type Deferred = { resolve: () => void; reject: (error: Error) => void };

const native = vi.hoisted(() => {
  const calls: { method: 'sync' | 'end'; options?: { detailLine: string; restEndsAtEpochMs?: number } }[] = [];
  const pending: Deferred[] = [];
  const call = (method: 'sync' | 'end', options?: { detailLine: string; restEndsAtEpochMs?: number }) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ method, options });
      pending.push({ resolve, reject });
    });
  return {
    calls,
    pending,
    plugin: {
      sync: vi.fn((options: { detailLine: string; restEndsAtEpochMs?: number }) => call('sync', options)),
      end: vi.fn(() => call('end')),
    },
  };
});

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const session = (detailLine: string) => ({ exerciseName: 'Bench Press', detailLine, sessionStartedAtEpochMs: 1 });

function loadModule() {
  return createWorkoutActivitySync(native.plugin);
}

describe('workout Live Activity ordering', () => {
  beforeEach(() => {
    native.calls.length = 0;
    native.pending.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the newest snapshot last when syncs arrive quickly', async () => {
    const activity = loadModule();
    activity.syncWorkoutActivity(session('set 1'));
    await flush();
    activity.syncWorkoutActivity(session('set 2 (stale)'));
    activity.syncWorkoutActivity(session('set 2'));
    native.pending[0].resolve();
    await flush();

    expect(native.calls.map((call) => call.options?.detailLine)).toEqual(['set 1', 'set 2']);
  });

  it('never sends a sync after end()', async () => {
    const activity = loadModule();
    activity.syncWorkoutActivity(session('set 3'));
    await flush();
    // The rest is cleared, then the workout ends the card.
    activity.syncWorkoutActivityRest(null);
    activity.endWorkoutActivity();
    native.pending[0].resolve();
    await flush();
    native.pending[1]?.resolve();
    await flush();

    expect(native.calls.map((call) => call.method)).toEqual(['sync', 'end']);
  });

  it('keeps going after a rejected sync', async () => {
    const activity = loadModule();
    activity.syncWorkoutActivity(session('set 1'));
    await flush();
    native.pending[0].reject(new Error('ActivityKit unavailable'));
    await flush();
    activity.endWorkoutActivity();
    await flush();

    expect(native.calls.map((call) => call.method)).toEqual(['sync', 'end']);
  });

  it('collapses syncs made during an in-flight call into one follow-up with the latest state', async () => {
    const activity = loadModule();
    activity.syncWorkoutActivity(session('set 1'));
    await flush();
    activity.syncWorkoutActivity(session('set 2'));
    activity.syncWorkoutActivityRest({ startedAtIso: new Date().toISOString(), endsAtIso: new Date(Date.now() + 90_000).toISOString() });
    activity.syncWorkoutActivity(session('set 2 · 1 of 6 sets'));
    await flush();
    expect(native.calls).toHaveLength(1);

    native.pending[0].resolve();
    await flush();
    expect(native.calls).toHaveLength(2);
    expect(native.calls[1].options?.detailLine).toBe('set 2 · 1 of 6 sets');
    expect(native.calls[1].options?.restEndsAtEpochMs).toBeGreaterThan(Date.now());
  });

  it('does not let a native call that never settles freeze later updates', async () => {
    vi.useFakeTimers();
    const activity = loadModule();
    activity.syncWorkoutActivity(session('set 1'));
    await flush();
    activity.endWorkoutActivity();
    await flush();
    expect(native.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(native.calls.map((call) => call.method)).toEqual(['sync', 'end']);
  });
});
