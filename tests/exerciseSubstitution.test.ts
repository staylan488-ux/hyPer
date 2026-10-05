import { describe, expect, it } from 'vitest';

import { parseExerciseSubstitution, planExerciseSubstitution, withoutSubstitution } from '@/lib/exerciseSubstitution';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import type { FlexiblePlanItem } from '@/types';

const set = (exercise_id: string, set_number: number, completed = false) => ({ exercise_id, set_number, completed });
const pulldown: FlexiblePlanItem = {
  exercise_id: 'pulldown', exercise_name: 'Lat Pulldown', order: 1, target_sets: 3, target_reps_min: 10, target_reps_max: 12,
  notes: 'Wide grip\n[set-range]{"min":3,"max":4}', hidden: false, superset_group_id: null,
};
const items: FlexiblePlanItem[] = [
  { exercise_id: 'bench', exercise_name: 'Bench Press', order: 0, target_sets: 4 },
  pulldown,
  { exercise_id: 'curl', exercise_name: 'Curl', order: 2, target_sets: 3 },
];
const pullUp = { id: 'pullup', name: 'Pull-Up' };
const chinUp = { id: 'chinup', name: 'Chin-Up' };
const pulldownSets = [set('pulldown', 1), set('pulldown', 2), set('pulldown', 3)];

describe('planExerciseSubstitution', () => {
  it('puts the replacement in the same place with the remaining sets and rep target', () => {
    const plan = planExerciseSubstitution({ items, sets: pulldownSets, sourceId: 'pulldown', replacement: pullUp, splitSession: true });

    expect(plan.items.map((item) => item.exercise_id)).toEqual(['bench', 'pullup', 'curl']);
    expect(plan.items.map((item) => item.order)).toEqual([0, 1, 2]);
    expect(plan.items[1]).toMatchObject({ exercise_name: 'Pull-Up', target_sets: 3, target_reps_min: 10, target_reps_max: 12 });
    expect(plan.items[1].substitutes_for).toEqual({ exercise_id: 'pulldown', exercise_name: 'Lat Pulldown', notes: pulldown.notes });
    expect(plan.setNumbers).toEqual([1, 2, 3]);
    expect(plan.switchingBack).toBe(false);
  });

  it('drops the program cue but keeps the set count adjustable in a split session', () => {
    const plan = planExerciseSubstitution({
      items, sets: [set('pulldown', 1, true), set('pulldown', 2)], sourceId: 'pulldown', replacement: pullUp, splitSession: true,
    });
    const range = parseSetRangeNotes(plan.items[2].notes, plan.items[2].target_sets ?? 1);

    expect(range).toEqual({ minSets: 1, targetSets: 1, maxSets: 10, baseNotes: null });
    expect(planExerciseSubstitution({ items, sets: pulldownSets, sourceId: 'pulldown', replacement: pullUp, splitSession: false }).items[1].notes).toBeNull();
  });

  it('keeps finished sets on the original and moves its superset to the replacement', () => {
    const paired = items.map((item) => (item.exercise_id === 'pulldown' || item.exercise_id === 'curl' ? { ...item, superset_group_id: 'pair' } : item));
    const plan = planExerciseSubstitution({
      items: paired, sets: [set('pulldown', 1, true), set('pulldown', 2), set('pulldown', 3)], sourceId: 'pulldown', replacement: pullUp, splitSession: true,
    });

    expect(plan.items.map((item) => [item.exercise_id, item.target_sets, item.superset_group_id])).toEqual([
      ['bench', 4, undefined], ['pulldown', 1, null], ['pullup', 2, 'pair'], ['curl', 3, 'pair'],
    ]);
    expect(plan.items[1]).not.toHaveProperty('substitutes_for');
    // Rounds stay paired with the partner: the replacement continues at round 2.
    expect(plan.setNumbers).toEqual([2, 3]);
  });

  it('starts a standalone replacement from set 1 against its own history', () => {
    const plan = planExerciseSubstitution({
      items, sets: [set('pulldown', 1, true), set('pulldown', 2), set('pulldown', 3)], sourceId: 'pulldown', replacement: pullUp, splitSession: true,
    });
    expect(plan.setNumbers).toEqual([1, 2]);
  });

  it('keeps pointing at the planned movement when a swap is swapped again', () => {
    const first = planExerciseSubstitution({ items, sets: pulldownSets, sourceId: 'pulldown', replacement: pullUp, splitSession: true });
    const second = planExerciseSubstitution({
      items: first.items, sets: [set('pullup', 1, true), set('pullup', 2)], sourceId: 'pullup', replacement: chinUp, splitSession: true,
    });

    expect(second.items.map((item) => [item.exercise_id, item.target_sets, item.substitutes_for?.exercise_id])).toEqual([
      ['bench', 4, undefined], ['pullup', 1, 'pulldown'], ['chinup', 1, 'pulldown'], ['curl', 3, undefined],
    ]);
  });

  it('switches back when the planned movement is chosen, restoring its notes', () => {
    const swapped = planExerciseSubstitution({ items, sets: pulldownSets, sourceId: 'pulldown', replacement: pullUp, splitSession: true });
    const back = planExerciseSubstitution({
      items: swapped.items, sets: [set('pullup', 1), set('pullup', 2)], sourceId: 'pullup',
      replacement: { id: 'pulldown', name: 'Lat Pulldown' }, splitSession: true,
    });

    expect(back.switchingBack).toBe(true);
    // The program's 3–4 set range widens to admit the 2 sets left.
    expect(back.items[1]).toEqual({ ...pulldown, target_sets: 2, notes: 'Wide grip\n[set-range]{"min":2,"max":4}' });
    expect(parseSetRangeNotes(back.items[1].notes, 2)).toMatchObject({ minSets: 2, targetSets: 2, maxSets: 4 });
    expect(back.setNumbers).toEqual([1, 2]);
  });

  it('rejoins sets the planned movement already finished, numbering after them', () => {
    const sets = [set('pulldown', 1, true), set('pulldown', 2, true), set('pullup', 1)];
    const swapped = planExerciseSubstitution({
      items, sets: [set('pulldown', 1, true), set('pulldown', 2, true), set('pulldown', 3)], sourceId: 'pulldown', replacement: pullUp, splitSession: true,
    });
    const back = planExerciseSubstitution({ items: swapped.items, sets, sourceId: 'pullup', replacement: { id: 'pulldown', name: 'Lat Pulldown' }, splitSession: true });

    expect(back.items.map((item) => [item.exercise_id, item.target_sets])).toEqual([['bench', 4], ['pulldown', 3], ['curl', 3]]);
    expect(back.setNumbers).toEqual([3]);
  });

  it('refuses an exercise already in the workout unless it is the planned one', () => {
    expect(() => planExerciseSubstitution({
      items, sets: [...pulldownSets, set('curl', 1)], sourceId: 'pulldown', replacement: { id: 'curl', name: 'Curl' }, splitSession: true,
    })).toThrow('already in this workout');
    expect(() => planExerciseSubstitution({
      items, sets: [set('pulldown', 1, true)], sourceId: 'pulldown', replacement: pullUp, splitSession: true,
    })).toThrow('no remaining sets');
  });

  it('replaces a removed copy of the replacement and covers a movement missing from the plan', () => {
    const withRemoved = [...items, { exercise_id: 'pullup', order: 3, hidden: true }];
    expect(planExerciseSubstitution({ items: withRemoved, sets: pulldownSets, sourceId: 'pulldown', replacement: pullUp, splitSession: false })
      .items.filter((item) => item.exercise_id === 'pullup')).toEqual([expect.objectContaining({ hidden: false, order: 1 })]);

    const unplanned = planExerciseSubstitution({
      items: [], sets: [set('row', 1)], sourceId: 'row', sourceName: 'Barbell Row', replacement: pullUp, splitSession: false,
    });
    expect(unplanned.items).toEqual([expect.objectContaining({
      exercise_id: 'pullup', order: 0, target_sets: 1, substitutes_for: { exercise_id: 'row', exercise_name: 'Barbell Row', notes: null },
    })]);
  });
});

describe('swap markers', () => {
  it('reads stored markers defensively', () => {
    expect(parseExerciseSubstitution({ exercise_id: 'a', exercise_name: 'A', notes: 'cue' })).toEqual({ exercise_id: 'a', exercise_name: 'A', notes: 'cue' });
    expect(parseExerciseSubstitution({ exercise_id: 'a', exercise_name: 4 })).toEqual({ exercise_id: 'a', exercise_name: null, notes: null });
    expect(parseExerciseSubstitution({ exercise_id: '' })).toBeNull();
    expect(parseExerciseSubstitution('a')).toBeNull();
    expect(parseExerciseSubstitution(null)).toBeNull();
  });

  it('strips the marker without touching the rest of the item', () => {
    expect(withoutSubstitution({ ...pulldown, substitutes_for: { exercise_id: 'x', exercise_name: null } })).toEqual(pulldown);
  });
});
