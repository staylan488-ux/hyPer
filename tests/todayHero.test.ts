import { describe, expect, it } from 'vitest';

import { nextPlannedSession, todayHero, weekSessionTarget, type TodayHeroInput } from '@/lib/todayModel';
import type { PlanSchedule } from '@/lib/planSchedule';
import type { Split, Workout } from '@/types';

// Today's hero rule is shared by the web and native Today screens.

const upper = { id: 'day-upper', split_id: 'split-1', day_name: 'Upper', day_order: 0, exercises: [] };
const lower = { id: 'day-lower', split_id: 'split-1', day_name: 'Lower', day_order: 1, exercises: [] };
const split = { id: 'split-1', name: 'Upper Lower', days_per_week: 2, is_active: true, days: [upper, lower] } as unknown as Split;
// Monday and Thursday, from Monday 26 October 2026.
const schedule: PlanSchedule = { splitId: 'split-1', startDate: '2026-10-26', mode: 'fixed', weekdays: [1, 4] };

function input(overrides: Partial<TodayHeroInput> = {}): TodayHeroInput {
  return {
    heroLoading: false,
    currentWorkout: null,
    currentWorkoutDayPlan: null,
    todayDone: null,
    workoutMode: 'split',
    activeSplit: split,
    schedule,
    scheduleLoading: false,
    scheduleWorkoutsLoading: false,
    scheduleWorkouts: [],
    scheduleError: false,
    retrySchedule: () => {},
    refreshedAt: Date.parse('2026-10-26T09:00:00Z'),
    dayKey: '2026-10-26',
    adaptiveSchedulingEnabled: false,
    ...overrides,
  };
}

describe('Today hero', () => {
  it('plans the scheduled day', () => {
    expect(todayHero(input())).toEqual({ kind: 'planned', day: upper });
  });

  it('rests between scheduled days and names the next session', () => {
    expect(todayHero(input({ dayKey: '2026-10-27' }))).toEqual({ kind: 'rest' });
    const rest = { activeSplit: split, schedule, scheduleWorkouts: [], adaptiveSchedulingEnabled: false };
    expect(nextPlannedSession({ ...rest, dayKey: '2026-10-27' })).toBe('Thu · Lower');
    expect(nextPlannedSession({ ...rest, dayKey: '2026-10-28' })).toBe('Tomorrow · Lower');
  });

  it('resumes a session in progress before anything else', () => {
    const workout = {
      id: 'workout-1',
      split_day_id: 'day-upper',
      completed: false,
      created_at: '2026-10-26T08:30:00Z',
      sets: [
        { id: 'set-1', exercise_id: 'bench', set_number: 1, completed: true, weight: 100, reps: 8, exercise: { name: 'Bench Press' } },
        { id: 'set-2', exercise_id: 'bench', set_number: 2, completed: false, weight: null, reps: null, exercise: { name: 'Bench Press' } },
      ],
    } as unknown as Workout;
    const hero = todayHero(input({ currentWorkout: workout, todayDone: undefined }));
    expect(hero).toMatchObject({ kind: 'resume', dayName: 'Upper', completedSets: 1, totalSets: 2, nextSet: 2 });
  });

  it('shows a finished day, and waits while that is unknown', () => {
    expect(todayHero(input({ todayDone: { title: 'Session complete' } }))).toEqual({ kind: 'done', title: 'Session complete' });
    expect(todayHero(input({ todayDone: undefined }))).toEqual({ kind: 'loading' });
    expect(todayHero(input({ heroLoading: true }))).toEqual({ kind: 'loading' });
  });

  it('covers flexible mode, no program, no schedule and a failed schedule read', () => {
    expect(todayHero(input({ workoutMode: 'flexible' }))).toEqual({ kind: 'flexible' });
    expect(todayHero(input({ activeSplit: null }))).toEqual({ kind: 'first-run' });
    expect(todayHero(input({ schedule: null }))).toEqual({ kind: 'no-schedule' });
    expect(todayHero(input({ scheduleLoading: true }))).toEqual({ kind: 'loading' });
    const retry = () => {};
    expect(todayHero(input({ scheduleError: true, retrySchedule: retry }))).toEqual({ kind: 'schedule-error', retry });
  });
});

describe('Sessions planned this week', () => {
  it('counts the fixed weekdays, else the program, and none in flexible mode', () => {
    expect(weekSessionTarget('split', schedule, split)).toBe(2);
    expect(weekSessionTarget('split', null, split)).toBe(2);
    expect(weekSessionTarget('split', { ...schedule, mode: 'flex', weekdays: [] }, split)).toBe(2);
    expect(weekSessionTarget('flexible', schedule, split)).toBeNull();
  });
});
