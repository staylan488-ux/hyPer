import { describe, expect, it } from 'vitest';

import { clampInt, resolveRepDraft, resolveSetRangeDraft } from '@/lib/setRangeDraft';

const current = { target_sets_min: 2, target_sets: 3, target_sets_max: 4 };
const draft = { minSets: '2', targetSets: '3', maxSets: '4' };

describe('setRangeDraft', () => {
  it('clampInt falls back on empty or unparsable input and rounds into range', () => {
    expect(clampInt('', 1, 10, 3)).toBe(3);
    expect(clampInt('abc', 1, 10, 3)).toBe(3);
    expect(clampInt('4.6', 1, 10, 3)).toBe(5);
  });

  it('keeps the current value when a set cell is cleared', () => {
    expect(resolveSetRangeDraft({ ...draft, targetSets: '' }, current)).toEqual(current);
    expect(resolveSetRangeDraft({ ...draft, maxSets: '' }, current)).toEqual(current);
  });

  it('clamps set cells to 1..10', () => {
    expect(resolveSetRangeDraft({ ...draft, minSets: '0' }, current)).toEqual({ target_sets_min: 1, target_sets: 3, target_sets_max: 4 });
    expect(resolveSetRangeDraft({ ...draft, maxSets: '14' }, current)).toEqual({ target_sets_min: 2, target_sets: 3, target_sets_max: 10 });
  });

  it('swaps a min above the max', () => {
    expect(resolveSetRangeDraft({ ...draft, minSets: '6' }, current)).toEqual({ target_sets_min: 4, target_sets: 4, target_sets_max: 6 });
  });

  it('pulls a target outside min..max back inside', () => {
    expect(resolveSetRangeDraft({ ...draft, targetSets: '9' }, current)).toEqual({ target_sets_min: 2, target_sets: 4, target_sets_max: 4 });
    expect(resolveSetRangeDraft({ ...draft, targetSets: '1' }, current)).toEqual({ target_sets_min: 2, target_sets: 2, target_sets_max: 4 });
  });

  it('raising only the max leaves min and target alone (2/3/4 -> max 5 gives 2/3/5)', () => {
    expect(resolveSetRangeDraft({ ...draft, maxSets: '5' }, current)).toEqual({ target_sets_min: 2, target_sets: 3, target_sets_max: 5 });
  });

  it('clamps rep cells to 1..100 and falls back when cleared', () => {
    expect(resolveRepDraft('', 8)).toBe(8);
    expect(resolveRepDraft('0', 8)).toBe(1);
    expect(resolveRepDraft('150', 8)).toBe(100);
    expect(resolveRepDraft('12', 8)).toBe(12);
  });
});
