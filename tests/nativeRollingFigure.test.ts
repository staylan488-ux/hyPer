import { describe, expect, it } from 'vitest';

import { figureAlignment, figureValue, rollsDown } from '../native/src/lib/rollingFigure';

describe('native rolling figures', () => {
  it('reads the number in calories, clocks and set counts', () => {
    expect(figureValue('1,240')).toBe(1240);
    expect(figureValue('1:05')).toBe(105);
    expect(figureValue('4 sets')).toBe(4);
    expect(figureValue('–')).toBeNaN();
  });

  it('rolls down only when the number shrinks', () => {
    expect(rollsDown('1:00', '0:59')).toBe(true);
    expect(rollsDown('10:00', '9:59')).toBe(true);
    expect(rollsDown('1,240', '1,640')).toBe(false);
    // A figure arriving once the day loads rolls up.
    expect(rollsDown('–', '1,240')).toBe(false);
    expect(rollsDown('1,240', '–')).toBe(false);
  });

  it('centres the copy in its line and keeps the side the text aligns to', () => {
    // Measured in the simulator: React Native centres a big figure's glyphs
    // in its short line too, so a bottom-pinned copy sat 4 to 5 points low.
    expect(figureAlignment(undefined)).toBe('leading');
    expect(figureAlignment('center')).toBe('center');
    // A value before "/ 180 g" keeps its right edge as it gains or loses a digit.
    expect(figureAlignment('right')).toBe('trailing');
  });
});
