import { describe, expect, it } from 'vitest';

import { nativeRestTimerID } from '@/lib/nativeRestTimer';

describe('native rest timer identifiers', () => {
  it('keeps UUID-style identifiers stable', () => {
    expect(nativeRestTimerID('workout-123')).toBe('workout-123');
  });

  it('removes characters that are unsafe in native notification identifiers', () => {
    expect(nativeRestTimerID('workout/one:two')).toBe('workout_one_two');
  });
});

