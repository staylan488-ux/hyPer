import { describe, expect, it } from 'vitest';

import { savedLine } from '../native/src/lib/finished';

// The last line of the "Session complete" label (native/src/app/session-done.tsx).

describe('the session-done week line', () => {
  it('counts against the week\'s plan up to the plan', () => {
    expect(savedLine(2, 4)).toBe('Saved to History · session 2 of 4 this week');
    expect(savedLine(4, 4)).toBe('Saved to History · session 4 of 4 this week');
  });

  it('never reads more sessions than planned: past the plan it only counts', () => {
    expect(savedLine(5, 4)).toBe('Saved to History · session 5 this week');
  });

  it('only counts without a plan, and says nothing more until the count loads', () => {
    expect(savedLine(3, null)).toBe('Saved to History · session 3 this week');
    expect(savedLine(null, 4)).toBe('Saved to History');
    expect(savedLine(0, null)).toBe('Saved to History');
  });
});
