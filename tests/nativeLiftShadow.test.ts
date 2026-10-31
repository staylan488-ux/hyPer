import { describe, expect, it } from 'vitest';

import { liftShadow } from '../native/src/lib/liftShadow';

// Reanimated 4's own patterns (src/Colors.ts, src/common/utils/parsers.ts):
// its colour parser takes a number as plain decimals, never "1.6e-7".
const NUMBER = String.raw`[-+]?\d*\.?\d+`;
const RGBA = new RegExp(String.raw`^rgba\(\s*(${NUMBER})\s*,\s*(${NUMBER})\s*,\s*(${NUMBER})\s*,\s*(${NUMBER})\s*\)$`);
const SHADOW_PARTS = /(?:[^\s()]+|\([^()]*\))+/g;

/** Reads a shadow the way Reanimated does on the UI thread; throws where it would. */
function parseShadow(shadow: string) {
  const lengths: number[] = [];
  let color: RegExpExecArray | null = null;
  for (const part of shadow.match(SHADOW_PARTS) ?? []) {
    if (part.endsWith('px') || !Number.isNaN(Number(part))) lengths.push(parseFloat(part));
    else if (!(color = RGBA.exec(part))) throw new Error(`Invalid color value: ${part}`);
  }
  if (!color) throw new Error(`No colour in ${shadow}`);
  return { offsetY: lengths[1], blur: lengths[2], alpha: Number(color[4]) };
}

const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

describe('native lift shadow', () => {
  it('draws the held row as before', () => {
    expect(liftShadow(1)).toBe('0 8.00px 24.00px rgba(0, 0, 0, 0.160)');
    expect(parseShadow(liftShadow(0.5)!)).toEqual({ offsetY: 4, blur: 12, alpha: 0.08 });
  });

  it('draws no shadow at rest', () => {
    expect(liftShadow(0)).toBeUndefined();
    expect(liftShadow(-0.01)).toBeUndefined();
    expect(liftShadow(Number.NaN)).toBeUndefined();
  });

  it('stays readable as the lift comes within a millionth of 0', () => {
    // The old shadow wrote these as "9.6e-7", "1.6e-7" and "5.12e-10".
    for (const raised of [6e-6, 1e-6, 3.2e-9, 1e-12, Number.MIN_VALUE]) {
      const shadow = liftShadow(raised)!;
      expect(shadow).not.toMatch(/e/i);
      expect(() => parseShadow(shadow)).not.toThrow();
    }
  });

  it('reads on every frame of a set-down, at 60 and 120 Hz', () => {
    // The row settles over 200 ms from wherever its spring was, starting at
    // any point between two frames.
    const unreadable: string[] = [];
    for (const hz of [60, 120]) {
      const frame = 1000 / hz;
      for (let phase = 0; phase < frame; phase += 0.01) {
        for (let t = phase; t < 200; t += frame) {
          const shadow = liftShadow(1.12 * (1 - easeInOutQuad(t / 200)));
          try {
            if (shadow) parseShadow(shadow);
          } catch {
            unreadable.push(`${hz} Hz: ${shadow}`);
          }
        }
      }
    }
    expect(unreadable).toEqual([]);
  });
});
