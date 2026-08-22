import { describe, expect, it } from 'vitest';

import {
  findWhoopMatchForWorkout,
  whoopStatsFor,
  workoutHasWhoopStats,
  workoutTimeWindow,
} from '@/lib/workoutWhoop';
import type { ActivitySession, Workout } from '@/types';

const DAY = '2026-08-02';
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 2, h, m, 0)).toISOString();

function workout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'w1', user_id: 'u1', split_day_id: null, date: DAY,
    notes: null, completed: true,
    created_at: at(17, 0), completed_at: at(18, 15),
    sets: [
      { id: 's1', workout_id: 'w1', exercise_id: 'e1', set_number: 1, weight: 100, reps: 5, rpe: 8, completed: true, completed_at: at(17, 10) },
      { id: 's2', workout_id: 'w1', exercise_id: 'e1', set_number: 2, weight: 100, reps: 5, rpe: 8, completed: true, completed_at: at(18, 5) },
    ] as never,
    ...overrides,
  } as Workout;
}

function whoop(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: 'a1', user_id: 'u1', activity_type: 'other', custom_type: 'Weightlifting',
    title: null, date: DAY, started_at: at(17, 5), ended_at: at(18, 10),
    duration_seconds: 3900, source: 'whoop', notes: null,
    strain: 11.4, avg_hr: 118, max_hr: 156, energy_kcal: 420, distance_m: null,
    auto_grouped: true, user_edited: false, dismissed_at: null,
    created_at: at(18, 20), updated_at: at(18, 20),
    ...overrides,
  } as ActivitySession;
}

describe('workoutTimeWindow', () => {
  it('spans the set timestamps, not the calendar day', () => {
    const w = workoutTimeWindow(workout())!;
    expect(new Date(w.startMs).toISOString()).toBe(at(17, 0));
    expect(new Date(w.endMs).toISOString()).toBe(at(18, 15));
  });

  it('still works from set timestamps alone', () => {
    const w = workoutTimeWindow(workout({ created_at: undefined, completed_at: null }))!;
    expect(new Date(w.startMs).toISOString()).toBe(at(17, 10));
    expect(new Date(w.endMs).toISOString()).toBe(at(18, 5));
  });

  it('gives a single timestamp a nominal window instead of refusing', () => {
    const w = workoutTimeWindow(workout({ sets: [] as never, completed_at: null }))!;
    expect(w.endMs - w.startMs).toBe(60 * 60 * 1000);
  });

  it('returns null when a workout has no timing at all', () => {
    expect(workoutTimeWindow(workout({
      sets: [] as never, created_at: undefined, completed_at: null,
    }))).toBeNull();
  });
});

describe('findWhoopMatchForWorkout', () => {
  it('matches the WHOOP record covering the lift', () => {
    const match = findWhoopMatchForWorkout(workout(), [whoop()])!;
    expect(match.session.id).toBe('a1');
    expect(match.overlapRatio).toBeGreaterThan(0.9);
  });

  it('ignores a record from a different part of the day', () => {
    const morningRun = whoop({ id: 'a2', started_at: at(7, 0), ended_at: at(7, 45) });
    expect(findWhoopMatchForWorkout(workout(), [morningRun])).toBeNull();
  });

  it('prefers the record that covers the lift best', () => {
    const partial = whoop({ id: 'partial', started_at: at(18, 0), ended_at: at(18, 40) });
    const full = whoop({ id: 'full' });
    expect(findWhoopMatchForWorkout(workout(), [partial, full])!.session.id).toBe('full');
  });

  it('will not re-claim a record already attached elsewhere', () => {
    expect(findWhoopMatchForWorkout(workout(), [whoop({ dismissed_at: at(19, 0) })])).toBeNull();
  });

  it('leaves a user-edited record alone', () => {
    expect(findWhoopMatchForWorkout(workout(), [whoop({ user_edited: true })])).toBeNull();
  });

  it('ignores a non-WHOOP activity, which is the merge picker’s job', () => {
    expect(findWhoopMatchForWorkout(workout(), [whoop({ source: 'gps' })])).toBeNull();
  });

  it('ignores a trivially short record', () => {
    const blip = whoop({ started_at: at(17, 30), ended_at: at(17, 32) });
    expect(findWhoopMatchForWorkout(workout(), [blip])).toBeNull();
  });
});

describe('whoopStatsFor', () => {
  it('copies the physiology and remembers the source', () => {
    const stats = whoopStatsFor(whoop());
    expect(stats).toEqual({
      strain: 11.4, avg_hr: 118, max_hr: 156, energy_kcal: 420, whoop_session_id: 'a1',
    });
  });

  it('does not invent values the record did not carry', () => {
    const stats = whoopStatsFor(whoop({ strain: null, energy_kcal: null }));
    expect(stats.strain).toBeNull();
    expect(stats.energy_kcal).toBeNull();
  });
});

describe('workoutHasWhoopStats', () => {
  it('is false for a plain workout and true once attached', () => {
    expect(workoutHasWhoopStats(workout())).toBe(false);
    expect(workoutHasWhoopStats(workout({ strain: 11.4 }))).toBe(true);
  });
});
