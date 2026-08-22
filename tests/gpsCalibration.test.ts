import { describe, expect, it } from 'vitest';

import {
  DIFFERENTIAL_NOISE_FRACTION,
  MAX_STEP_NOISE_M,
  denoiseStepM,
} from '@/lib/gpsCalibration';

describe('denoiseStepM', () => {
  it('leaves a long step essentially untouched', () => {
    // at running pace the step dwarfs the noise, so almost nothing is removed
    const out = denoiseStepM(5, 3.5, 3.5);
    expect(out).toBeGreaterThan(4.9);
    expect(out).toBeLessThan(5);
  });

  it('takes a meaningful bite out of a walking-pace step', () => {
    // this is the +7% over-read the 400 m track exposed
    const out = denoiseStepM(1.4, 3.5, 3.5);
    expect(out).toBeLessThan(1.4);
    expect(out).toBeGreaterThan(1.1);
  });

  it('collapses to zero when movement is indistinguishable from noise', () => {
    expect(denoiseStepM(0.4, 3.5, 3.5)).toBe(0);
  });

  it('degrades smoothly rather than cliff-edging', () => {
    // the old hard floor credited a step just above it IN FULL; this must not
    let previous = 0;
    for (const step of [0.6, 0.8, 1.0, 1.5, 2.0, 3.0]) {
      const out = denoiseStepM(step, 3.5, 3.5);
      expect(out).toBeGreaterThanOrEqual(previous);
      expect(out).toBeLessThanOrEqual(step);
      previous = out;
    }
  });

  it('never removes more than the absolute cap, however bad the fix claims to be', () => {
    // a 30 m fix would otherwise erase walking entirely under tree cover
    const out = denoiseStepM(3, 30, 30);
    expect(out).toBeGreaterThan(Math.sqrt(9 - MAX_STEP_NOISE_M ** 2) - 0.001);
  });

  it('scales the noise with the reported accuracy, below the cap', () => {
    const clean = denoiseStepM(3, 2, 2);
    const murky = denoiseStepM(3, 5, 5);
    expect(clean).toBeGreaterThan(murky);
  });

  it('never invents distance from a zero or invalid step', () => {
    expect(denoiseStepM(0, 3, 3)).toBe(0);
    expect(denoiseStepM(-4, 3, 3)).toBe(0);
    expect(denoiseStepM(Number.NaN, 3, 3)).toBe(0);
  });

  it('tolerates a missing previous accuracy', () => {
    expect(Number.isFinite(denoiseStepM(3, Number.NaN, 4))).toBe(true);
  });

  it('keeps the calibrated fraction where the track measured it', () => {
    // 0.14 zeroes the bias at BOTH ends of the speed range; changing it
    // reintroduces the speed-dependent error this exists to remove
    expect(DIFFERENTIAL_NOISE_FRACTION).toBeCloseTo(0.14, 5);
  });
});
