import { describe, expect, it, vi } from 'vitest';
import { createWheelSelection, drumFace } from '@/lib/wheelSelection';

describe('time wheel selection', () => {
  it('keeps an explicit minute when queued centering scrolls report an intermediate value', () => {
    const change = vi.fn();
    const wheel = createWheelSelection(28, change);
    wheel.beginGesture();
    wheel.choose(30);
    // The old smooth centering + debounce could write 28 after tapping Done.
    wheel.scroll(28);
    wheel.scroll(29);
    wheel.scroll(30);
    expect(change.mock.calls).toEqual([[30]]);
  });

  it('accepts the next user scroll immediately without a timer that can outlive Done', () => {
    const change = vi.fn();
    const wheel = createWheelSelection(28, change);
    wheel.choose(30);
    wheel.beginGesture();
    wheel.scroll(31);
    expect(change.mock.calls).toEqual([[30], [31]]);
    wheel.scroll(31);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('ignores opening layout scrolls and preserves the latest of rapid explicit taps', () => {
    const change = vi.fn();
    const wheel = createWheelSelection(28, change);
    wheel.scroll(0);
    expect(change).not.toHaveBeenCalled();
    wheel.choose(30);
    wheel.choose(32);
    wheel.scroll(30);
    expect(change.mock.calls).toEqual([[30], [32]]);
  });
});

describe('drumFace', () => {
  it('keeps the centre row flat and fully inked', () => {
    expect(drumFace(0)).toEqual({ angle: 0, opacity: 1, shift: 0 });
  });

  it('tilts rows away symmetrically and dims them with distance', () => {
    const above = drumFace(-1);
    const below = drumFace(1);
    expect(above.angle).toBeCloseTo(-below.angle);
    expect(above.opacity).toBe(below.opacity);
    expect(drumFace(2).opacity).toBeLessThan(below.opacity);
    // rows gather toward the centre as they turn, more so further out
    expect(below.shift).toBeLessThanOrEqual(0);
    expect(above.shift).toBeCloseTo(-below.shift);
    expect(drumFace(2).shift).toBeLessThan(below.shift);
  });

  it('clamps far rows and tolerates bad input', () => {
    expect(drumFace(40).angle).toBe(drumFace(3.5).angle);
    expect(drumFace(40).opacity).toBe(drumFace(3.5).opacity);
    expect(drumFace(40).opacity).toBeGreaterThan(0);
    expect(drumFace(Number.NaN)).toEqual({ angle: 0, opacity: 1, shift: 0 });
  });
});
