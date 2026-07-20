import { describe, expect, it } from 'vitest';

import {
  LAP_MERGE_GAP_S,
  findAbsorbableWhoopSession,
  groupSegments,
  mapWhoopSport,
  normalizeWhoopWorkout,
  overlapRatioOfShorter,
  whoopLocalDateKey,
  type WhoopWorkoutRecord,
} from '@/lib/whoopImport';
import type { ActivitySegment, ActivitySession } from '@/types';

const T0 = Date.parse('2026-07-07T14:00:00.000Z');

function isoAt(offsetSeconds: number): string {
  return new Date(T0 + offsetSeconds * 1000).toISOString();
}

let segmentSeq = 0;

function makeSegment(overrides: Partial<ActivitySegment> = {}): ActivitySegment {
  const id = overrides.id ?? `seg-${++segmentSeq}`;
  return {
    id,
    user_id: 'user-1',
    session_id: null,
    source: 'whoop',
    external_id: `ext-${id}`,
    sport: 'running',
    started_at: isoAt(0),
    ended_at: isoAt(130),
    duration_seconds: 130,
    strain: 6,
    avg_hr: 170,
    max_hr: 185,
    energy_kcal: 31,
    distance_m: 500,
    raw: { timezone_offset: '+00:00' },
    created_at: isoAt(0),
    updated_at: isoAt(0),
    ...overrides,
  };
}

function makeSession(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: overrides.id ?? 'session-1',
    user_id: 'user-1',
    activity_type: 'interval_run',
    title: null,
    date: '2026-07-07',
    started_at: isoAt(0),
    ended_at: isoAt(130),
    duration_seconds: 130,
    source: 'whoop',
    notes: null,
    strain: 6,
    avg_hr: 170,
    max_hr: 185,
    energy_kcal: 31,
    distance_m: 500,
    auto_grouped: true,
    user_edited: false,
    dismissed_at: null,
    created_at: isoAt(0),
    updated_at: isoAt(0),
    ...overrides,
  };
}

// n lap-like segments: `activeS` seconds of work separated by `gapS` of rest
function makeLaps(n: number, { activeS = 130, gapS = 85, distanceM = 500 as number | null, sessionId = null as string | null } = {}): ActivitySegment[] {
  return Array.from({ length: n }, (_, i) => {
    const start = i * (activeS + gapS);
    return makeSegment({
      id: `lap-${i + 1}`,
      external_id: `ext-lap-${i + 1}`,
      started_at: isoAt(start),
      ended_at: isoAt(start + activeS),
      duration_seconds: activeS,
      distance_m: distanceM,
      session_id: sessionId,
    });
  });
}

describe('mapWhoopSport', () => {
  it('maps known sports and normalizes formatting', () => {
    expect(mapWhoopSport('running')).toBe('run');
    expect(mapWhoopSport('Rock Climbing')).toBe('climbing');
    expect(mapWhoopSport('CYCLING')).toBe('bike_ride');
    expect(mapWhoopSport('pickleball')).toBe('pickleball');
  });

  it('falls back to other for unknown or missing sports', () => {
    expect(mapWhoopSport('functional_fitness')).toBe('other');
    expect(mapWhoopSport(null)).toBe('other');
    expect(mapWhoopSport(undefined)).toBe('other');
  });
});

describe('whoopLocalDateKey', () => {
  it('uses the workout offset, not the runtime timezone', () => {
    // 02:30 UTC is 19:30 the PREVIOUS day at -07:00
    expect(whoopLocalDateKey('2026-07-08T02:30:00.000Z', '-07:00')).toBe('2026-07-07');
    // 20:00 UTC is 01:30 the NEXT day at +05:30
    expect(whoopLocalDateKey('2026-07-07T20:00:00.000Z', '+05:30')).toBe('2026-07-08');
  });

  it('treats a missing offset as UTC', () => {
    expect(whoopLocalDateKey('2026-07-08T02:30:00.000Z', null)).toBe('2026-07-08');
  });
});

describe('normalizeWhoopWorkout', () => {
  const scored: WhoopWorkoutRecord = {
    id: 'w1',
    sport_name: 'running',
    start: '2026-07-07T14:00:00.000Z',
    end: '2026-07-07T14:02:10.000Z',
    timezone_offset: '-07:00',
    score_state: 'SCORED',
    score: { strain: 6.2, average_heart_rate: 171, max_heart_rate: 186, kilojoule: 1000, distance_meter: 502 },
  };

  it('normalizes a scored record with kJ -> kcal conversion', () => {
    const segment = normalizeWhoopWorkout(scored);

    expect(segment.source).toBe('whoop');
    expect(segment.external_id).toBe('w1');
    expect(segment.duration_seconds).toBe(130);
    expect(segment.energy_kcal).toBe(239);
    expect(segment.distance_m).toBe(502);
    expect(segment.raw).toMatchObject({ timezone_offset: '-07:00' });
  });

  it('imports PENDING_SCORE records with timestamps but no metrics', () => {
    const segment = normalizeWhoopWorkout({ ...scored, score_state: 'PENDING_SCORE' });

    expect(segment.started_at).toBe(scored.start);
    expect(segment.duration_seconds).toBe(130);
    expect(segment.strain).toBeNull();
    expect(segment.avg_hr).toBeNull();
    expect(segment.energy_kcal).toBeNull();
    expect(segment.distance_m).toBeNull();
  });
});

describe('groupSegments clustering', () => {
  it('merges 8 fast laps into one interval_run create', () => {
    const plan = groupSegments(makeLaps(8), []);

    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);

    const create = plan.creates[0];
    expect(create.session.activity_type).toBe('interval_run');
    expect(create.session.auto_grouped).toBe(true);
    expect(create.segmentIds).toHaveLength(8);
    expect(create.session.duration_seconds).toBe(8 * 130);
    expect(create.session.distance_m).toBe(8 * 500);
    expect(create.session.started_at).toBe(isoAt(0));
    expect(create.session.ended_at).toBe(isoAt(7 * (130 + 85) + 130));
  });

  it('honours the merge gap boundary exactly', () => {
    const first = makeSegment({ id: 'a', external_id: 'ea', started_at: isoAt(0), ended_at: isoAt(130) });
    const atLimit = makeSegment({
      id: 'b',
      external_id: 'eb',
      started_at: isoAt(130 + LAP_MERGE_GAP_S),
      ended_at: isoAt(260 + LAP_MERGE_GAP_S),
    });
    const overLimit = makeSegment({
      id: 'c',
      external_id: 'ec',
      started_at: isoAt(130 + LAP_MERGE_GAP_S + 1),
      ended_at: isoAt(260 + LAP_MERGE_GAP_S + 1),
    });

    expect(groupSegments([first, atLimit], []).creates).toHaveLength(1);
    expect(groupSegments([first, overLimit], []).creates).toHaveLength(2);
  });

  it('never treats long runs as laps, even back to back', () => {
    const runA = makeSegment({ id: 'r1', external_id: 'er1', started_at: isoAt(0), ended_at: isoAt(2700), duration_seconds: 2700, distance_m: 8200 });
    const runB = makeSegment({ id: 'r2', external_id: 'er2', started_at: isoAt(2760), ended_at: isoAt(5460), duration_seconds: 2700, distance_m: 8100 });

    const plan = groupSegments([runA, runB], []);

    expect(plan.creates).toHaveLength(2);
    expect(plan.creates.every((c) => c.session.activity_type === 'run')).toBe(true);
  });

  it('keeps two real runs 20 minutes apart separate', () => {
    const morning = makeSegment({ id: 'm', external_id: 'em', started_at: isoAt(0), ended_at: isoAt(600), duration_seconds: 600 });
    const later = makeSegment({ id: 'l', external_id: 'el', started_at: isoAt(600 + 20 * 60), ended_at: isoAt(1200 + 20 * 60), duration_seconds: 600 });

    expect(groupSegments([morning, later], []).creates).toHaveLength(2);
  });

  it('classifies both fast and slow rep clusters as interval runs', () => {
    const fastReps = makeLaps(6, { activeS: 58, gapS: 150, distanceM: 330 }); // 5.7 m/s
    const slowReps = makeLaps(6, { activeS: 80, gapS: 150, distanceM: 300 }); // 3.75 m/s

    expect(groupSegments(fastReps, []).creates[0].session.activity_type).toBe('interval_run');
    expect(groupSegments(slowReps, []).creates[0].session.activity_type).toBe('interval_run');
  });

  it('classifies rep clusters without distance data as interval_run, not sprints', () => {
    const noDistance = makeLaps(6, { activeS: 58, gapS: 150, distanceM: null });

    expect(groupSegments(noDistance, []).creates[0].session.activity_type).toBe('interval_run');
  });

  it('ignores non-whoop segments', () => {
    const gpsSegment = makeSegment({ id: 'g', external_id: 'eg', source: 'gps' });

    expect(groupSegments([gpsSegment], [])).toMatchObject({ creates: [], updates: [], deletes: [] });
  });
});

describe('groupSegments reconciliation', () => {
  it('is a no-op when segments already match their session', () => {
    const session = makeSession({
      id: 's1',
      activity_type: 'interval_run',
      started_at: isoAt(0),
      ended_at: isoAt(7 * (130 + 85) + 130),
      duration_seconds: 8 * 130,
      strain: 6,
      avg_hr: 170,
      max_hr: 185,
      energy_kcal: 8 * 31,
      distance_m: 8 * 500,
    });
    const laps = makeLaps(8, { sessionId: 's1' });

    const plan = groupSegments(laps, [session]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.relinks).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
  });

  it('updates the SAME session when a late lap arrives', () => {
    const session = makeSession({
      id: 's1',
      started_at: isoAt(0),
      ended_at: isoAt(7 * (130 + 85) + 130),
      duration_seconds: 8 * 130,
      avg_hr: 170,
      max_hr: 185,
      energy_kcal: 8 * 31,
      distance_m: 8 * 500,
      strain: 6,
    });
    const laps = makeLaps(9, { sessionId: 's1' });
    laps[8].session_id = null; // the late-arriving lap is not linked yet

    const plan = groupSegments(laps, [session]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].sessionId).toBe('s1');
    expect(plan.updates[0].segmentIds).toEqual(['lap-9']);
    expect(plan.updates[0].patch.duration_seconds).toBe(9 * 130);
    expect(plan.updates[0].patch.ended_at).toBe(isoAt(8 * (130 + 85) + 130));
  });

  it('never patches user-edited sessions but still relinks their segments', () => {
    const session = makeSession({ id: 's1', user_edited: true, activity_type: 'run', duration_seconds: 1 });
    const laps = makeLaps(9, { sessionId: 's1' });
    laps[8].session_id = null;

    const plan = groupSegments(laps, [session]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.skippedUserEdited).toBe(1);
    expect(plan.relinks).toEqual([{ sessionId: 's1', segmentIds: ['lap-9'] }]);
  });

  it('never resurrects dismissed sessions', () => {
    const session = makeSession({ id: 's1', dismissed_at: isoAt(9999), duration_seconds: 1 });
    const laps = makeLaps(8, { sessionId: 's1' });

    const plan = groupSegments(laps, [session]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.skippedUserEdited).toBe(1);
  });

  it('holds the tombstone for a dismissed GPS host that whoop had enriched', () => {
    // deleting an enriched GPS run tombstones it (dismissed_at) with its whoop
    // segments still linked; re-sync must relink at most, never recreate
    const dismissedRun = makeSession({
      id: 'gps-run',
      source: 'gps',
      auto_grouped: false,
      dismissed_at: isoAt(9999),
      started_at: isoAt(0),
      ended_at: isoAt(30 * 60),
      duration_seconds: 30 * 60,
    });
    const workout = makeSegment({
      id: 'w1',
      external_id: 'ew1',
      session_id: 'gps-run',
      started_at: isoAt(0),
      ended_at: isoAt(30 * 60),
      duration_seconds: 30 * 60,
    });

    const plan = groupSegments([workout], [dismissedRun]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.skippedUserEdited).toBe(1);
  });

  it('finds the whoop session a freshly saved GPS run should absorb', () => {
    const whoopAuto = makeSession({ id: 'w-auto', started_at: isoAt(-120), ended_at: isoAt(28 * 60) });
    const whoopEdited = makeSession({ id: 'w-edited', user_edited: true, started_at: isoAt(0), ended_at: isoAt(30 * 60) });
    const manual = makeSession({ id: 'manual', source: 'manual', auto_grouped: false, started_at: isoAt(0), ended_at: isoAt(30 * 60) });

    const match = findAbsorbableWhoopSession(isoAt(0), isoAt(30 * 60), [whoopAuto, whoopEdited, manual]);
    expect(match?.id).toBe('w-auto');

    // nothing overlapping enough -> null
    expect(findAbsorbableWhoopSession(isoAt(3 * 3600), isoAt(3 * 3600 + 1800), [whoopAuto])).toBeNull();
  });

  it('computes overlap as a share of the shorter window', () => {
    expect(overlapRatioOfShorter(0, 100, 50, 150)).toBeCloseTo(0.5);
    expect(overlapRatioOfShorter(0, 1000, 100, 200)).toBe(1);
    expect(overlapRatioOfShorter(0, 100, 200, 300)).toBe(0);
  });

  it('deletes orphaned auto-grouped sessions but preserves manual and edited ones', () => {
    const orphanAuto = makeSession({ id: 'orphan-auto' });
    const orphanEdited = makeSession({ id: 'orphan-edited', user_edited: true });
    const orphanDismissed = makeSession({ id: 'orphan-dismissed', dismissed_at: isoAt(0) });

    const plan = groupSegments([], [orphanAuto, orphanEdited, orphanDismissed]);

    expect(plan.deletes).toEqual(['orphan-auto']);
  });

  it('enriches an overlapping GPS session with metrics instead of duplicating it', () => {
    // gps run 14:00-14:30; whoop recorded the same effort 13:59-14:29
    const gpsRun = makeSession({
      id: 'gps-run',
      source: 'gps',
      activity_type: 'run',
      auto_grouped: false,
      started_at: isoAt(0),
      ended_at: isoAt(30 * 60),
      duration_seconds: 30 * 60,
      distance_m: 6100,
      strain: null,
      avg_hr: null,
      max_hr: null,
      energy_kcal: null,
    });
    const whoopRecord = makeSegment({
      id: 'w-run',
      external_id: 'ew-run',
      started_at: isoAt(-60),
      ended_at: isoAt(29 * 60),
      duration_seconds: 30 * 60,
      strain: 11.3,
      avg_hr: 168,
      max_hr: 190,
      energy_kcal: 442,
      distance_m: null,
      session_id: null,
    });

    const plan = groupSegments([whoopRecord], [gpsRun]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].sessionId).toBe('gps-run');
    // metrics only — the host's type, times, and GPS distance stay untouched
    expect(plan.updates[0].patch).toEqual({ strain: 11.3, avg_hr: 168, max_hr: 190, energy_kcal: 442 });
    expect(plan.updates[0].segmentIds).toEqual(['w-run']);
  });

  it('is idempotent once the enrichment landed (membership + equal metrics)', () => {
    const gpsRun = makeSession({
      id: 'gps-run',
      source: 'gps',
      activity_type: 'run',
      auto_grouped: false,
      started_at: isoAt(0),
      ended_at: isoAt(30 * 60),
      strain: 11.3,
      avg_hr: 168,
      max_hr: 190,
      energy_kcal: 442,
    });
    const linked = makeSegment({
      id: 'w-run',
      external_id: 'ew-run',
      started_at: isoAt(-60),
      ended_at: isoAt(29 * 60),
      duration_seconds: 30 * 60,
      strain: 11.3,
      avg_hr: 168,
      max_hr: 190,
      energy_kcal: 442,
      session_id: 'gps-run',
    });

    const plan = groupSegments([linked], [gpsRun]);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.relinks).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
  });

  it('only fills missing metrics on user-edited hosts', () => {
    const editedRun = makeSession({
      id: 'gps-run',
      source: 'gps',
      activity_type: 'run',
      auto_grouped: false,
      user_edited: true,
      started_at: isoAt(0),
      ended_at: isoAt(30 * 60),
      strain: null,
      avg_hr: 150, // user-entered — must not be overwritten
      max_hr: null,
      energy_kcal: null,
    });
    const whoopRecord = makeSegment({
      id: 'w-run',
      external_id: 'ew-run',
      started_at: isoAt(0),
      ended_at: isoAt(30 * 60),
      duration_seconds: 30 * 60,
      strain: 11.3,
      avg_hr: 168,
      max_hr: 190,
      energy_kcal: 442,
      session_id: null,
    });

    const plan = groupSegments([whoopRecord], [editedRun]);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].patch).toEqual({ strain: 11.3, max_hr: 190, energy_kcal: 442 });
  });

  it('creates a fresh session when time overlap is below the merge ratio', () => {
    const gpsRun = makeSession({
      id: 'gps-run',
      source: 'gps',
      auto_grouped: false,
      started_at: isoAt(0),
      ended_at: isoAt(30 * 60),
    });
    // whoop workout mostly AFTER the run: ~17% overlap of the shorter
    const later = makeSegment({
      id: 'w-later',
      external_id: 'ew-later',
      started_at: isoAt(25 * 60),
      ended_at: isoAt(55 * 60),
      duration_seconds: 30 * 60,
      session_id: null,
    });

    const plan = groupSegments([later], [gpsRun]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.creates).toHaveLength(1);
  });

  it('claims each existing session at most once when a cluster splits', () => {
    // previously one cluster linked to s1; now the two efforts are 30 min apart
    const first = makeSegment({ id: 'a', external_id: 'ea', session_id: 's1', started_at: isoAt(0), ended_at: isoAt(130) });
    const second = makeSegment({ id: 'b', external_id: 'eb', session_id: 's1', started_at: isoAt(30 * 60), ended_at: isoAt(30 * 60 + 130) });
    const session = makeSession({ id: 's1' });

    const plan = groupSegments([first, second], [session]);

    // one cluster keeps s1 (update), the other becomes a create
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].sessionId).toBe('s1');
    expect(plan.creates).toHaveLength(1);
    expect(plan.deletes).toHaveLength(0);
  });
});
