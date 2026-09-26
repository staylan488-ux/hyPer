import { describe, expect, it } from 'vitest';
import { lightFromOrientation, lightFromScroll, subscribeMotionLight } from '../src/lib/motionLight';

describe('motion light', () => {
  it('centres on the resting grip and follows tilt', () => {
    expect(lightFromOrientation(50, 0, 50)).toEqual({ x: 0, y: 0 });
    const tiltedRight = lightFromOrientation(50, 14, 50);
    expect(tiltedRight.x).toBeCloseTo(0.5);
    const tippedBack = lightFromOrientation(36, 0, 50);
    expect(tippedBack.y).toBeCloseTo(0.5);
  });

  it('clamps extreme angles', () => {
    expect(lightFromOrientation(0, 90, 60)).toEqual({ x: 1, y: 1 });
    expect(lightFromOrientation(120, -90, 60)).toEqual({ x: -1, y: -1 });
  });

  it('drifts gently with scroll and stays in range', () => {
    expect(lightFromScroll(0)).toEqual({ x: 0, y: 0 });
    for (const top of [100, 800, 5000]) {
      const light = lightFromScroll(top);
      expect(Math.abs(light.x)).toBeLessThanOrEqual(0.35);
      expect(Math.abs(light.y)).toBeLessThanOrEqual(0.5);
    }
  });

  it('does nothing outside a browser', () => {
    const received: unknown[] = [];
    const stop = subscribeMotionLight((light) => received.push(light));
    stop();
    expect(received).toEqual([]);
  });
});
