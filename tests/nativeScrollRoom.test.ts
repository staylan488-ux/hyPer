import { describe, expect, it } from 'vitest';

import { MIN_TRAVEL, scrollRoomExtra } from '../native/src/lib/scrollRoom';

// Sizes measured in the iOS 26.5 simulator during a workout: 168 points covered
// at the top, 139 at the bottom (tab bar plus workout accessory).
const iPhone17Pro = { viewport: 874, endSpace: 48, insetTop: 168, insetBottom: 139 };
const iPhone17ProMax = { ...iPhone17Pro, viewport: 956 };

describe('native tab page scroll room', () => {
  it('tops up a short workout page, which made the tab bar stick', () => {
    // Natural travel 129 points: iOS shrank the bar but would not bring it back.
    const extra = scrollRoomExtra({ ...iPhone17Pro, content: 648.3 });
    expect(extra).toBe(71);
  });

  it('tops up Today mid-workout, which never shrank the bar', () => {
    const extra = scrollRoomExtra({ ...iPhone17Pro, content: 613.7 });
    expect(Math.round(613.7 + 48 + extra - (874 - 168 - 139))).toBeGreaterThanOrEqual(MIN_TRAVEL);
  });

  it('leaves a page alone when it barely scrolls', () => {
    // Today on the larger screen scrolls 13 points: it counts as fitting.
    expect(scrollRoomExtra({ ...iPhone17ProMax, content: 613.7 })).toBe(0);
  });

  it('leaves long pages and unmeasured pages alone', () => {
    expect(scrollRoomExtra({ ...iPhone17Pro, content: 1400 })).toBe(0);
    expect(scrollRoomExtra({ ...iPhone17Pro, viewport: 0, content: 648.3 })).toBe(0);
    expect(scrollRoomExtra({ ...iPhone17Pro, content: 0 })).toBe(0);
  });
});
