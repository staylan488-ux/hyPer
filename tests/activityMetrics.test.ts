import { describe, expect, it } from 'vitest';

import {
  MILE_M,
  aggregateSegments,
  formatClockDuration,
  formatDistanceMi,
  formatPace,
  paceSecondsPerMile,
  sortSegmentsByStart,
} from '@/lib/activityMetrics';

type SegmentSeed = Parameters<typeof aggregateSegments>[0][number];

function makeSegment(overrides: Partial<SegmentSeed> = {}): SegmentSeed {
  return {
    started_at: '2026-07-10T14:00:00.000Z',
    ended_at: '2026-07-10T14:02:00.000Z',
    duration_seconds: 120,
    strain: null,
    avg_hr: null,
    max_hr: null,
    energy_kcal: null,
    distance_m: null,
    ...overrides,
  };
}

describe('aggregateSegments', () => {
  it('returns all nulls for an empty list', () => {
    expect(aggregateSegments([])).toEqual({
      duration_seconds: null,
      distance_m: null,
      energy_kcal: null,
      avg_hr: null,
      max_hr: null,
      strain: null,
    });
  });

  it('sums duration, distance, and kcal across segments', () => {
    const result = aggregateSegments([
      makeSegment({ duration_seconds: 120, distance_m: 400, energy_kcal: 30 }),
      makeSegment({ duration_seconds: 130, distance_m: 410, energy_kcal: 32.4 }),
    ]);

    expect(result.duration_seconds).toBe(250);
    expect(result.distance_m).toBe(810);
    expect(result.energy_kcal).toBe(62);
  });

  it('weights avg_hr by segment duration', () => {
    const result = aggregateSegments([
      makeSegment({ duration_seconds: 60, avg_hr: 180 }),
      makeSegment({ duration_seconds: 180, avg_hr: 140 }),
    ]);

    // (180*60 + 140*180) / 240 = 150
    expect(result.avg_hr).toBe(150);
  });

  it('takes max of max_hr and strain (strain is non-additive)', () => {
    const result = aggregateSegments([
      makeSegment({ max_hr: 182, strain: 10.4 }),
      makeSegment({ max_hr: 191, strain: 12.26 }),
    ]);

    expect(result.max_hr).toBe(191);
    expect(result.strain).toBe(12.3);
  });

  it('tolerates missing metrics without zeroing present ones', () => {
    const result = aggregateSegments([
      makeSegment({ duration_seconds: 100, distance_m: 300, avg_hr: null, energy_kcal: null }),
      makeSegment({ duration_seconds: 110, distance_m: null, avg_hr: 160, energy_kcal: 25 }),
    ]);

    expect(result.duration_seconds).toBe(210);
    expect(result.distance_m).toBe(300);
    expect(result.energy_kcal).toBe(25);
    expect(result.avg_hr).toBe(160);
    expect(result.max_hr).toBeNull();
    expect(result.strain).toBeNull();
  });

  it('derives duration from timestamps when duration_seconds is null', () => {
    const result = aggregateSegments([
      makeSegment({
        duration_seconds: null,
        started_at: '2026-07-10T14:00:00.000Z',
        ended_at: '2026-07-10T14:03:30.000Z',
      }),
    ]);

    expect(result.duration_seconds).toBe(210);
  });
});

describe('formatDistanceMi', () => {
  it('formats short distances with two decimals and long with one', () => {
    expect(formatDistanceMi(5130)).toBe('3.19 mi');
    expect(formatDistanceMi(42195)).toBe('26.2 mi');
  });

  it('returns null for missing or non-positive distance', () => {
    expect(formatDistanceMi(null)).toBeNull();
    expect(formatDistanceMi(0)).toBeNull();
  });
});

describe('formatPace', () => {
  it('formats seconds-per-mile as m:ss /mi', () => {
    expect(formatPace(452)).toBe('7:32 /mi');
    expect(formatPace(600)).toBe('10:00 /mi');
  });

  it('rejects nonsense paces', () => {
    expect(formatPace(null)).toBeNull();
    expect(formatPace(0)).toBeNull();
    expect(formatPace(3601)).toBeNull();
    expect(formatPace(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('paceSecondsPerMile', () => {
  it('computes pace from distance and duration', () => {
    expect(paceSecondsPerMile(MILE_M, 460)).toBe(460);
    expect(paceSecondsPerMile(MILE_M / 2, 200)).toBe(400);
  });

  it('returns null when either input is missing or non-positive', () => {
    expect(paceSecondsPerMile(null, 272)).toBeNull();
    expect(paceSecondsPerMile(1000, 0)).toBeNull();
  });
});

describe('formatClockDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatClockDuration(64)).toBe('1:04');
    expect(formatClockDuration(724)).toBe('12:04');
    expect(formatClockDuration(3751)).toBe('1:02:31');
  });

  it('returns null for missing or negative values', () => {
    expect(formatClockDuration(null)).toBeNull();
    expect(formatClockDuration(-5)).toBeNull();
  });
});

describe('sortSegmentsByStart', () => {
  it('sorts ascending by started_at without mutating the input', () => {
    const segments = [
      { started_at: '2026-07-10T14:10:00.000Z' },
      { started_at: '2026-07-10T14:00:00.000Z' },
    ];
    const sorted = sortSegmentsByStart(segments);

    expect(sorted.map((s) => s.started_at)).toEqual([
      '2026-07-10T14:00:00.000Z',
      '2026-07-10T14:10:00.000Z',
    ]);
    expect(segments[0].started_at).toBe('2026-07-10T14:10:00.000Z');
  });
});
