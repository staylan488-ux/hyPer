import { describe, expect, it } from 'vitest';

import { createDeviceMotionDetector } from '@/lib/deviceMotion';

describe('device motion detector', () => {
  it('starts stationary', () => {
    expect(createDeviceMotionDetector().isMoving(0)).toBe(false);
  });

  it('recognizes sustained walking-like acceleration', () => {
    const detector = createDeviceMotionDetector();
    for (let i = 0; i < 200; i++) {
      const t = i * 20;
      detector.add(t, { x: 1.4 * Math.sin((2 * Math.PI * t) / 650), y: 0.2, z: 0.1 }, null);
    }

    expect(detector.isMoving(4000)).toBe(true);
  });

  it('does not classify quiet sensor noise as movement', () => {
    const detector = createDeviceMotionDetector();
    for (let i = 0; i < 200; i++) {
      detector.add(i * 20, { x: 0.04 * Math.sin(i), y: 0.03, z: 0.02 }, null);
    }

    expect(detector.isMoving(4000)).toBe(false);
  });

  it('lets a brief phone movement expire instead of latching indefinitely', () => {
    const detector = createDeviceMotionDetector();
    for (let i = 0; i < 40; i++) {
      detector.add(i * 20, { x: i < 20 ? 1.2 : 0.02, y: 0, z: 0 }, null);
    }

    expect(detector.isMoving(3500)).toBe(false);
  });

  it('subtracts gravity when only accelerationIncludingGravity is available', () => {
    const detector = createDeviceMotionDetector();
    for (let i = 0; i < 200; i++) {
      const t = i * 20;
      detector.add(t, null, {
        x: 1.2 * Math.sin((2 * Math.PI * t) / 650),
        y: 0.1,
        z: 9.81,
      });
    }

    expect(detector.isMoving(4000)).toBe(true);
  });
});
