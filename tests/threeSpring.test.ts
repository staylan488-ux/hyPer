import { describe, expect, it } from 'vitest';
import { stepSpring } from '../src/lib/three/spring';

describe('3D spring', () => {
  it('settles on its target without overshooting far', () => {
    const state = { value: 0, velocity: 0 };
    let peak = 0;
    let frames = 0;
    while (stepSpring(state, 1, 1 / 60) && frames < 600) {
      peak = Math.max(peak, state.value);
      frames += 1;
    }
    expect(state.value).toBe(1);
    expect(state.velocity).toBe(0);
    expect(peak).toBeLessThan(1.02);
    expect(frames).toBeLessThan(120);
  });

  it('carries a thrown velocity before returning', () => {
    const state = { value: 0, velocity: 6 };
    stepSpring(state, 0, 1 / 60);
    expect(state.value).toBeGreaterThan(0);
  });
});
