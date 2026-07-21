import { describe, expect, it } from 'vitest';

import {
  formatActivityDuration,
  getActivitySessionDateKey,
  resolveActivityTitle,
  sortActivitySessionsByStart,
} from '@/lib/activitySessions';
import type { ActivitySession } from '@/types';

function makeActivity(overrides: Partial<ActivitySession>): ActivitySession {
  return {
    id: 'activity-1',
    user_id: 'user-1',
    activity_type: 'run',
    title: null,
    date: '2026-06-30',
    started_at: null,
    ended_at: null,
    duration_seconds: null,
    source: 'manual',
    notes: null,
    created_at: '2026-06-30T16:00:00.000Z',
    updated_at: '2026-06-30T16:00:00.000Z',
    ...overrides,
  };
}

describe('activitySessions', () => {
  it('uses a trimmed custom title before the activity label', () => {
    expect(resolveActivityTitle(makeActivity({ title: '  Track intervals  ', activity_type: 'interval_run' }))).toBe('Track intervals');
    expect(resolveActivityTitle(makeActivity({ title: null, activity_type: 'bike_ride' }))).toBe('Bike ride');
  });

  it('formats activity durations compactly', () => {
    expect(formatActivityDuration(null)).toBe('-');
    expect(formatActivityDuration(45)).toBe('1m');
    expect(formatActivityDuration(3_600)).toBe('1h');
    expect(formatActivityDuration(5_400)).toBe('1h 30m');
  });

  it('groups sessions by their stored calendar date', () => {
    expect(getActivitySessionDateKey(makeActivity({
      date: '2026-06-29',
      started_at: '2026-06-30T05:30:00.000Z',
    }))).toBe('2026-06-29');
  });

  it('sorts sessions by start time when available', () => {
    const late = makeActivity({ id: 'late', started_at: '2026-06-30T20:00:00.000Z' });
    const early = makeActivity({ id: 'early', started_at: '2026-06-30T14:00:00.000Z' });

    expect(sortActivitySessionsByStart([late, early]).map((activity) => activity.id)).toEqual(['early', 'late']);
  });
});
