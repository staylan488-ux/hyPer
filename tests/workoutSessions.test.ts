import { describe, expect, it } from 'vitest';

import {
  buildWeeklyTrainingHours,
  canResumeWorkout,
  formatWorkoutDuration,
  getWorkoutDurationMs,
  resolveEditedSetCompletedAt,
  resolveWorkoutTitle,
} from '@/lib/workoutSessions';

describe('workoutSessions helpers', () => {
  it('prefers split and flexible labels before falling back to exercise names', () => {
    expect(resolveWorkoutTitle({
      splitDayName: 'Push',
      dayLabel: 'Flexible Upper',
      exerciseNames: ['Bench Press', 'Incline Press'],
    })).toBe('Push');

    expect(resolveWorkoutTitle({
      splitDayName: null,
      dayLabel: 'Flexible Upper',
      exerciseNames: ['Bench Press', 'Incline Press'],
    })).toBe('Flexible Upper');
  });

  it('builds compact fallback titles from exercise names', () => {
    expect(resolveWorkoutTitle({
      exerciseNames: ['Bench Press'],
    })).toBe('Bench Press');

    expect(resolveWorkoutTitle({
      exerciseNames: ['Bench Press', 'Row'],
    })).toBe('Bench Press / Row');

    expect(resolveWorkoutTitle({
      exerciseNames: ['Bench Press', 'Row', 'Fly'],
    })).toBe('Bench Press +2');

    expect(resolveWorkoutTitle({ exerciseNames: [] })).toBe('Session');
  });

  it('formats workout durations from timestamps', () => {
    expect(getWorkoutDurationMs({
      created_at: '2026-03-10T10:00:00.000Z',
      completed_at: '2026-03-10T11:05:00.000Z',
    })).toBe(65 * 60 * 1000);

    expect(formatWorkoutDuration(45 * 60 * 1000)).toBe('45m');
    expect(formatWorkoutDuration(65 * 60 * 1000)).toBe('1h 5m');
    expect(formatWorkoutDuration(null)).toBe('—');
  });

  it('aggregates weekly training hours over a rolling 8-week window', () => {
    const points = buildWeeklyTrainingHours([
      {
        date: '2026-03-10',
        completed: true,
        created_at: '2026-03-09T17:00:00.000Z',
        completed_at: '2026-03-09T18:30:00.000Z',
      },
      {
        date: '2026-03-04',
        completed: true,
        created_at: '2026-03-03T17:00:00.000Z',
        completed_at: '2026-03-03T17:45:00.000Z',
      },
      {
        date: '2026-03-01',
        completed: false,
        created_at: '2026-03-01T17:00:00.000Z',
        completed_at: '2026-03-01T17:45:00.000Z',
      },
    ], new Date('2026-03-10T12:00:00.000Z'));

    expect(points).toHaveLength(8);
    expect(points.at(-1)).toMatchObject({
      weekStart: '2026-03-09',
      totalMinutes: 90,
      totalHours: 1.5,
    });
    expect(points.at(-2)).toMatchObject({
      weekStart: '2026-03-02',
      totalMinutes: 45,
      totalHours: 0.8,
    });
  });

  it('anchors weekly training hours to the workout start time when a session crosses into the next week', () => {
    const points = buildWeeklyTrainingHours([
      {
        date: '2026-03-16',
        completed: true,
        created_at: '2026-03-15T23:30:00.000Z',
        completed_at: '2026-03-16T01:00:00.000Z',
      },
    ], new Date('2026-03-16T12:00:00.000Z'));

    expect(points.at(-2)).toMatchObject({
      weekStart: '2026-03-09',
      totalMinutes: 90,
      totalHours: 1.5,
    });
    expect(points.at(-1)).toMatchObject({
      weekStart: '2026-03-16',
      totalMinutes: 0,
      totalHours: 0,
    });
  });

  it('preserves existing completion timestamps when editing completed sets', () => {
    expect(resolveEditedSetCompletedAt({
      completed: true,
      existingSetCompletedAt: '2026-03-10T12:35:00.000Z',
      workoutCompletedAt: '2026-03-10T12:40:00.000Z',
      nowIso: '2026-03-11T08:00:00.000Z',
    })).toBe('2026-03-10T12:35:00.000Z');

    expect(resolveEditedSetCompletedAt({
      completed: true,
      existingSetCompletedAt: null,
      workoutCompletedAt: '2026-03-10T12:40:00.000Z',
      nowIso: '2026-03-11T08:00:00.000Z',
    })).toBe('2026-03-10T12:40:00.000Z');

    expect(resolveEditedSetCompletedAt({
      completed: true,
      existingSetCompletedAt: null,
      workoutCompletedAt: null,
      nowIso: '2026-03-11T08:00:00.000Z',
    })).toBe('2026-03-11T08:00:00.000Z');

    expect(resolveEditedSetCompletedAt({
      completed: false,
      existingSetCompletedAt: '2026-03-10T12:35:00.000Z',
      workoutCompletedAt: '2026-03-10T12:40:00.000Z',
      nowIso: '2026-03-11T08:00:00.000Z',
    })).toBeNull();
  });

  it('only resumes incomplete workouts that started within the last 24 hours', () => {
    const now = new Date('2026-04-05T12:00:00.000Z');

    expect(canResumeWorkout({
      completed: false,
      date: '2026-04-04',
      created_at: '2026-04-04T23:00:00.000Z',
    }, now)).toBe(true);

    expect(canResumeWorkout({
      completed: false,
      date: '2026-04-03',
      created_at: '2026-04-03T10:00:00.000Z',
    }, now)).toBe(false);

    expect(canResumeWorkout({
      completed: true,
      date: '2026-04-05',
      created_at: '2026-04-05T08:00:00.000Z',
    }, now)).toBe(false);
  });
});
