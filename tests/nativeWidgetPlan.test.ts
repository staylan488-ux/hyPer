import { describe, expect, it } from 'vitest';

import type { PlanSchedule } from '@/lib/planSchedule';
import type { Split, SplitDay } from '@/types';

import { buildWidgetSnapshot, widgetPlan, WIDGET_PLAN_DAYS } from '../native/src/lib/widgetPlan';

// The home-screen widgets read a snapshot the native app writes: today by the
// same rule as Today's card, then the program's schedule ahead.

const day = (id: string, name: string, movements: number): SplitDay => ({
  id,
  split_id: 'split-1',
  day_name: name,
  day_order: Number(id.slice(-1)),
  exercises: Array.from({ length: movements }, (_, index) => ({ id: `${id}-${index}` })) as SplitDay['exercises'],
}) as SplitDay;

const split = {
  id: 'split-1',
  name: 'Upper Lower',
  days_per_week: 3,
  days: [day('day-1', 'Upper A', 6), day('day-2', 'Lower A', 5), day('day-3', 'Upper B', 6)],
} as unknown as Split;

// Monday, Wednesday and Friday from Monday 26 October.
const schedule: PlanSchedule = { splitId: 'split-1', startDate: '2026-10-26', mode: 'fixed', weekdays: [1, 3, 5] };

const base = {
  dayKey: '2026-10-27',
  workoutMode: 'split' as const,
  activeSplit: split,
  schedule,
  scheduleWorkouts: [],
  adaptiveSchedulingEnabled: false,
};

describe('widget plan', () => {
  it('writes today as Today shows it, then the schedule ahead', () => {
    const plan = widgetPlan({ ...base, hero: { kind: 'rest' } })!;
    expect(plan).toHaveLength(WIDGET_PLAN_DAYS);
    expect(plan[0]).toEqual({ day: '2026-10-27', title: 'Rest day', detail: 'Next: Tomorrow · Lower A', kind: 'rest' });
    expect(plan[1]).toEqual({ day: '2026-10-28', title: 'Lower A', detail: '5 movements', kind: 'planned' });
    expect(plan[2]).toEqual({ day: '2026-10-29', title: 'Rest day', detail: 'Next: Tomorrow · Upper B', kind: 'rest' });
    expect(plan[3].title).toBe('Upper B');
    // Saturday names Monday's session by its weekday.
    expect(plan[4]).toEqual({ day: '2026-10-31', title: 'Rest day', detail: 'Next: Mon · Upper A', kind: 'rest' });
  });

  it('marks a live session and a session already done', () => {
    const live = widgetPlan({
      ...base,
      hero: { kind: 'resume', completedSets: 2, totalSets: 18, title: 'Session in progress', dayName: 'Upper A', exerciseCount: 6, elapsed: '12 min', nextExercise: null, nextSet: null },
    })!;
    expect(live[0]).toEqual({ day: '2026-10-27', title: 'Upper A', detail: 'In progress', kind: 'live' });
    const done = widgetPlan({ ...base, hero: { kind: 'done', title: 'Upper A' } })!;
    expect(done[0]).toEqual({ day: '2026-10-27', title: 'Trained today', detail: 'Next: Tomorrow · Lower A', kind: 'done' });
  });

  it('writes nothing while today is loading, so the widget keeps its last plan', () => {
    expect(widgetPlan({ ...base, hero: { kind: 'loading' } })).toBeNull();
    expect(widgetPlan({ ...base, hero: { kind: 'schedule-error', retry: () => {} } })).toBeNull();
  });

  it('has only today without a schedule, and every day in flexible mode', () => {
    expect(widgetPlan({ ...base, schedule: null, hero: { kind: 'no-schedule' } })).toEqual([
      { day: '2026-10-27', title: 'Choose today’s session', detail: null, kind: 'setup' },
    ]);
    const flexible = widgetPlan({ ...base, workoutMode: 'flexible', hero: { kind: 'flexible' } })!;
    expect(flexible).toHaveLength(WIDGET_PLAN_DAYS);
    expect(flexible.every((entry) => entry.kind === 'flexible')).toBe(true);
  });

  it('carries Fuel only with a calorie target', () => {
    const plan = widgetPlan({ ...base, hero: { kind: 'rest' } })!;
    expect(buildWidgetSnapshot({ fuelDay: '2026-10-27', target: { calories: 3125, protein: 150 }, totals: { calories: 1884.6, protein: 95.5 }, plan }).fuel).toEqual({
      calories: 1885,
      protein: 96,
      calorieTarget: 3125,
      proteinTarget: 150,
    });
    expect(buildWidgetSnapshot({ fuelDay: '2026-10-27', target: null, totals: { calories: 0, protein: 0 }, plan }).fuel).toBeNull();
  });
});
