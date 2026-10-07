import { describe, expect, it } from 'vitest';
import {
  REST_END_AIR,
  REST_END_SLACK,
  REST_NUDGE_LIMIT,
  restingScrollEndAt,
  restNudgeTarget,
  splitCost,
  splitDepth,
  straddleCount,
  straddlesBand,
  type RestBand,
} from '../src/lib/titleSnap';

// The band as PageTitle draws it under a 62pt status bar: solid to 102, ramp to 126.
const band: RestBand = { solid: 102, foot: 126 };
const range = { min: 73, max: 2000 };

describe('rest nudge: what counts as split', () => {
  it('counts a block in the ramp, not one hidden under the solid stage or clear of the ramp', () => {
    // At scroll 0 a block's column offsets are its viewport offsets.
    expect(straddlesBand({ top: 107, bottom: 159 }, 0, band)).toBe(true); // Fuel's Log food pill, top 19pt in the ramp
    expect(straddlesBand({ top: 40, bottom: 105 }, 0, band)).toBe(false); // ink ends 3pt into the ramp: hidden
    expect(straddlesBand({ top: 124, bottom: 176 }, 0, band)).toBe(false); // starts 2pt above the foot: clear
    expect(straddlesBand({ top: 107, bottom: 159 }, 57, band)).toBe(false); // scrolled 57 further: wholly under the solid stage
  });

  it('lets a tall figure pass under the bar unless only a sliver of it shows', () => {
    const figure = { top: 0, bottom: 264 };
    // Feet only: 10pt below the ramp.
    expect(straddlesBand(figure, 128, band)).toBe(true);
    // Shins and feet with the rest under the bar: 60pt below the ramp.
    expect(straddlesBand(figure, 78, band)).toBe(false);
    expect(splitDepth(figure, 128, band)).toBeGreaterThan(0);
  });

  it('grades how far a split block is from a clean rest', () => {
    expect(splitDepth({ top: 107, bottom: 159 }, 0, band)).toBeCloseTo(16); // 16pt from clearing the ramp
    expect(splitDepth({ top: 60, bottom: 112 }, 0, band)).toBeCloseTo(6); // 6pt from hiding
    expect(splitCost([{ top: 107, bottom: 159 }, { top: 60, bottom: 112 }], 0, band)).toBeCloseTo(22);
    expect(straddleCount([{ top: 107, bottom: 159 }, { top: 200, bottom: 240 }], 0, band)).toBe(1);
  });
});

describe('rest nudge: where a resting page moves', () => {
  it('clears or hides a split block with the shortest move', () => {
    // The Log food pill 19pt into the ramp: 16pt up clears it; hiding needs 53pt.
    const pill = { top: 487, bottom: 539 };
    expect(restNudgeTarget(380, [pill], band, range)).toBe(364);
    // Mostly hidden already: 12pt down hides it.
    expect(restNudgeTarget(380, [{ top: 440, bottom: 498 }], band, range)).toBe(392);
  });

  it('keeps the page where no block is split', () => {
    expect(restNudgeTarget(380, [{ top: 300, bottom: 470 - 30 }, { top: 520, bottom: 560 }], band, range)).toBeNull();
  });

  it('finds the rest that leaves every block clean, not just the first', () => {
    // A figure row (84pt ring) and the pill 20pt below it: clearing the pill
    // alone would split the ring, so the page goes the other way.
    const ring = { top: 404, bottom: 488 };
    const pill = { top: 508, bottom: 560 };
    const target = restNudgeTarget(400, [ring, pill], band, range)!;
    expect(straddleCount([ring, pill], target, band)).toBe(0);
    expect(Math.abs(target - 400)).toBeLessThanOrEqual(REST_NUDGE_LIMIT);
  });

  it('moves at most the limit, and only for a real improvement', () => {
    // A block that needs 50pt either way stays put.
    expect(restNudgeTarget(400, [{ top: 450, bottom: 610 - 0 }], band, range)).toBeNull();
    // Rows 11pt apart can never both be clean: trading one split for another stays put.
    const rows = [{ top: 470, bottom: 515 }, { top: 526, bottom: 571 }];
    const target = restNudgeTarget(400, rows, band, range);
    if (target !== null) expect(splitCost(rows, target, band)).toBeLessThan(splitCost(rows, 400, band) - 2);
  });

  it('never moves the title out of its collapsed rest or past the end', () => {
    // Clearing would mean scrolling above the collapse (73): it hides instead, or stays.
    const target = restNudgeTarget(80, [{ top: 190, bottom: 214 }], band, range);
    expect(target === null || target >= range.min).toBe(true);
    // At the end, hiding is out of reach; clearing (12pt up) is the move.
    expect(restNudgeTarget(500, [{ top: 611, bottom: 660 }], band, { min: 73, max: 500 })).toBe(488);
  });
});

describe('resting scroll end: one bottom inset', () => {
  // The tab bar's top sits 729pt below the viewport's top.
  const barTop = 729;

  it('ends with the last ink 24pt above the tab bar, whatever padding the last row has', () => {
    // Last ink at column 1200: the end puts it at 729 − 24 = 705.
    expect(restingScrollEndAt(1200, barTop, [{ top: 1180, bottom: 1200 }], band)).toBe(1200 - (barTop - REST_END_AIR));
  });

  it('grows by a few pt at most to end with a clean band', () => {
    // At the plain end (495) this line ends 7pt into the ramp; 7pt more hides it.
    const line = { top: 590, bottom: 608 };
    const plain = 1200 - (barTop - REST_END_AIR);
    expect(straddleCount([line], plain, band)).toBe(1);
    const end = restingScrollEndAt(1200, barTop, [line, { top: 1180, bottom: 1200 }], band);
    expect(end).toBeGreaterThan(plain);
    expect(end - plain).toBeLessThanOrEqual(REST_END_SLACK);
    expect(straddleCount([line], end, band)).toBe(0);
  });

  it('keeps the plain end for a page too short to collapse its title, or with no clean end in reach', () => {
    expect(restingScrollEndAt(700, barTop, [{ top: 680, bottom: 700 }], band, 73)).toBe(700 - 705);
    // A 300pt block can be neither hidden nor cleared within a few pt.
    const tall = { top: 560, bottom: 860 };
    expect(restingScrollEndAt(1200, barTop, [tall], band)).toBe(495);
  });
});

describe('rest units: a figure that travels with its legend', () => {
  // Progress: readout, front/back figures and the legend as one block, which
  // may pass under the bar only while 112pt of it still shows.
  const unit = { top: 0, bottom: 360, sliver: 112 };

  it('counts the legend resting alone under the bar as split', () => {
    // Only the legend's 64pt shows below the ramp: split.
    expect(straddlesBand(unit, 360 - 126 - 64, band)).toBe(true);
    // The legend with the figures' legs above it: a clean rest.
    expect(straddlesBand(unit, 360 - 126 - 140, band)).toBe(false);
    // Wholly under the solid stage: clean.
    expect(straddlesBand(unit, 360 - 102, band)).toBe(false);
  });

  it('may move past the usual limit to a clean rest, at most half its split stretch', () => {
    // Legend alone (64pt showing): 48pt back shows the legs, 66pt on hides it.
    const at = 360 - 126 - 64;
    const target = restNudgeTarget(at, [unit], band, range);
    expect(target).not.toBeNull();
    expect(Math.abs((target as number) - at)).toBeGreaterThan(REST_NUDGE_LIMIT);
    expect(Math.abs((target as number) - at)).toBeLessThanOrEqual(Math.ceil((band.foot - band.solid + unit.sliver) / 2) + 1);
    expect(straddlesBand(unit, target as number, band)).toBe(false);
  });

  it('leaves ordinary blocks to the usual limit', () => {
    expect(restNudgeTarget(400, [{ top: 450, bottom: 610 }], band, range)).toBeNull();
  });
});
