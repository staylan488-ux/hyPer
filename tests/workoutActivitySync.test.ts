import { describe, expect, it, vi } from 'vitest';

import {
  createWorkoutActivitySync,
  workoutActivityDetailLine,
  type WorkoutActivityPayload,
} from '@/lib/workoutActivitySync';

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function bridge() {
  const synced: WorkoutActivityPayload[] = [];
  return {
    synced,
    sync: vi.fn(async (payload: WorkoutActivityPayload) => {
      synced.push(payload);
    }),
    end: vi.fn(async () => {}),
  };
}

const session = { exerciseName: 'Barbell Row', detailLine: 'set 3 · 5 of 12 sets', sessionStartedAtEpochMs: 1 };

describe('workout Live Activity rest state', () => {
  it('sends a running rest as its window and a paused rest as the seconds left', async () => {
    const native = bridge();
    const activity = createWorkoutActivitySync(native);
    const startedAt = new Date(Date.now() - 10_000);
    const endsAt = new Date(Date.now() + 80_000);

    activity.syncWorkoutActivity(session);
    activity.syncWorkoutActivityRest({ startedAtIso: startedAt.toISOString(), endsAtIso: endsAt.toISOString() });
    await flush();
    activity.syncWorkoutActivityRest({ pausedRemainingSeconds: 79.6 });
    await flush();
    activity.syncWorkoutActivityRest(null);
    await flush();

    const [running, paused, idle] = native.synced.slice(-3);
    expect(running).toMatchObject({ restStartedAtEpochMs: startedAt.getTime(), restEndsAtEpochMs: endsAt.getTime() });
    expect(running).not.toHaveProperty('restPausedSeconds');
    expect(paused).toMatchObject({ restPausedSeconds: 80, restStartedAtEpochMs: undefined, restEndsAtEpochMs: undefined });
    expect(idle).not.toHaveProperty('restPausedSeconds');
    expect(idle.restEndsAtEpochMs).toBeUndefined();
  });

  it('treats a rest that already ended, or a paused rest with nothing left, as no rest', async () => {
    const native = bridge();
    const activity = createWorkoutActivitySync(native);

    activity.syncWorkoutActivity(session);
    activity.syncWorkoutActivityRest({
      startedAtIso: new Date(Date.now() - 90_000).toISOString(),
      endsAtIso: new Date(Date.now() - 1_000).toISOString(),
    });
    await flush();
    activity.syncWorkoutActivityRest({ pausedRemainingSeconds: 0 });
    await flush();

    for (const payload of native.synced) {
      expect(payload.restEndsAtEpochMs).toBeUndefined();
      expect(payload).not.toHaveProperty('restPausedSeconds');
    }
  });

  it('keeps a rest that arrives before the workout state and sends it with the first sync', async () => {
    const native = bridge();
    const activity = createWorkoutActivitySync(native);

    activity.syncWorkoutActivityRest({ pausedRemainingSeconds: 45 });
    await flush();
    expect(native.sync).not.toHaveBeenCalled();

    activity.syncWorkoutActivity(session);
    await flush();
    expect(native.synced).toEqual([{ ...session, restStartedAtEpochMs: undefined, restEndsAtEpochMs: undefined, restPausedSeconds: 45 }]);
  });
});

describe('workoutActivityDetailLine', () => {
  it('names the set that is up, sets done of planned, and tonnage', () => {
    expect(workoutActivityDetailLine({ nextSetNumber: 3, completedSets: 5, totalSets: 12, tonnage: 4200.4 })).toBe(
      'set 3 · 5 of 12 sets · 4,200 lb',
    );
  });

  it('leaves out the set when none is up and tonnage before anything is lifted', () => {
    expect(workoutActivityDetailLine({ nextSetNumber: null, completedSets: 12, totalSets: 12, tonnage: 9100 })).toBe(
      '12 of 12 sets · 9,100 lb',
    );
    expect(workoutActivityDetailLine({ nextSetNumber: 1, completedSets: 0, totalSets: 12, tonnage: 0 })).toBe(
      'set 1 · 0 of 12 sets',
    );
  });
});
