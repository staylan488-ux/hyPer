import { describe, expect, it } from 'vitest';

import { parseWorkoutNotes, sanitizeMovementNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';

describe('workoutNotes helpers', () => {
  it('parses legacy raw text notes', () => {
    const parsed = parseWorkoutNotes('keep elbows tucked');
    expect(parsed.movementNotes).toEqual({});
    expect(parsed.legacyNote).toBe('keep elbows tucked');
  });

  it('parses structured movement notes payload', () => {
    const parsed = parseWorkoutNotes(JSON.stringify({
      movementNotes: {
        'exercise-1': 'Stay tight',
        'exercise-2': '  Pause at top  ',
      },
      legacyNote: 'whole workout note',
    }));

    expect(parsed.movementNotes).toEqual({
      'exercise-1': 'Stay tight',
      'exercise-2': 'Pause at top',
    });
    expect(parsed.legacyNote).toBe('whole workout note');
  });

  it('sanitizes movement notes and drops blank entries', () => {
    const next = sanitizeMovementNotes({
      'exercise-1': '  ',
      'exercise-2': 'x'.repeat(260),
      'exercise-3': 'Cue',
      ignored: 42,
    });

    expect(next['exercise-1']).toBeUndefined();
    expect(next['exercise-3']).toBe('Cue');
    expect(next['exercise-2']).toHaveLength(200);
  });

  it('supports serialize/parse round-trip', () => {
    const serialized = serializeWorkoutNotes(
      { 'exercise-1': 'Drive elbows down', 'exercise-2': '  ' },
      'global note'
    );

    const parsed = parseWorkoutNotes(serialized);

    expect(parsed.movementNotes).toEqual({
      'exercise-1': 'Drive elbows down',
    });
    expect(parsed.legacyNote).toBe('global note');
  });
});
