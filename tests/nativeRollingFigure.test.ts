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

  it('sits a big figure on the bottom of its short line, and centres ordinary text', () => {
    // Fuel's figure: 88 pt on a 95 pt line, shorter than SF's own 105.
    expect(figureAlignment(88, Math.round(88 * 1.08), undefined)).toBe('bottomLeading');
    // The program stepper's centred count.
    expect(figureAlignment(24, Math.round(24 * 1.08), 'center')).toBe('bottom');
    // Body text on a 22 pt line, taller than SF's 20.3.
    expect(figureAlignment(17, 22, undefined)).toBe('leading');
    expect(figureAlignment(15, undefined, 'right')).toBe('trailing');
  });
});
