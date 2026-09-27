import { describe, expect, it } from 'vitest';

import { exerciseIdsFromKey, previousTargetExerciseKey } from '@/lib/previousSetTargets';

const set = (exercise_id: string) => ({ exercise_id });

describe('previousTargetExerciseKey', () => {
  it('stays the same when sets are added or updated for existing exercises', () => {
    const before = previousTargetExerciseKey([set('bench'), set('bench'), set('row')]);
    const after = previousTargetExerciseKey([set('bench'), set('bench'), set('bench'), set('row'), set('row')]);
    expect(after).toBe(before);
  });

  it('ignores exercise order', () => {
    expect(previousTargetExerciseKey([set('row'), set('bench')])).toBe(previousTargetExerciseKey([set('bench'), set('row')]));
  });

  it('changes when an exercise is added, substituted or removed', () => {
    const base = previousTargetExerciseKey([set('bench'), set('row')]);
    expect(previousTargetExerciseKey([set('bench'), set('row'), set('squat')])).not.toBe(base);
    expect(previousTargetExerciseKey([set('incline'), set('row')])).not.toBe(base);
    expect(previousTargetExerciseKey([set('row')])).not.toBe(base);
  });

  it('round-trips to the unique exercise ids', () => {
    const ids = ['8a1c2f7e-0000-4000-8000-000000000002', '8a1c2f7e-0000-4000-8000-000000000001'];
    const key = previousTargetExerciseKey([set(ids[0]), set(ids[1]), set(ids[0])]);
    expect(exerciseIdsFromKey(key)).toEqual([...ids].sort());
  });

  it('is empty for a session with no sets', () => {
    expect(previousTargetExerciseKey([])).toBe('');
    expect(exerciseIdsFromKey('')).toEqual([]);
  });
});
