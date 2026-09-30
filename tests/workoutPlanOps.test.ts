import { describe, expect, it } from 'vitest';

import { planSetCountChange, type PlannedSet } from '@/lib/workoutPlanOps';

const set = (id: string, setNumber: number, completed = false): PlannedSet => ({ id, set_number: setNumber, completed });

describe('planSetCountChange', () => {
  it('grows from no sets', () => {
    expect(planSetCountChange([], 3)).toEqual({ insertNumbers: [1, 2, 3], deleteIds: [] });
  });

  it('grows after the existing sets', () => {
    expect(planSetCountChange([set('a1', 1, true), set('a2', 2)], 4)).toEqual({ insertNumbers: [3, 4], deleteIds: [] });
  });

  it('grows after the highest number when numbers have gaps, never repeating one', () => {
    expect(planSetCountChange([set('a1', 1, true), set('a3', 3)], 4)).toEqual({ insertNumbers: [4, 5], deleteIds: [] });
  });

  it('does nothing when the count already matches', () => {
    expect(planSetCountChange([set('a1', 1), set('a2', 2)], 2)).toEqual({ insertNumbers: [], deleteIds: [] });
  });

  it('shrinks by removing unfinished sets from the top and skips finished ones', () => {
    const sets = [set('a1', 1, true), set('a2', 2), set('a3', 3, true), set('a4', 4), set('a5', 5)];
    expect(planSetCountChange(sets, 2)).toEqual({ insertNumbers: [], deleteIds: ['a5', 'a4'] });
  });

  it('deletes nothing when every extra set is finished', () => {
    const sets = [set('a1', 1), set('a2', 2), set('a3', 3, true), set('a4', 4, true)];
    expect(planSetCountChange(sets, 2)).toEqual({ insertNumbers: [], deleteIds: [] });
  });

  it('never removes an unfinished set numbered within the target', () => {
    const sets = [set('a1', 1, true), set('a2', 2), set('a3', 3, true)];
    expect(planSetCountChange(sets, 2)).toEqual({ insertNumbers: [], deleteIds: [] });
  });

  it('stops at the target count when numbers have gaps', () => {
    const sets = [set('a1', 1), set('a3', 3), set('a5', 5)];
    expect(planSetCountChange(sets, 2)).toEqual({ insertNumbers: [], deleteIds: ['a5'] });
  });

  it('handles superset partners with different counts toward the same target', () => {
    const base = [set('a1', 1, true), set('a2', 2)];
    const partner = [set('b1', 1, true), set('b2', 2, true), set('b3', 3), set('b4', 4)];
    expect(planSetCountChange(base, 3)).toEqual({ insertNumbers: [3], deleteIds: [] });
    expect(planSetCountChange(partner, 3)).toEqual({ insertNumbers: [], deleteIds: ['b4'] });
  });

  it('does not depend on input order', () => {
    const sets = [set('a4', 4), set('a1', 1, true), set('a3', 3), set('a2', 2)];
    expect(planSetCountChange(sets, 1)).toEqual({ insertNumbers: [], deleteIds: ['a4', 'a3', 'a2'] });
    expect(planSetCountChange(sets, 6)).toEqual({ insertNumbers: [5, 6], deleteIds: [] });
  });
});
