import { describe, expect, it } from 'vitest';

import { figureFrame, figureValue, rollSpring, rollsDown } from '../native/src/lib/rollingFigure';

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

  it('pins a big figure in its short line to the bottom, as React Native draws it', () => {
    // Fuel's 88 pt figure in a 95 pt line, Today's 68 in 73, the rest time's 84 in 91.
    expect(figureFrame(undefined, 88, 95)).toBe('bottomLeading');
    expect(figureFrame(undefined, 68, 73)).toBe('bottomLeading');
    expect(figureFrame('center', 84, 91)).toBe('bottom');
    // The program stepper's 24 pt in 26.
    expect(figureFrame('center', 24, 26)).toBe('bottom');
  });

  it('centres text in a line at least the font tall, and keeps the side it aligns to', () => {
    expect(figureFrame(undefined, 17, 22)).toBe('leading');
    expect(figureFrame('center', 17, 22)).toBe('center');
    // A value before "/ 180 g" keeps its right edge as it gains or loses a digit.
    expect(figureFrame('right', 15, 20)).toBe('trailing');
    // No line height set: the font's own, centred like React Native's.
    expect(figureFrame(undefined, 40, undefined)).toBe('leading');
  });

  it("matches SwiftUI's smooth spring, with no bounce", () => {
    const spring = rollSpring(0.42);
    expect(spring.stiffness).toBeCloseTo(223.8, 1);
    expect(spring.damping).toBeCloseTo(29.92, 2);
    // Critically damped: damping² = 4 × stiffness × mass.
    expect(spring.damping ** 2).toBeCloseTo(4 * spring.stiffness * spring.mass, 6);
  });
});
