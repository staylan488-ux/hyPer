import { describe, expect, it } from 'vitest';

import {
  CALIBRATED_MAX_MPS,
  CALIBRATED_MIN_MPS,
  calibrateStepM,
  relativeDistanceError,
} from '@/lib/gpsCalibration';

describe('relativeDistanceError', () => {
  // the three points measured on the 400 m track
  it('reports the over-read at walking pace', () => {
    expect(relativeDistanceError(1.4)).toBeCloseTo(0.0850, 3);
  });

  it('crosses zero at the speed the raw pipeline happens to be right', () => {
    expect(relativeDistanceError(3.55)).toBeCloseTo(0, 2);
  });

  it('reports the under-read at running pace', () => {
    expect(relativeDistanceError(4.88)).toBeCloseTo(-0.0526, 3);
  });

  it('holds the correction flat outside the calibrated range', () => {
    // extrapolating to a standstill would claim a +14% error where the true
    // answer is that a stationary phone should accumulate nothing
    expect(relativeDistanceError(0)).toBe(relativeDistanceError(CALIBRATED_MIN_MPS));
    expect(relativeDistanceError(50)).toBe(relativeDistanceError(CALIBRATED_MAX_MPS));
  });

  it('is finite for nonsense input', () => {
    expect(relativeDistanceError(Number.NaN)).toBe(0);
  });
});

describe('calibrateStepM', () => {
  it('shortens a slow step, which the raw pipeline over-reads', () => {
    expect(calibrateStepM(1.4, 1.4)).toBeLessThan(1.4);
  });

  it('lengthens a fast step, which the raw pipeline under-reads', () => {
    expect(calibrateStepM(4.88, 4.88)).toBeGreaterThan(4.88);
  });

  it('turns a true 400 m lap run fast into about 400 m', () => {
    // a 4.88 m/s lap measured 385.1 m on the track
    expect(calibrateStepM(385.1, 4.88)).toBeGreaterThan(395);
    expect(calibrateStepM(385.1, 4.88)).toBeLessThan(412);
  });

  it('turns a true 400 m lap walked into about 400 m', () => {
    // a 1.34 m/s lap measured 424.2 m
    expect(calibrateStepM(424.2, 1.34)).toBeGreaterThan(385);
    expect(calibrateStepM(424.2, 1.34)).toBeLessThan(405);
  });

  it('never moves a step by more than the hard cap', () => {
    for (const v of [-5, 0, 0.1, 3, 20, 1000]) {
      const out = calibrateStepM(10, v);
      expect(out).toBeGreaterThan(10 / 1.13);
      expect(out).toBeLessThan(10 * 1.14);
    }
  });

  it('never invents distance from a zero or invalid step', () => {
    expect(calibrateStepM(0, 3)).toBe(0);
    expect(calibrateStepM(-5, 3)).toBe(0);
    expect(calibrateStepM(Number.NaN, 3)).toBe(0);
  });
});
