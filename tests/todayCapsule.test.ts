import { describe, expect, it, vi } from 'vitest';
import {
  firstExerciseName,
  plannedSetCount,
  todayCapsule,
  TODAY_ACTION_PATHS,
  type HeroState,
} from '@/lib/todayModel';
import type { SplitDay, SplitExercise } from '@/types';

const exercise = (name: string, order: number, sets: number): SplitExercise => ({
  id: `se-${name}`, split_day_id: 'd1', exercise_id: `ex-${name}`, target_sets: sets, target_reps_min: 8, target_reps_max: 10,
  exercise_order: order, notes: null,
  exercise: { id: `ex-${name}`, name, muscle_group: 'chest', muscle_group_secondary: null, equipment: 'Barbell', is_compound: true },
});

const upperA: SplitDay = {
  id: 'd1', split_id: 'split1', day_name: 'Upper A', day_order: 0,
  // Stored out of order: the capsule names the first by exercise_order.
  exercises: [exercise('Barbell Row', 1, 4), exercise('Bench Press', 0, 4), exercise('Incline Press', 2, 3), exercise('Pulldown', 3, 3), exercise('Lateral Raise', 4, 3)],
};

const context = { kcalLeft: 2140 };

describe('todayCapsule', () => {
  it('planned: Start <day> with the set count and first movement, to Train', () => {
    expect(todayCapsule({ kind: 'planned', day: upperA }, context)).toEqual({
      key: 'planned:d1', label: 'Start Upper A', sublabel: '17 sets · Bench Press first', glyph: 'arrow', action: 'train',
    });
    expect(plannedSetCount(upperA)).toBe(17);
    expect(firstExerciseName(upperA)).toBe('Bench Press');
  });

  it('resume: the next set with its values and the logged share, to Train', () => {
    const hero: HeroState = {
      kind: 'resume', completedSets: 4, totalSets: 17, title: 'Session in progress', dayName: 'Upper A', exerciseCount: 5,
      elapsed: '23m', nextExercise: 'Barbell Row', nextSet: 1, nextWeight: 80, nextReps: 10,
    };
    expect(todayCapsule(hero, context)).toEqual({
      key: 'resume', label: 'Resume', sublabel: 'Barbell Row, set 1 · 80 × 10', glyph: 'arrow', action: 'train', progress: 4 / 17,
    });
  });

  it('resume: without saved values names the set only; with none left asks to finish', () => {
    const base = { kind: 'resume', completedSets: 3, totalSets: 9, title: 'Session in progress', dayName: 'Upper A', exerciseCount: 3, elapsed: '—' } as const;
    expect(todayCapsule({ ...base, nextExercise: 'Barbell Row', nextSet: 2, nextWeight: null, nextReps: null }, context)?.sublabel).toBe('Barbell Row, set 2');
    expect(todayCapsule({ ...base, nextExercise: 'Barbell Row', nextSet: 2, nextWeight: 82.5, nextReps: 8 }, context)?.sublabel).toBe('Barbell Row, set 2 · 82.5 × 8');
    expect(todayCapsule({ ...base, completedSets: 9, nextExercise: null, nextSet: null }, context)).toMatchObject({
      label: 'Resume', sublabel: 'All sets logged · review and finish', progress: 1, action: 'train',
    });
  });

  it('rest: Log food with a plus, to Fuel', () => {
    expect(todayCapsule({ kind: 'rest' }, context)).toEqual({ key: 'rest', label: 'Log food', sublabel: '2,140 kcal left', glyph: 'plus', action: 'nutrition' });
    expect(todayCapsule({ kind: 'rest' }, { kcalLeft: null })?.sublabel).toBe('Nothing logged yet today');
  });

  it('done: Review session, to History', () => {
    expect(todayCapsule({ kind: 'done', title: 'Session complete' }, context)).toMatchObject({ label: 'Review session', glyph: 'arrow', action: 'history' });
  });

  it('flexible, no schedule and first run keep main’s actions and copy', () => {
    expect(todayCapsule({ kind: 'flexible' }, context)).toMatchObject({ label: 'Start session', action: 'train' });
    expect(todayCapsule({ kind: 'no-schedule' }, context)).toMatchObject({ label: 'Set plan start', action: 'train' });
    expect(todayCapsule({ kind: 'first-run' }, context)).toMatchObject({ label: 'Get started', action: 'program' });
  });

  it('schedule error retries; loading shows no capsule', () => {
    const retry = vi.fn();
    expect(todayCapsule({ kind: 'schedule-error', retry }, context)).toMatchObject({ label: 'Retry', alert: true, action: 'retry' });
    expect(todayCapsule({ kind: 'loading' }, context)).toBeNull();
  });

  it('every action maps to the route main’s button used', () => {
    expect(TODAY_ACTION_PATHS).toEqual({ train: '/train', history: '/history', nutrition: '/nutrition', program: '/train/program' });
  });
});

