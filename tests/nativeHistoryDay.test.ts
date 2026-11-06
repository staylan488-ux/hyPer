import { describe, expect, it } from 'vitest';

import type { ActivitySession, Workout } from '@/types';
import { dayEntries } from '../native/src/lib/historyDay';

const at = (hour: number, minute = 0) => new Date(2026, 10, 5, hour, minute).toISOString();
const workout = (id: string, createdAt: string | null): Pick<Workout, 'id' | 'created_at' | 'date'> => ({ id, created_at: createdAt ?? undefined, date: '2026-11-05' });
// Rows read before created_at was filled can carry null; the helper must still place them.
const activity = (id: string, startedAt: string | null, createdAt: string | null = null) =>
  ({ id, started_at: startedAt, created_at: createdAt, date: '2026-11-05' }) as unknown as Pick<ActivitySession, 'id' | 'started_at' | 'created_at' | 'date'>;
const ids = (entries: ReturnType<typeof dayEntries>) =>
  entries.map((entry) => (entry.kind === 'workout' ? entry.workout.id : (entry.activity as unknown as { id: string }).id));

describe("History's day list", () => {
  it('puts workouts and activities in one order, earliest first', () => {
    const entries = dayEntries(
      [workout('lift', at(7, 15))],
      [activity('swim', at(6, 30)), activity('swim2', at(6, 58)), activity('walk', at(8, 10))],
    );
    expect(ids(entries)).toEqual(['swim', 'swim2', 'lift', 'walk']);
  });

  it('leads with the workout running now, then the day in order', () => {
    const entries = dayEntries(
      [workout('earlier', at(5)), workout('live', at(19, 33))],
      [activity('swim', at(6, 30)), activity('walk', at(8, 10))],
      'live',
    );
    expect(ids(entries)).toEqual(['live', 'earlier', 'swim', 'walk']);
  });

  it('places an activity without a start by when it was saved, and keeps a workout first at the same minute', () => {
    const entries = dayEntries([workout('lift', at(9))], [activity('typed', null, at(7)), activity('same', at(9))]);
    expect(ids(entries)).toEqual(['typed', 'lift', 'same']);
  });
});
