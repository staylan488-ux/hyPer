import { addDays } from 'date-fns';
import { describe, expect, it, vi } from 'vitest';
import type { SplitDay } from '@/types';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { plannedDayForDate, type PlanSchedule } from '@/lib/planSchedule';

const splitDays: SplitDay[] = ['Upper A', 'Lower A', 'Upper B', 'Lower B'].map((name, index) => ({
  id: `day-${index}`,
  split_id: 'split',
  day_name: name,
  day_order: index,
  exercises: [],
}));

const fixed: PlanSchedule = {
  splitId: 'split',
  startDate: '2026-08-31',
  mode: 'fixed',
  weekdays: [1, 2, 4, 5],
  anchorDay: 1,
};

function localDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function workout(date: string, splitDayIndex: number, overrides: Partial<{
  id: string;
  split_day_id: string | null;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
}> = {}) {
  return {
    id: `workout-${date}-${splitDayIndex}`,
    date,
    split_day_id: splitDays[splitDayIndex]?.id ?? null,
    completed: true,
    created_at: `${date}T12:00:00Z`,
    completed_at: `${date}T13:00:00Z`,
    ...overrides,
  };
}

type History = ReturnType<typeof workout>[];

function projection(start: string, count: number, history: History = [], schedule = fixed, days = splitDays) {
  return Array.from({ length: count }, (_, offset) => (
    plannedDayForDate(addDays(localDate(start), offset), days, schedule, 0, history)?.day_name ?? 'Rest'
  ));
}

describe('adaptive plan scheduling', () => {
  it('anchors a manually completed Upper B and shifts both workout and rest dates', () => {
    const history = [workout('2026-09-01', 2)];
    expect(projection('2026-09-01', 15, history)).toEqual([
      'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A', 'Rest',
      'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A', 'Rest', 'Upper B',
    ]);
  });

  it('anchors a delayed Lower A without requiring the skipped day to be marked', () => {
    // Tuesday was Lower A; the user stays home and completes it Wednesday.
    const history = [workout('2026-09-02', 1)];
    expect(projection('2026-09-01', 9, history)).toEqual([
      'Lower A', 'Lower A', 'Rest', 'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A',
    ]);
  });

  it('does not move the cycle for browsing, incomplete starts, or failed completion', () => {
    const baseline = projection('2026-09-01', 8);
    expect(projection('2026-09-01', 8, [workout('2026-09-01', 2, { completed: false, completed_at: null })]))
      .toEqual(baseline);
    expect(baseline).toEqual(['Lower A', 'Rest', 'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A']);
  });

  it('ignores flexible workouts, other programs, and workouts before the plan start', () => {
    const irrelevant = [
      workout('2026-09-01', 2, { split_day_id: null }),
      workout('2026-09-02', 2, { split_day_id: 'another-program-day' }),
      workout('2026-08-30', 2),
    ];
    expect(projection('2026-09-01', 9, irrelevant)).toEqual(projection('2026-09-01', 9));
  });

  it('leaves historical projections and persisted inputs unchanged when a later workout anchors the cycle', () => {
    const history = [workout('2026-09-01', 2), workout('2026-09-05', 1)];
    const original = JSON.stringify({ history, fixed, splitDays });
    expect(projection('2026-08-31', 5, history)).toEqual(['Upper A', 'Upper B', 'Lower B', 'Rest', 'Rest']);
    expect(projection('2026-09-05', 4, history)).toEqual(['Lower A', 'Rest', 'Upper B', 'Lower B']);
    expect(JSON.stringify({ history, fixed, splitDays })).toBe(original);
  });

  it('reconstructs the same schedule from persisted workout and schedule data after reload', () => {
    const history = [workout('2026-09-01', 2)];
    const restored = JSON.parse(JSON.stringify({ history, schedule: fixed, days: splitDays }));
    expect(projection('2026-09-02', 20, restored.history, restored.schedule, restored.days))
      .toEqual(projection('2026-09-02', 20, history));
  });

  it('uses actual split ids and saved weekday spacing without relying on workout names', () => {
    const renamed = splitDays.map((day, index) => ({ ...day, day_name: `Session ${index + 1}` }));
    const schedule = { ...fixed, weekdays: [5, 6, 1, 2], anchorDay: 5 };
    expect(projection('2026-09-01', 8, [workout('2026-09-01', 2)], schedule, renamed)).toEqual([
      'Session 3', 'Session 4', 'Rest', 'Rest', 'Session 1', 'Session 2', 'Rest', 'Session 3',
    ]);
  });

  it('continues all saved split days across weeks when the number of training weekdays differs', () => {
    const days = splitDays.slice(0, 3);
    const schedule = { ...fixed, weekdays: [1, 4] };
    const result = projection('2026-08-31', 22, [], schedule, days);
    expect(result.filter((value) => value !== 'Rest')).toEqual([
      'Upper A', 'Lower A', 'Upper B', 'Upper A', 'Lower A', 'Upper B', 'Upper A',
    ]);
    expect(result.slice(0, 7)).toEqual(['Upper A', 'Rest', 'Rest', 'Lower A', 'Rest', 'Rest', 'Rest']);
  });

  it('handles split indexes beyond seven without truncating the saved order', () => {
    const days = Array.from({ length: 9 }, (_, index) => ({
      ...splitDays[0], id: `long-${index}`, day_order: index, day_name: `Day ${index + 1}`,
    }));
    const schedule = { ...fixed, weekdays: [1, 2, 3, 4, 5, 6, 0] };
    const history = [workout('2026-09-01', 0, { split_day_id: 'long-7' })];
    expect(projection('2026-09-01', 5, history, schedule, days)).toEqual(['Day 8', 'Day 9', 'Day 1', 'Day 2', 'Day 3']);
  });

  it('uses the latest started session on a shared date regardless of response order', () => {
    const earlier = workout('2026-09-01', 2, { created_at: '2026-09-01T08:00:00Z' });
    const later = workout('2026-09-01', 0, { created_at: '2026-09-01T18:00:00Z' });
    const expected = ['Upper A', 'Lower A', 'Rest', 'Upper B'];
    expect(projection('2026-09-01', 4, [later, earlier])).toEqual(expected);
    expect(projection('2026-09-01', 4, [earlier, later])).toEqual(expected);
  });

  it('breaks identical date and creation-time ties deterministically by workout id', () => {
    const first = workout('2026-09-01', 2, { id: 'a' });
    const second = workout('2026-09-01', 0, { id: 'z' });
    expect(projection('2026-09-01', 4, [first, second])).toEqual(projection('2026-09-01', 4, [second, first]));
    expect(projection('2026-09-01', 4, [first, second])).toEqual(['Upper A', 'Lower A', 'Rest', 'Upper B']);
  });

  it('honors a deliberate schedule reset instead of reapplying an older workout anchor', () => {
    const schedule = { ...fixed, updatedAt: '2026-09-01T15:00:00Z' };
    const old = workout('2026-09-01', 2);
    expect(projection('2026-09-01', 8, [old], schedule)).toEqual(projection('2026-09-01', 8, [], schedule));
    const afterReset = workout('2026-09-01', 2, { created_at: '2026-09-01T16:00:00Z', completed_at: '2026-09-01T17:00:00Z' });
    expect(projection('2026-09-01', 3, [old, afterReset], schedule)).toEqual(['Upper B', 'Lower B', 'Rest']);
  });

  it.each(['2026-03-07', '2026-10-31', '2026-12-31'])(
    'advances by local calendar days across clock and year boundaries from %s',
    (anchorDate) => {
      const schedule = { ...fixed, startDate: '2026-01-01' };
      expect(projection(anchorDate, 8, [workout(anchorDate, 2)], schedule)).toEqual([
        'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A', 'Rest', 'Upper B',
      ]);
    },
  );

  it('keeps missed days on the saved fixed sequence without inventing catch-up workouts', () => {
    expect(projection('2026-09-01', 8, [workout('2026-08-31', 0)])).toEqual([
      'Lower A', 'Rest', 'Upper B', 'Lower B', 'Rest', 'Rest', 'Upper A', 'Lower A',
    ]);
  });

  it('shows no scheduled workouts before the saved start date', () => {
    expect(projection('2026-08-28', 3)).toEqual(['Rest', 'Rest', 'Rest']);
  });

  describe('flexible rotation', () => {
    const flex: PlanSchedule = { ...fixed, mode: 'flex', weekdays: [], anchorDay: 0 };

    it('follows the completed split day instead of making up the skipped day', () => {
      const history = [workout('2026-09-01', 2)];
      expect(projection('2026-09-01', 4, history, flex)).toEqual(['Upper B', 'Lower B', 'Lower B', 'Lower B']);
    });

    it('does not advance the queue for elapsed missed days or unrelated completions', () => {
      const history = [
        workout('2026-09-01', 2),
        workout('2026-09-02', 0, { split_day_id: null }),
        workout('2026-09-03', 0, { split_day_id: 'another-program-day' }),
        workout('2026-09-04', 0, { completed: false, completed_at: null }),
      ];
      expect(projection('2026-09-02', 8, history, flex)).toEqual(Array(8).fill('Lower B'));
    });

    it('preserves legacy compensated offsets until a new session completes', () => {
      const edited: PlanSchedule = { ...flex, anchorDay: 3, updatedAt: '2026-09-04T09:00:00Z' };
      const history = [workout('2026-09-01', 0), workout('2026-09-02', 1), workout('2026-09-03', 2, { split_day_id: null })];
      expect(projection('2026-09-04', 1, history, edited)).toEqual(['Upper B']);
    });

    it('uses explicit flex indexes without subtracting prior completions', () => {
      const edited: PlanSchedule = { ...flex, flexAnchorIndex: 2, updatedAt: '2026-09-04T09:00:00Z' };
      const history = [workout('2026-09-01', 0)];
      expect(projection('2026-09-04', 1, history, edited)).toEqual(['Upper B']);
    });

    it('wraps the queue after the actual final split day is completed', () => {
      const history = [workout('2026-09-01', 2), workout('2026-09-04', 3)];
      expect(projection('2026-09-03', 4, history, flex)).toEqual(['Lower B', 'Lower B', 'Upper A', 'Upper A']);
    });
  });
});
