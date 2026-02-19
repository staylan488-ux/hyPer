import { describe, expect, it } from 'vitest';

import {
  normalizeSetRange,
  parseSetRangeNotes,
  serializeSetRangeNotes,
} from '@/lib/setRangeNotes';

describe('setRangeNotes', () => {
  it('normalizes and clamps min/target/max into a valid range', () => {
    expect(normalizeSetRange(6, 2, 4)).toEqual({
      minSets: 4,
      targetSets: 4,
      maxSets: 6,
    });

    expect(normalizeSetRange(-10, 30, NaN)).toEqual({
      minSets: 1,
      targetSets: 10,
      maxSets: 10,
    });
  });

  it('parses metadata and strips tagged lines from base notes', () => {
    const parsed = parseSetRangeNotes('Top set focus\n[set-range]{"min":2,"max":5}', 3);

    expect(parsed.minSets).toBe(2);
    expect(parsed.targetSets).toBe(3);
    expect(parsed.maxSets).toBe(5);
    expect(parsed.baseNotes).toBe('Top set focus');
  });

  it('falls back to target sets when metadata is missing or malformed', () => {
    expect(parseSetRangeNotes('Keep tempo strict', 4)).toEqual({
      minSets: 4,
      targetSets: 4,
      maxSets: 4,
      baseNotes: 'Keep tempo strict',
    });

    expect(parseSetRangeNotes('[set-range]{bad-json}', 4)).toEqual({
      minSets: 4,
      targetSets: 4,
      maxSets: 4,
      baseNotes: null,
    });
  });

  it('serializes metadata only when range differs from target', () => {
    expect(serializeSetRangeNotes('Pause reps', 3, 3, 3)).toBe('Pause reps');

    expect(serializeSetRangeNotes('Pause reps', 2, 3, 4)).toBe('Pause reps\n[set-range]{"min":2,"max":4}');
    expect(serializeSetRangeNotes('[set-range]{"min":1,"max":6}', 2, 4, 5)).toBe('[set-range]{"min":2,"max":5}');
  });
});
