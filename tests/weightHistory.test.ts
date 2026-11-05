import { describe, expect, it, vi } from 'vitest';

import { buildWeightTrend } from '@/lib/weightTrend';
import {
  WEIGHT_RANGES,
  mergeWeightHistory,
  weighInsByMonth,
  weightChangeLabel,
  weightChartTicks,
  weightChartWindow,
  weightRangeKgPerWeek,
} from '@/lib/weightHistory';

const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: supabaseMock.from } }));
vi.mock('@/lib/nativeBridge', () => ({ hasNativeHealth: () => false, NativeHealth: {} }));

import { getAllBodyWeights } from '@/lib/healthWeights';

/** A weigh-in at 8 AM local on `day` (yyyy-MM-dd). */
function weighIn(id: string, day: string, kilograms: number, hour = 8) {
  const [year, month, date] = day.split('-').map(Number);
  return { id, measured_at: new Date(year, month - 1, date, hour).toISOString(), kilograms };
}

describe('the chart ranges', () => {
  it('are a month, three, six, a year and everything', () => {
    expect(WEIGHT_RANGES.map((range) => [range.label, range.days])).toEqual([
      ['1M', 30],
      ['3M', 90],
      ['6M', 182],
      ['1Y', 365],
      ['All', null],
    ]);
  });

  it('end today and place each day by the calendar, so the line starts where the weigh-ins do', () => {
    const trend = buildWeightTrend([weighIn('b', '2026-11-03', 80), weighIn('a', '2026-10-20', 79)]);
    const month = weightChartWindow(trend.points, 30, '2026-11-05');
    expect(month).toMatchObject({ startDay: '2026-10-07', endDay: '2026-11-05', slots: 30 });
    expect(month.series[0]).toMatchObject({ date: '2026-10-20', slot: 13 });
    // The line stops at the last weigh-in; the days since stay empty.
    expect(month.series.at(-1)).toMatchObject({ date: '2026-11-03', slot: 27 });
    expect(month.series).toHaveLength(15);
  });

  it('cut a long history to the range and keep the trend carried into it', () => {
    const trend = buildWeightTrend([weighIn('c', '2026-11-04', 82), weighIn('b', '2026-06-01', 79), weighIn('a', '2026-01-10', 76)]);
    const month = weightChartWindow(trend.points, 30, '2026-11-05');
    expect(month.series[0].date).toBe('2026-10-07');
    // Smoothed from the earlier weigh-ins, not restarted at the window's edge.
    expect(month.series[0].ewmaKg).toBeCloseTo(trend.points.find((point) => point.date === '2026-10-07')!.ewmaKg);
  });

  it('run All from the first weigh-in to today', () => {
    const trend = buildWeightTrend([weighIn('b', '2026-11-01', 80), weighIn('a', '2025-03-02', 74)]);
    const all = weightChartWindow(trend.points, null, '2026-11-05');
    expect(all).toMatchObject({ startDay: '2025-03-02', endDay: '2026-11-05' });
    expect(all.series[0].slot).toBe(0);
    expect(all.slots).toBe(all.series.at(-1)!.slot + 5);
  });

  it('show an empty range when nothing was weighed in it', () => {
    const trend = buildWeightTrend([weighIn('b', '2026-08-01', 80), weighIn('a', '2026-07-20', 79)]);
    expect(weightChartWindow(trend.points, 30, '2026-11-05').series).toEqual([]);
  });

  it('keep a weigh-in dated after today on the axis', () => {
    const trend = buildWeightTrend([weighIn('b', '2026-11-06', 80), weighIn('a', '2026-11-01', 79)]);
    expect(weightChartWindow(trend.points, 30, '2026-11-05').endDay).toBe('2026-11-06');
  });
});

describe('the date axis', () => {
  it('marks Mondays across a month', () => {
    // Oct 7 (a Wednesday) to Nov 5.
    expect(weightChartTicks('2026-10-07', 30)).toEqual([
      { slot: 5, label: 'Oct 12' },
      { slot: 12, label: 'Oct 19' },
      { slot: 19, label: 'Oct 26' },
      { slot: 26, label: 'Nov 2' },
    ]);
  });

  it('marks every other Monday over two months', () => {
    const ticks = weightChartTicks('2026-09-06', 61);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks.every((tick, index) => index === 0 || tick.slot - ticks[index - 1].slot === 14)).toBe(true);
  });

  it('marks the first of each month over three and six months', () => {
    expect(weightChartTicks('2026-08-08', 90).map((tick) => tick.label)).toEqual(['Sep', 'Oct', 'Nov']);
    expect(weightChartTicks('2026-05-08', 182).map((tick) => tick.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  });

  it('marks every other month over a year, writing January as its year', () => {
    expect(weightChartTicks('2025-11-06', 365).map((tick) => tick.label)).toEqual(['2026', 'Mar', 'May', 'Jul', 'Sep', 'Nov']);
  });

  it('marks only years over a long history', () => {
    const labels = weightChartTicks('2017-03-01', 3500).map((tick) => tick.label);
    expect(labels.length).toBeLessThanOrEqual(7);
    expect(labels.every((label) => /^\d{4}$/.test(label))).toBe(true);
  });

  it('leaves the first day unmarked and has nothing to mark on one day', () => {
    expect(weightChartTicks('2026-10-01', 90)[0].slot).toBeGreaterThan(0);
    expect(weightChartTicks('2026-11-05', 1)).toEqual([]);
  });
});

describe('the change across a range', () => {
  it('reads a gain with a plus and a loss with a minus, from the trend', () => {
    const gain = buildWeightTrend([weighIn('b', '2026-11-04', 80), weighIn('a', '2026-10-01', 78)]);
    expect(weightChangeLabel(gain.points, 'kg')).toMatch(/^\+0\.\d kg since Oct\u00a01$/);
    const loss = buildWeightTrend([weighIn('b', '2026-11-04', 78), weighIn('a', '2026-10-01', 80)]);
    expect(weightChangeLabel(loss.points, 'kg')).toMatch(/^−0\.\d kg since Oct\u00a01$/);
  });

  it('names the year of a start in another year and says when nothing changed', () => {
    const trend = buildWeightTrend([weighIn('b', '2026-01-04', 80), weighIn('a', '2025-12-20', 80)]);
    expect(weightChangeLabel(trend.points, 'lb')).toBe('No change since Dec\u00a020, 2025');
  });

  it('has nothing to say about a single day', () => {
    expect(weightChangeLabel(buildWeightTrend([weighIn('a', '2026-11-04', 80)]).points, 'lb')).toBeNull();
  });
});

describe('the weekly rate across a range', () => {
  it('averages the trend over the days shown', () => {
    const trend = buildWeightTrend([weighIn('b', '2026-11-04', 80), weighIn('a', '2026-08-01', 76)]);
    const days = 95;
    const expected = ((trend.points.at(-1)!.ewmaKg - trend.points[0].ewmaKg) / days) * 7;
    expect(weightRangeKgPerWeek(trend.points)).toBeCloseTo(expected);
    expect(weightRangeKgPerWeek(trend.points)!).toBeGreaterThan(0);
  });

  it('leaves out a rate under two weeks', () => {
    const trend = buildWeightTrend([weighIn('b', '2026-11-04', 80), weighIn('a', '2026-10-25', 79)]);
    expect(weightRangeKgPerWeek(trend.points)).toBeNull();
  });
});

describe('the log by month', () => {
  it('groups newest first, names other years and averages each day once', () => {
    const months = weighInsByMonth(
      [
        weighIn('n2', '2026-11-03', 81, 20),
        weighIn('n1', '2026-11-03', 80, 8),
        weighIn('n0', '2026-11-01', 79),
        weighIn('d0', '2025-12-31', 75),
      ],
      '2026-11-05',
    );
    expect(months.map((month) => [month.key, month.title, month.entries.map((entry) => entry.id)])).toEqual([
      ['2026-11', 'November', ['n2', 'n1', 'n0']],
      ['2025-12', 'December 2025', ['d0']],
    ]);
    // Nov 3's two readings count as their median, 80.5, beside Nov 1's 79.
    expect(months[0].averageKg).toBeCloseTo(79.75);
  });
});

describe('the recent read joined to the full one', () => {
  const since = '2026-08-07T08:00:00.000Z';

  it('takes the recent weigh-ins from the recent read and older ones from the full read', () => {
    const recent = [{ id: 'new', measured_at: '2026-11-05T08:00:00Z' }];
    const all = [
      { id: 'deleted-elsewhere', measured_at: '2026-10-01T08:00:00+00:00' },
      { id: 'old', measured_at: '2026-01-01T08:00:00+00:00' },
    ];
    expect(mergeWeightHistory(recent, since, all).map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('keeps one copy of each weigh-in, newest first', () => {
    const recent = [{ id: 'a', measured_at: '2026-11-05T08:00:00Z' }];
    const all = [
      { id: 'b', measured_at: '2025-01-01T08:00:00Z' },
      { id: 'a', measured_at: '2026-11-05T08:00:00Z' },
      { id: 'c', measured_at: '2026-02-01T08:00:00Z' },
    ];
    expect(mergeWeightHistory(recent, null, all).map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
  });

  it('is the recent read alone without a full read', () => {
    const recent = [{ id: 'a', measured_at: '2026-11-05T08:00:00Z' }];
    expect(mergeWeightHistory(recent, since, null)).toBe(recent);
  });
});

describe('reading every weigh-in', () => {
  function table(rows: Array<{ id: string }>) {
    const ranges: Array<[number, number]> = [];
    supabaseMock.from.mockImplementation(() => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
      return query;
    });
    return ranges;
  }

  it('reads page after page until a short one', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: `w${index}` }));
    const ranges = table(rows);
    const read = await getAllBodyWeights('user-1', 2);
    expect(read.map((row) => row.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
    expect(ranges).toEqual([[0, 1], [2, 3], [4, 5]]);
  });

  it('keeps a row once when a write moves it across a page boundary', async () => {
    const ranges = table([{ id: 'a' }, { id: 'b' }, { id: 'b' }, { id: 'c' }]);
    const read = await getAllBodyWeights('user-1', 2);
    expect(read.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(ranges).toHaveLength(3);
  });

  it('fails as a whole when a page fails', async () => {
    supabaseMock.from.mockImplementation(() => {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range: async () => ({ data: null, error: { message: 'offline' } }),
      };
      return query;
    });
    await expect(getAllBodyWeights('user-1')).rejects.toThrow('offline');
  });
});
