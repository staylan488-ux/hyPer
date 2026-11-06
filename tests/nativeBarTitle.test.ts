import { describe, expect, it } from 'vitest';

import { loadNativeModule } from './helpers/loadNativeModule';

// Train's collapsed bar names the movement being logged once the set card's
// name has gone under it (native/src/lib/barTitle.ts, used by
// native/src/app/(tabs)/train/index.tsx). The name fades while it crosses the
// bar's lower edge and the bar takes it only at 0, so under iOS 26's soft
// scroll edge the name never reads twice.

type Span = { top: number; bottom: number };
const { headingShown, LARGE_TITLE_FOLD } = loadNativeModule<{
  headingShown: (scrolled: number, heading: Span | null) => number;
  LARGE_TITLE_FOLD: number;
}>('lib/barTitle.ts', {});

// The card's name at the standard text size: the tally row (6 + 28), the
// card's margin and padding (14 + 18), then one 30 pt line of title.
const oneLine: Span = { top: 66, bottom: 96 };

describe('the card name under Train\'s collapsed bar', () => {
  it('shows in full while the large title folds and until the name meets the bar', () => {
    expect(LARGE_TITLE_FOLD).toBe(52);
    expect(headingShown(0, oneLine)).toBe(1);
    expect(headingShown(LARGE_TITLE_FOLD, oneLine)).toBe(1);
    expect(headingShown(oneLine.top + LARGE_TITLE_FOLD, oneLine)).toBe(1);
  });

  it('fades as it crosses the bar\'s lower edge and is gone once it has passed', () => {
    expect(headingShown(133, oneLine)).toBeCloseTo(0.5);
    expect(headingShown(147.5, oneLine)).toBeGreaterThan(0);
    expect(headingShown(148, oneLine)).toBe(0);
    expect(headingShown(400, oneLine)).toBe(0);
  });

  it('is still showing at the old fixed 142, where the bar already named the movement', () => {
    expect(headingShown(142, oneLine)).toBeGreaterThan(0);
  });

  it('moves with a two-line name or a larger text size', () => {
    const twoLines: Span = { top: 66, bottom: 126 };
    expect(headingShown(148, twoLines)).toBeCloseTo(0.5);
    expect(headingShown(178, twoLines)).toBe(0);
    // At an accessibility size the tally and clock stack above a taller title.
    const stacked: Span = { top: 112, bottom: 184 };
    expect(headingShown(148, stacked)).toBe(1);
    expect(headingShown(235, stacked)).toBeGreaterThan(0);
    expect(headingShown(236, stacked)).toBe(0);
  });

  it('fades the card\'s whole header block, set line and note too, before the bar names the movement', () => {
    // The name (30), the set line under it (2 + 20) and last time's note (4 + 20).
    const block: Span = { top: 66, bottom: 142 };
    expect(headingShown(block.top + LARGE_TITLE_FOLD, block)).toBe(1);
    // Where the name alone had gone, the set line and the note still show
    // under the bar, so the bar keeps the day's name a while longer.
    expect(headingShown(oneLine.bottom + LARGE_TITLE_FOLD, block)).toBeGreaterThan(0);
    expect(headingShown(block.bottom + LARGE_TITLE_FOLD - 1, block)).toBeGreaterThan(0);
    expect(headingShown(block.bottom + LARGE_TITLE_FOLD, block)).toBe(0);
    // At an accessibility size the block is taller and starts lower; the point moves with it.
    const stacked: Span = { top: 112, bottom: 312 };
    expect(headingShown(stacked.top + LARGE_TITLE_FOLD, stacked)).toBe(1);
    expect(headingShown(block.bottom + LARGE_TITLE_FOLD, stacked)).toBeGreaterThan(0.5);
    expect(headingShown(stacked.bottom + LARGE_TITLE_FOLD - 1, stacked)).toBeGreaterThan(0);
    expect(headingShown(stacked.bottom + LARGE_TITLE_FOLD, stacked)).toBe(0);
  });

  it('shows in full until the name has been measured', () => {
    expect(headingShown(0, null)).toBe(1);
    expect(headingShown(1000, null)).toBe(1);
  });
});
