import { describe, expect, it } from 'vitest';

import {
  groupStravaSegments,
  mapStravaSport,
  normalizeStravaActivity,
  stravaLocalDateKey,
  type StravaActivityRecord,
} from '@/lib/stravaImport';
import type { ActivitySegment, ActivitySession } from '@/types';

const T0 = Date.parse('2026-07-07T14:00:00.000Z');

function isoAt(offsetSeconds: number): string {
  return new Date(T0 + offsetSeconds * 1000).toISOString();
}

let seq = 0;

function makeSegment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  const id = overrides.id ?? `seg-${++seq}`;
  return {
    id,
    user_id: 'user-1',
    session_id: null,
    source: 'strava',
    external_id: `ext-${id}`,
    sport: 'Run',
    started_at: isoAt(0),
    ended_at: isoAt(1800),
    duration_seconds: 1800,
    strain: null,
    avg_hr: 150,
    max_hr: 175,
    energy_kcal: null,
    distance_m: 6000,
    raw: { name: 'Morning Run', utc_offset: 0 },
    created_at: isoAt(0),
    updated_at: isoAt(0),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: overrides.id ?? 'session-1',
    user_id: 'user-1',
    activity_type: 'run',
    title: 'Morning Run',
    date: '2026-07-07',
    started_at: isoAt(0),
    ended_at: isoAt(1800),
    duration_seconds: 1800,
    source: 'strava',
    notes: null,
    strain: null,
    avg_hr: 150,
    max_hr: 175,
    energy_kcal: null,
    distance_m: 6000,
    auto_grouped: true,
    user_edited: false,
    dismissed_at: null,
    created_at: isoAt(0),
    updated_at: isoAt(0),
    ...overrides,
  };
}

describe('mapStravaSport', () => {
  it('maps common sport types (with case/format variance)', () => {
    expect(mapStravaSport('Run')).toBe('run');
    expect(mapStravaSport('TrailRun')).toBe('run');
    expect(mapStravaSport('Ride')).toBe('bike_ride');
    expect(mapStravaSport('MountainBikeRide')).toBe('bike_ride');
    expect(mapStravaSport('Swim')).toBe('swimming');
    expect(mapStravaSport('RockClimbing')).toBe('climbing');
  });

  it('falls back to other for unknown/missing sports', () => {
    expect(mapStravaSport('Kitesurf')).toBe('other');
    expect(mapStravaSport(null)).toBe('other');
    expect(mapStravaSport(undefined)).toBe('other');
  });
});

describe('stravaLocalDateKey', () => {
  it('uses the activity utc_offset, not the runtime timezone', () => {
    // 02:30 UTC is 19:30 the previous day at -07:00 (-25200s)
    expect(stravaLocalDateKey('2026-07-08T02:30:00.000Z', -25200)).toBe('2026-07-07');
    // 20:00 UTC is 01:30 next day at +05:30 (+19800s)
    expect(stravaLocalDateKey('2026-07-07T20:00:00.000Z', 19800)).toBe('2026-07-08');
  });
});

describe('normalizeStravaActivity', () => {
  const record: StravaActivityRecord = {
    id: 987654321,
    name: 'Tempo Run',
    sport_type: 'Run',
    start_date: '2026-07-07T14:00:00.000Z',
    utc_offset: -25200,
    elapsed_time: 1900,
    moving_time: 1800,
    distance: 6100,
    average_heartrate: 162.4,
    max_heartrate: 181,
  };

  it('maps id -> external_id and prefers moving time as duration', () => {
    const segment = normalizeStravaActivity(record);
    expect(segment.source).toBe('strava');
    expect(segment.external_id).toBe('987654321');
    expect(segment.duration_seconds).toBe(1800);
    expect(segment.distance_m).toBe(6100);
    expect(segment.avg_hr).toBe(162);
    expect(segment.max_hr).toBe(181);
  });

  it('derives ended_at from start + elapsed time', () => {
    const segment = normalizeStravaActivity(record);
    // elapsed 1900s = 31m40s after 14:00:00
    expect(segment.ended_at).toBe('2026-07-07T14:31:40.000Z');
  });

  it('tolerates missing HR and distance', () => {
    const segment = normalizeStravaActivity({ ...record, average_heartrate: null, max_heartrate: null, distance: null });
    expect(segment.avg_hr).toBeNull();
    expect(segment.max_hr).toBeNull();
    expect(segment.distance_m).toBeNull();
  });
});

describe('groupStravaSegments', () => {
  it('creates one session per activity, carrying the Strava title', () => {
    const seg = makeSegment({ id: 's1', raw: { name: 'Evening Ride', utc_offset: 0 }, sport: 'Ride' });
    const plan = groupStravaSegments([seg], []);

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].session.activity_type).toBe('bike_ride');
    expect(plan.creates[0].session.title).toBe('Evening Ride');
    expect(plan.creates[0].session.source).toBe('strava');
    expect(plan.creates[0].session.auto_grouped).toBe(true);
    expect(plan.creates[0].segmentIds).toEqual(['s1']);
  });

  it('is a no-op when the linked session already matches', () => {
    const session = makeSession({ id: 's1' });
    const seg = makeSegment({ id: 'seg1', session_id: 's1' });

    const plan = groupStravaSegments([seg], [session]);
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });

  it('updates a linked session when Strava data changed, but never overwrites HR filled by WHOOP', () => {
    // strava did not record HR this time; a prior WHOOP enrichment set avg_hr
    const session = makeSession({ id: 's1', avg_hr: 168, distance_m: 5900 });
    const seg = makeSegment({ id: 'seg1', session_id: 's1', avg_hr: null, distance_m: 6100 });

    const plan = groupStravaSegments([seg], [session]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].patch.distance_m).toBe(6100);
    // avg_hr is absent from the strava record, so the WHOOP-filled value stands
    expect(plan.updates[0].patch.avg_hr).toBeUndefined();
  });

  it('never patches user-edited or dismissed sessions', () => {
    const edited = makeSession({ id: 's1', user_edited: true, activity_type: 'other' });
    const seg = makeSegment({ id: 'seg1', session_id: 's1' });

    const plan = groupStravaSegments([seg], [edited]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.skippedUserEdited).toBe(1);
  });

  it('ignores non-strava segments', () => {
    const gps = makeSegment({ id: 'g1', source: 'gps' });
    expect(groupStravaSegments([gps], [])).toMatchObject({ creates: [], updates: [] });
  });
});
