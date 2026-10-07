import { describe, expect, it } from 'vitest';
import { titleSnapTarget } from '../src/lib/titleSnap';
import { mavLabelPlacement } from '../src/lib/landmarkLabels';
import { calendarMonthLabel } from '../src/lib/calendarLabel';

describe('large-title settling', () => {
  it('settles a half-collapsed title to the nearer end', () => {
    expect(titleSnapTarget(20, 70, 900)).toBe(0);
    expect(titleSnapTarget(34.9, 70, 900)).toBe(0);
    expect(titleSnapTarget(36, 70, 900)).toBe(70);
    // The Log food case: a page parked 53pt down collapses fully.
    expect(titleSnapTarget(53, 70, 900)).toBe(70);
  });

  it('leaves settled pages alone', () => {
    expect(titleSnapTarget(0, 70, 900)).toBeNull();
    expect(titleSnapTarget(-12, 70, 900)).toBeNull();
    expect(titleSnapTarget(69.8, 70, 900)).toBeNull();
    expect(titleSnapTarget(380, 70, 900)).toBeNull();
    expect(titleSnapTarget(10, 70, 0)).toBeNull();
  });

  it('settles a short page at one of its own ends', () => {
    expect(titleSnapTarget(4, 70, 12)).toBe(0);
    expect(titleSnapTarget(8, 70, 12)).toBe(12);
    expect(titleSnapTarget(12, 70, 12)).toBeNull();
  });
});

describe('landmark labels', () => {
  const rail = (scaleMax: number) => (value: number) => Math.min(1, value / scaleMax);

  it('keeps the MAV range by sliding it clear of its neighbours', () => {
    // Back: MEV 12, MAV 14–20, MRV 25 on a 354px rail.
    const placed = mavLabelPlacement({ mev: 12, mavLow: 14, mavHigh: 20, mrv: 25, share: rail(30), rail: 354 });
    expect(placed?.text).toBe('MAV 14–20');
    const half = 'MAV 14–20'.length * 6.6 / 2;
    const mevRight = 0.4 * 354 + 'MEV 12'.length * 6.6 / 2;
    expect(placed!.x - half).toBeGreaterThanOrEqual(mevRight + 8 - 0.01);
  });

  it('falls back to MAV, then drops the name, when there is no room', () => {
    expect(mavLabelPlacement({ mev: 8, mavLow: 9, mavHigh: 11, mrv: 13, share: rail(20), rail: 330 })?.text).toBe('MAV');
    expect(mavLabelPlacement({ mev: 12, mavLow: 13, mavHigh: 14, mrv: 15, share: rail(18), rail: 120 })).toBeNull();
  });
});

describe('calendar header', () => {
  it('names the month, and the year only when it is not this year', () => {
    const today = new Date(2026, 9, 7);
    expect(calendarMonthLabel(new Date(2026, 9, 1), today)).toBe('October');
    expect(calendarMonthLabel(new Date(2025, 11, 1), today)).toBe('December 2025');
  });
});
