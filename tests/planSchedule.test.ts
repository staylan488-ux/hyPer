import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock supabase before importing planSchedule (it now imports supabase)
const supabaseMock = vi.hoisted(() => {
  const defaultFrom = () => ({
    upsert: vi.fn(() => ({ error: null })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
    })),
  });

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: vi.fn(defaultFrom) as any,
    auth: { getUser: vi.fn() },
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

import {
  buildFixedWeekdays,
  loadPlanSchedule,
  loadWithBackgroundSync,
  plannedDayForDate,
  savePlanSchedule,
  defaultStartDate,
  defaultWeekdays,
  type PlanSchedule,
} from '../src/lib/planSchedule';
import type { SplitDay } from '@/types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

function localDate(yyyyMmDd: string): Date {
  const [year, month, day] = yyyyMmDd.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

describe('planSchedule', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildFixedWeekdays', () => {
    it('builds correct weekdays for anchor day 0 (Sunday)', () => {
      expect(buildFixedWeekdays(0, 3)).toEqual([0, 2, 4]);
      expect(buildFixedWeekdays(0, 4)).toEqual([0, 1, 3, 4]);
      expect(buildFixedWeekdays(0, 5)).toEqual([0, 1, 2, 4, 5]);
      expect(buildFixedWeekdays(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(buildFixedWeekdays(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('builds correct weekdays for anchor day 1 (Monday)', () => {
      expect(buildFixedWeekdays(1, 3)).toEqual([1, 3, 5]);
      expect(buildFixedWeekdays(1, 4)).toEqual([1, 2, 4, 5]);
      expect(buildFixedWeekdays(1, 5)).toEqual([1, 2, 3, 5, 6]);
      expect(buildFixedWeekdays(1, 6)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(buildFixedWeekdays(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    });

    it('builds correct weekdays for anchor day 2 (Tuesday)', () => {
      expect(buildFixedWeekdays(2, 3)).toEqual([2, 4, 6]);
      expect(buildFixedWeekdays(2, 4)).toEqual([2, 3, 5, 6]);
      expect(buildFixedWeekdays(2, 5)).toEqual([2, 3, 4, 6, 0]);
    });

    it('builds correct weekdays for anchor day 3 (Wednesday)', () => {
      expect(buildFixedWeekdays(3, 3)).toEqual([3, 5, 0]);
      expect(buildFixedWeekdays(3, 4)).toEqual([3, 4, 6, 0]);
      expect(buildFixedWeekdays(3, 5)).toEqual([3, 4, 5, 0, 1]);
    });

    it('builds correct weekdays for anchor day 4 (Thursday)', () => {
      expect(buildFixedWeekdays(4, 3)).toEqual([4, 6, 1]);
      expect(buildFixedWeekdays(4, 4)).toEqual([4, 5, 0, 1]);
      expect(buildFixedWeekdays(4, 5)).toEqual([4, 5, 6, 1, 2]);
    });

    it('builds correct weekdays for anchor day 5 (Friday)', () => {
      expect(buildFixedWeekdays(5, 3)).toEqual([5, 0, 2]);
      expect(buildFixedWeekdays(5, 4)).toEqual([5, 6, 1, 2]);
      expect(buildFixedWeekdays(5, 5)).toEqual([5, 6, 0, 2, 3]);
    });

    it('builds correct weekdays for anchor day 6 (Saturday)', () => {
      expect(buildFixedWeekdays(6, 3)).toEqual([6, 1, 3]);
      expect(buildFixedWeekdays(6, 4)).toEqual([6, 0, 2, 3]);
      expect(buildFixedWeekdays(6, 5)).toEqual([6, 0, 1, 3, 4]);
    });

    it('handles negative anchor days by normalizing', () => {
      expect(buildFixedWeekdays(-1, 3)).toEqual([6, 1, 3]);
      expect(buildFixedWeekdays(-7, 3)).toEqual([0, 2, 4]);
    });

    it('handles anchor days > 6 by normalizing', () => {
      expect(buildFixedWeekdays(7, 3)).toEqual([0, 2, 4]);
      expect(buildFixedWeekdays(10, 3)).toEqual([3, 5, 0]);
    });

    it('clamps days per week to valid range', () => {
      expect(buildFixedWeekdays(1, 1)).toEqual([1, 4]);
      expect(buildFixedWeekdays(1, 8)).toEqual([1, 2, 3, 4, 5, 6, 0]);
      expect(buildFixedWeekdays(1, -5)).toEqual([1, 4]);
    });

    it('defaults to 4-day pattern for 2 days per week', () => {
      expect(buildFixedWeekdays(1, 2)).toEqual([1, 4]);
    });
  });

  describe('normalizeWeekdayOrder (via loadPlanSchedule)', () => {
    it('deduplicates duplicate weekdays', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [1, 1, 3, 3, 5, 5],
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.weekdays).toEqual([1, 3, 5]);
    });

    it('normalizes negative weekday values', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [-1, -2],
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.weekdays).toEqual([6, 5]);
    });

    it('normalizes weekday values > 6', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [7, 8, 14],
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.weekdays).toEqual([0, 1]);
    });

    it('preserves order of first occurrence for duplicates', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [5, 3, 1, 3, 5, 1],
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.weekdays).toEqual([5, 3, 1]);
    });
  });

  describe('loadPlanSchedule', () => {
    it('returns null when no schedule exists', () => {
      const result = loadPlanSchedule('user1', 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      localStorageMock.setItem('plan-schedule:user1:test', 'not valid json');
      const result = loadPlanSchedule('user1', 'test');
      expect(result).toBeNull();
    });

    it('returns null for missing required fields', () => {
      localStorageMock.setItem('plan-schedule:user1:test', JSON.stringify({ splitId: 'test' }));
      expect(loadPlanSchedule('user1', 'test')).toBeNull();

      localStorageMock.setItem('plan-schedule:user1:test', JSON.stringify({
        splitId: 'test',
        startDate: '2024-01-01',
      }));
      expect(loadPlanSchedule('user1', 'test')).toBeNull();

      localStorageMock.setItem('plan-schedule:user1:test', JSON.stringify({
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
      }));
      expect(loadPlanSchedule('user1', 'test')).toBeNull();
    });

    it('returns null for fixed mode with empty weekdays', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [],
      };
      savePlanSchedule('user1', schedule);
      expect(loadPlanSchedule('user1', 'test')).toBeNull();
    });

    it('allows flex mode with empty weekdays', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'flex',
        weekdays: [],
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded).not.toBeNull();
      expect(loaded?.weekdays).toEqual([]);
    });

    it('normalizes anchorDay to valid range', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
        anchorDay: -1,
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.anchorDay).toBe(6);
    });

    it('normalizes anchorDay > 6', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
        anchorDay: 8,
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.anchorDay).toBe(1);
    });

    it('defaults anchorDay to first weekday when not specified', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [3, 5, 1],
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.anchorDay).toBe(3);
    });

    it('defaults anchorDay to 0 for flex mode when anchor is not specified', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'flex',
        weekdays: [],
      };
      savePlanSchedule('user1', schedule);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.anchorDay).toBe(0);
    });

    it('handles non-numeric anchorDay by using default', () => {
      const raw = JSON.stringify({
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
        anchorDay: 'invalid',
      });
      localStorageMock.setItem('plan-schedule:user1:test', raw);
      const loaded = loadPlanSchedule('user1', 'test');
      expect(loaded?.anchorDay).toBe(1);
    });

    it('handles null localStorage gracefully', () => {
      const originalLocalStorage = globalThis.localStorage;
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        writable: true,
      });
      expect(loadPlanSchedule('user1', 'test')).toBeNull();
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalLocalStorage,
        writable: true,
      });
    });
  });

  describe('plannedDayForDate', () => {
    const mockSplitDays: SplitDay[] = [
      { day_id: '1', day_name: 'Day A', exercises: [] },
      { day_id: '2', day_name: 'Day B', exercises: [] },
      { day_id: '3', day_name: 'Day C', exercises: [] },
    ];

    it('returns null for empty splitDays', () => {
      const schedule: PlanSchedule = {
        splitId: 'test',
        startDate: '2024-01-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
      };
      const result = plannedDayForDate(localDate('2024-01-01'), [], schedule, 0);
      expect(result).toBeNull();
    });

    describe('fixed mode', () => {
      it('returns correct split day for matching weekday', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'fixed',
          weekdays: [1, 3, 5],
        };
        expect(plannedDayForDate(localDate('2024-01-01'), mockSplitDays, schedule, 0)?.day_name).toBe('Day A');
        expect(plannedDayForDate(localDate('2024-01-03'), mockSplitDays, schedule, 0)?.day_name).toBe('Day B');
        expect(plannedDayForDate(localDate('2024-01-05'), mockSplitDays, schedule, 0)?.day_name).toBe('Day C');
      });

      it('returns null for non-scheduled weekday', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'fixed',
          weekdays: [1, 3, 5],
        };
        expect(plannedDayForDate(localDate('2024-01-02'), mockSplitDays, schedule, 0)).toBeNull();
        expect(plannedDayForDate(localDate('2024-01-07'), mockSplitDays, schedule, 0)).toBeNull();
      });

      it('cycles through split days when weekdays > splitDays', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'fixed',
          weekdays: [1, 2, 3, 4, 5, 6],
        };
        const twoDays: SplitDay[] = [
          { day_id: '1', day_name: 'Upper', exercises: [] },
          { day_id: '2', day_name: 'Lower', exercises: [] },
        ];
        expect(plannedDayForDate(localDate('2024-01-01'), twoDays, schedule, 0)?.day_name).toBe('Upper');
        expect(plannedDayForDate(localDate('2024-01-02'), twoDays, schedule, 0)?.day_name).toBe('Lower');
        expect(plannedDayForDate(localDate('2024-01-03'), twoDays, schedule, 0)?.day_name).toBe('Upper');
        expect(plannedDayForDate(localDate('2024-01-04'), twoDays, schedule, 0)?.day_name).toBe('Lower');
        expect(plannedDayForDate(localDate('2024-01-05'), twoDays, schedule, 0)?.day_name).toBe('Upper');
        expect(plannedDayForDate(localDate('2024-01-06'), twoDays, schedule, 0)?.day_name).toBe('Lower');
      });

      it('handles week boundaries correctly', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'fixed',
          weekdays: [0, 6],
        };
        expect(plannedDayForDate(localDate('2024-01-06'), mockSplitDays, schedule, 0)?.day_name).toBe('Day B');
        expect(plannedDayForDate(localDate('2024-01-07'), mockSplitDays, schedule, 0)?.day_name).toBe('Day A');
      });
    });

    describe('flex mode', () => {
      it('returns correct split day based on completed workouts', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'flex',
          weekdays: [],
        };
        const date = localDate('2024-01-15');

        expect(plannedDayForDate(date, mockSplitDays, schedule, 0)?.day_name).toBe('Day A');
        expect(plannedDayForDate(date, mockSplitDays, schedule, 1)?.day_name).toBe('Day B');
        expect(plannedDayForDate(date, mockSplitDays, schedule, 2)?.day_name).toBe('Day C');
        expect(plannedDayForDate(date, mockSplitDays, schedule, 3)?.day_name).toBe('Day A');
        expect(plannedDayForDate(date, mockSplitDays, schedule, 4)?.day_name).toBe('Day B');
      });

      it('respects anchorDay offset when in flex mode', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'flex',
          weekdays: [],
          anchorDay: 2,
        };
        const date = localDate('2024-01-15');

        expect(plannedDayForDate(date, mockSplitDays, schedule, 0)?.day_name).toBe('Day C');
        expect(plannedDayForDate(date, mockSplitDays, schedule, 1)?.day_name).toBe('Day A');
        expect(plannedDayForDate(date, mockSplitDays, schedule, 2)?.day_name).toBe('Day B');
      });

      it('cycles correctly with 2-day split', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'flex',
          weekdays: [],
        };
        const twoDays: SplitDay[] = [
          { day_id: '1', day_name: 'Upper', exercises: [] },
          { day_id: '2', day_name: 'Lower', exercises: [] },
        ];
        const date = localDate('2024-01-15');

        expect(plannedDayForDate(date, twoDays, schedule, 0)?.day_name).toBe('Upper');
        expect(plannedDayForDate(date, twoDays, schedule, 1)?.day_name).toBe('Lower');
        expect(plannedDayForDate(date, twoDays, schedule, 2)?.day_name).toBe('Upper');
        expect(plannedDayForDate(date, twoDays, schedule, 99)?.day_name).toBe('Lower');
        expect(plannedDayForDate(date, twoDays, schedule, 100)?.day_name).toBe('Upper');
      });

      it('handles zero completed workouts', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'flex',
          weekdays: [],
        };
        expect(plannedDayForDate(new Date(), mockSplitDays, schedule, 0)?.day_name).toBe('Day A');
      });

      it('handles large completed workout counts', () => {
        const schedule: PlanSchedule = {
          splitId: 'test',
          startDate: '2024-01-01',
          mode: 'flex',
          weekdays: [],
        };
        expect(plannedDayForDate(new Date(), mockSplitDays, schedule, 10000)?.day_name).toBe('Day B');
      });
    });
  });

  describe('defaultStartDate', () => {
    it('returns today when current hour < 20', () => {
      const mockDate = new Date('2024-01-15T12:00:00');
      vi.setSystemTime(mockDate);
      expect(defaultStartDate()).toBe('2024-01-15');
      vi.useRealTimers();
    });

    it('returns tomorrow when current hour >= 20', () => {
      const mockDate = new Date('2024-01-15T20:00:00');
      vi.setSystemTime(mockDate);
      expect(defaultStartDate()).toBe('2024-01-16');
      vi.useRealTimers();
    });

    it('returns tomorrow at exactly 8 PM', () => {
      const mockDate = new Date('2024-01-15T20:00:00');
      vi.setSystemTime(mockDate);
      expect(defaultStartDate()).toBe('2024-01-16');
      vi.useRealTimers();
    });

    it('returns today at 7:59 PM', () => {
      const mockDate = new Date('2024-01-15T19:59:59');
      vi.setSystemTime(mockDate);
      expect(defaultStartDate()).toBe('2024-01-15');
      vi.useRealTimers();
    });
  });

  describe('defaultWeekdays', () => {
    it('returns MWF for <= 3 days', () => {
      expect(defaultWeekdays(1)).toEqual([1, 3, 5]);
      expect(defaultWeekdays(2)).toEqual([1, 3, 5]);
      expect(defaultWeekdays(3)).toEqual([1, 3, 5]);
    });

    it('returns MTThF for 4 days', () => {
      expect(defaultWeekdays(4)).toEqual([1, 2, 4, 5]);
    });

    it('returns MTWF for 5 days', () => {
      expect(defaultWeekdays(5)).toEqual([1, 2, 3, 5, 6]);
    });

    it('returns MTWThFS for 6+ days', () => {
      expect(defaultWeekdays(6)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(defaultWeekdays(7)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(defaultWeekdays(10)).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  describe('loadWithBackgroundSync', () => {
    it('returns null cached and calls onRemoteUpdate when DB has data', async () => {
      const remoteSchedule = {
        split_id: 'split1',
        start_date: '2024-06-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
        anchor_day: 1,
        updated_at: '2024-06-01T12:00:00Z',
      };

      supabaseMock.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ data: remoteSchedule, error: null })),
            })),
          })),
        })),
        upsert: vi.fn(() => ({ error: null })),
      });

      const onRemoteUpdate = vi.fn();
      const { cached } = loadWithBackgroundSync('user1', 'split1', onRemoteUpdate);

      expect(cached).toBeNull();

      // Wait for background fetch
      await vi.waitFor(() => {
        expect(onRemoteUpdate).toHaveBeenCalledTimes(1);
      });

      const updated = onRemoteUpdate.mock.calls[0][0] as PlanSchedule;
      expect(updated.splitId).toBe('split1');
      expect(updated.startDate).toBe('2024-06-01');
      expect(updated.updatedAt).toBe('2024-06-01T12:00:00Z');
    });

    it('returns cached and does NOT call onRemoteUpdate when local is newer', async () => {
      // Save a schedule with a recent updatedAt — write directly to avoid consuming mock
      const localSchedule: PlanSchedule = {
        splitId: 'split1',
        startDate: '2024-06-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
        anchorDay: 1,
        updatedAt: '2024-06-02T12:00:00Z',
      };
      localStorageMock.setItem(
        'plan-schedule:user1:split1',
        JSON.stringify(localSchedule),
      );

      // DB returns an older version
      const olderRemote = {
        split_id: 'split1',
        start_date: '2024-05-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
        anchor_day: 1,
        updated_at: '2024-06-01T12:00:00Z',
      };

      supabaseMock.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ data: olderRemote, error: null })),
            })),
          })),
        })),
        upsert: vi.fn(() => ({ error: null })),
      });

      const onRemoteUpdate = vi.fn();
      const { cached } = loadWithBackgroundSync('user1', 'split1', onRemoteUpdate);

      expect(cached).not.toBeNull();
      expect(cached?.startDate).toBe('2024-06-01');

      // Wait a tick for the background fetch to complete
      await new Promise((r) => setTimeout(r, 50));

      // Should NOT have called onRemoteUpdate since local is newer
      expect(onRemoteUpdate).not.toHaveBeenCalled();
    });

    it('calls onRemoteUpdate when remote is newer than local cache', async () => {
      // Save a schedule with an older updatedAt
      const localSchedule: PlanSchedule = {
        splitId: 'split1',
        startDate: '2024-05-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
        anchorDay: 1,
        updatedAt: '2024-06-01T12:00:00Z',
      };
      // Manually write to localStorage to avoid consuming the supabase mock
      localStorageMock.setItem(
        'plan-schedule:user1:split1',
        JSON.stringify(localSchedule),
      );

      // DB returns a newer version
      const newerRemote = {
        split_id: 'split1',
        start_date: '2024-06-15',
        mode: 'fixed',
        weekdays: [2, 4, 6],
        anchor_day: 2,
        updated_at: '2024-06-10T12:00:00Z',
      };

      supabaseMock.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ data: newerRemote, error: null })),
            })),
          })),
        })),
        upsert: vi.fn(() => ({ error: null })),
      });

      const onRemoteUpdate = vi.fn();
      const { cached } = loadWithBackgroundSync('user1', 'split1', onRemoteUpdate);

      expect(cached?.startDate).toBe('2024-05-01');

      await vi.waitFor(() => {
        expect(onRemoteUpdate).toHaveBeenCalledTimes(1);
      });

      const updated = onRemoteUpdate.mock.calls[0][0] as PlanSchedule;
      expect(updated.startDate).toBe('2024-06-15');
      expect(updated.weekdays).toEqual([2, 4, 6]);
    });

    it('does not call onRemoteUpdate when cancelled', async () => {
      const remoteSchedule = {
        split_id: 'split1',
        start_date: '2024-06-01',
        mode: 'fixed',
        weekdays: [1, 3, 5],
        anchor_day: 1,
        updated_at: '2024-06-01T12:00:00Z',
      };

      supabaseMock.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ data: remoteSchedule, error: null })),
            })),
          })),
        })),
        upsert: vi.fn(() => ({ error: null })),
      });

      const onRemoteUpdate = vi.fn();
      const { cancel } = loadWithBackgroundSync('user1', 'split1', onRemoteUpdate);

      // Cancel immediately
      cancel();

      await new Promise((r) => setTimeout(r, 50));
      expect(onRemoteUpdate).not.toHaveBeenCalled();
    });

    it('does not call onRemoteUpdate when DB returns null', async () => {
      supabaseMock.from.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() => ({ data: null, error: null })),
            })),
          })),
        })),
        upsert: vi.fn(() => ({ error: null })),
      });

      const onRemoteUpdate = vi.fn();
      loadWithBackgroundSync('user1', 'split1', onRemoteUpdate);

      await new Promise((r) => setTimeout(r, 50));
      expect(onRemoteUpdate).not.toHaveBeenCalled();
    });
  });
});
