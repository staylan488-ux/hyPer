import { afterEach, describe, expect, it, vi } from 'vitest';
import { capsuleTargetSet, resolveWorkoutCapsule } from '@/components/workout/workoutCapsule';
import type { SetEntryState } from '@/components/workout/setEntryRegistry';
import { capsuleSignature, readCommandCapsule, registerCommandCapsule, resetCommandCapsule } from '@/lib/commandCapsule';
import type { WorkoutSet } from '@/types';

const set = (id: string, exercise_id: string, set_number: number, completed = false, weight: number | null = null, reps: number | null = null, rpe: number | null = null): WorkoutSet => ({
  id, workout_id: 'w1', exercise_id, set_number, weight, reps, rpe, completed, completed_at: completed ? '2026-10-15T10:00:00.000Z' : null,
});

const entry = (overrides: Partial<SetEntryState> = {}): SetEntryState => ({
  weight: '', reps: '', rpe: '', hasDraft: false, saving: false, error: null, completed: false, ...overrides,
});

describe('capsuleTargetSet', () => {
  const sets = [
    set('b1', 'bench', 1, true), set('b2', 'bench', 2, true),
    set('r1', 'row', 1), set('r2', 'row', 2),
    set('i1', 'incline', 1),
  ];

  it('follows the open editor while its set is unfinished', () => {
    expect(capsuleTargetSet(sets, ['bench', 'row', 'incline'], sets[4])?.id).toBe('i1');
  });

  it('otherwise takes the next set in movement order', () => {
    expect(capsuleTargetSet(sets, ['bench', 'row', 'incline'], undefined)?.id).toBe('r1');
    // Editing a logged set does not move the capsule off the next set.
    expect(capsuleTargetSet(sets, ['bench', 'row', 'incline'], sets[0])?.id).toBe('r1');
    expect(capsuleTargetSet(sets, ['incline', 'row', 'bench'], undefined)?.id).toBe('i1');
  });

  it('respects superset rounds like the resume cue', () => {
    const paired = [set('a1', 'a', 1), set('a2', 'a', 2), set('x1', 'b', 1)];
    const pairings = new Map([
      ['a', { role: 'A' as const, partnerExerciseId: 'b' }],
      ['b', { role: 'B' as const, partnerExerciseId: 'a' }],
    ]);
    const roundOneDone = [set('a1', 'a', 1, true), set('a2', 'a', 2), set('x1', 'b', 1)];
    expect(capsuleTargetSet(paired, ['a', 'b'], undefined, pairings)?.id).toBe('a1');
    // A2 waits for B1.
    expect(capsuleTargetSet(roundOneDone, ['a', 'b'], undefined, pairings)?.id).toBe('x1');
  });
});

describe('resolveWorkoutCapsule', () => {
  const target = set('r1', 'row', 1);

  it('logs the row’s own values first', () => {
    expect(resolveWorkoutCapsule({ target, entry: entry({ weight: '80', reps: '10', rpe: '7' }), autofill: { weight: '70', reps: '8', rpe: '', source: 'previous_workout' }, totalSets: 9, finishing: false }))
      .toEqual({ kind: 'log', setId: 'r1', values: { weight: '80', reps: '10', rpe: '7' }, suggested: false });
  });

  it('offers autofill as suggested values when the row has none', () => {
    expect(resolveWorkoutCapsule({ target, entry: entry(), autofill: { weight: '75', reps: '9', rpe: '8', source: 'previous_workout' }, totalSets: 9, finishing: false }))
      .toEqual({ kind: 'log', setId: 'r1', values: { weight: '75', reps: '9', rpe: '8' }, suggested: true });
  });

  it('never logs suggestions over a partial draft, and asks to enter when nothing is loggable', () => {
    expect(resolveWorkoutCapsule({ target, entry: entry({ weight: '80', hasDraft: true }), autofill: { weight: '75', reps: '9', rpe: '', source: 'previous_workout' }, totalSets: 9, finishing: false }))
      .toEqual({ kind: 'enter', setId: 'r1' });
    expect(resolveWorkoutCapsule({ target, entry: entry(), autofill: null, totalSets: 9, finishing: false })).toEqual({ kind: 'enter', setId: 'r1' });
  });

  it('allows 0 lb and 0 reps, like the inline check', () => {
    expect(resolveWorkoutCapsule({ target, entry: entry({ weight: '0', reps: '0' }), autofill: null, totalSets: 9, finishing: false }))
      .toMatchObject({ kind: 'log', values: { weight: '0', reps: '0', rpe: '' } });
  });

  it('shows saving, then Retry with the kept draft after a failed save', () => {
    const values = { weight: '80', reps: '10', rpe: '' };
    expect(resolveWorkoutCapsule({ target, entry: entry({ ...values, saving: true }), autofill: null, totalSets: 9, finishing: false }))
      .toEqual({ kind: 'saving', setId: 'r1', values });
    expect(resolveWorkoutCapsule({ target, entry: entry({ ...values, hasDraft: true, error: 'Couldn’t confirm…' }), autofill: null, totalSets: 9, finishing: false }))
      .toEqual({ kind: 'retry', setId: 'r1', values, error: 'Couldn’t confirm…' });
  });

  it('falls back to the stored set before its row registers', () => {
    expect(resolveWorkoutCapsule({ target: set('r1', 'row', 1, false, 80, 10, null), entry: undefined, autofill: null, totalSets: 9, finishing: false }))
      .toMatchObject({ kind: 'log', values: { weight: '80', reps: '10', rpe: '' }, suggested: false });
  });

  it('offers Finish when no set is left, and nothing for an empty session', () => {
    expect(resolveWorkoutCapsule({ target: undefined, entry: undefined, autofill: null, totalSets: 9, finishing: false })).toEqual({ kind: 'finish', busy: false });
    expect(resolveWorkoutCapsule({ target: undefined, entry: undefined, autofill: null, totalSets: 9, finishing: true })).toEqual({ kind: 'finish', busy: true });
    expect(resolveWorkoutCapsule({ target: undefined, entry: undefined, autofill: null, totalSets: 0, finishing: false })).toBeNull();
  });
});

describe('command capsule store', () => {
  afterEach(() => resetCommandCapsule());

  it('shows the newest registration and restores the previous one on release', () => {
    const today = registerCommandCapsule({ key: 'today', label: 'Start Upper A', glyph: 'arrow', onPress: vi.fn() });
    const workout = registerCommandCapsule({ key: 'set', label: 'Log set', glyph: 'check', onPress: vi.fn() });
    expect(readCommandCapsule()?.key).toBe('set');
    workout.release();
    expect(readCommandCapsule()?.key).toBe('today');
    today.update({ key: 'today', label: 'Resume', glyph: 'arrow', onPress: vi.fn() });
    expect(readCommandCapsule()?.label).toBe('Resume');
    today.release();
    expect(readCommandCapsule()).toBeNull();
  });

  it('signatures ignore callbacks so re-renders do not churn the capsule', () => {
    const spec = { key: 'k', label: 'L', glyph: 'check' as const, onPress: () => {} };
    expect(capsuleSignature(spec)).toBe(capsuleSignature({ ...spec, onPress: () => {} }));
    expect(capsuleSignature(spec)).not.toBe(capsuleSignature({ ...spec, label: 'M' }));
  });
});
