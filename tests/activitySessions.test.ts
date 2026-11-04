import { describe, expect, it } from 'vitest';

import {
  buildActivityInput,
  formatActivityDuration,
  getActivitySessionDateKey,
  keepUntouchedTiming,
  resolveActivityTitle,
  sortActivitySessionsByStart,
} from '@/lib/activitySessions';
import type { ActivitySession } from '@/types';

function makeActivity(overrides: Partial<ActivitySession>): ActivitySession {
  return {
    id: 'activity-1',
    user_id: 'user-1',
    activity_type: 'run',
    custom_type: null,
    title: null,
    date: '2026-06-30',
    started_at: null,
    ended_at: null,
    duration_seconds: null,
    source: 'manual',
    notes: null,
    strain: null,
    avg_hr: null,
    max_hr: null,
    energy_kcal: null,
    distance_m: null,
    auto_grouped: false,
    user_edited: false,
    dismissed_at: null,
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

  describe('keepUntouchedTiming', () => {
    const stored = makeActivity({ started_at: '2026-06-30T14:05:17.000Z', ended_at: '2026-06-30T14:05:42.000Z', duration_seconds: 25 });
    const form = { activityType: 'run' as const, customType: '', title: 'Strides', date: new Date(2026, 5, 30), startTime: '14:05', durationMinutes: '0', notes: '' };

    it('keeps a duration under a minute that the form shows as 0', () => {
      const input = keepUntouchedTiming(buildActivityInput(form, stored), stored, { start: true, duration: true });
      expect(input).toMatchObject({ title: 'Strides', started_at: stored.started_at, ended_at: stored.ended_at, duration_seconds: 25 });
    });

    it('rebuilds everything the person changed', () => {
      const built = buildActivityInput({ ...form, durationMinutes: '10' }, stored);
      expect(keepUntouchedTiming(built, stored, { start: false, duration: false })).toEqual(built);
    });
  });
});
