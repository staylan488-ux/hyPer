import { describe, expect, it } from 'vitest';
import {
  REST_BAR_CLEAR,
  REST_GAP,
  REST_PAGE_NUDGE_LIMIT,
  barDepth,
  restNudgeTarget,
  straddleCount,
  straddlesBand,
  type RestBand,
  type RestBar,
} from '../src/lib/titleSnap';
import { RULE_CLEAR, RULE_FADE, ruleVisibility } from '../src/lib/ruleVeil';

// Measured from the scroll viewport's top under a 62pt status bar: the band's
// solid zone ends at 40, its ramp at 64; the web tab bar's top is at 729.
const band: RestBand = { solid: 40, foot: 64, window: 729 - REST_BAR_CLEAR - 64 };
const range = { min: 73, max: 2000 };
const bar = (items: RestBar['items']): RestBar => ({ top: 729, items });

describe('two-edge rest: the tab bar', () => {
  it('counts a line within 12pt above the bar or astride it, not one clear above or under it', () => {
    const edge = bar([]);
    expect(barDepth({ top: 698, bottom: 716 }, 0, edge)).toBe(0); // ends 13pt above: clear
    expect(barDepth({ top: 705, bottom: 723 }, 0, edge)).toBeGreaterThan(0); // ends 6pt above
    expect(barDepth({ top: 720, bottom: 738 }, 0, edge)).toBeGreaterThan(0); // cut by the bar
    expect(barDepth({ top: 730, bottom: 748 }, 0, edge)).toBe(0); // wholly under the glass
  });

  it('lets a line pass under the glass bar rather than leave the gap under the band', () => {
    // Rows every 68pt; at the gap (a row's top at the foot) a line sits astride the bar.
    const rows = [470, 538, 606].map((top) => ({ top, bottom: top + 18 }));
    const line = { top: 1130, bottom: 1148 };
    const target = restNudgeTarget(400, rows, band, range, REST_PAGE_NUDGE_LIMIT, bar([line]));
    expect(target).toBe(470 - band.foot - REST_GAP);
    expect(barDepth(line, target as number, bar([line]))).toBeGreaterThan(0);
  });

  it('breaks a near tie between rests at the gap by the bar', () => {
    // Rests at the gap 12pt either side of here (412 and 436); at 412 a line sits astride the bar.
    const blocks = [{ top: 476, bottom: 480 }, { top: 500, bottom: 518 }];
    const line = { top: 1127, bottom: 1145 };
    const target = restNudgeTarget(424, blocks, band, range, REST_PAGE_NUDGE_LIMIT, bar([line]));
    expect(target).toBe(436);
    expect(barDepth(line, 412, bar([line]))).toBeGreaterThan(0);
    expect(barDepth(line, 436, bar([line]))).toBe(0);
  });
});

describe('two-edge rest: one gap under the band', () => {
  it('rests with the first content at the ramp foot, snapping to the nearest block top', () => {
    // The first content sits 40pt past the foot: move so a block top lands on it.
    const rows = [{ top: 504, bottom: 522 }, { top: 560, bottom: 578 }];
    const target = restNudgeTarget(400, rows, band, range, REST_PAGE_NUDGE_LIMIT, bar([]));
    expect(target).toBe(504 - band.foot - REST_GAP);
    expect(straddleCount(rows, target as number, band)).toBe(0);
  });

  it('never rests on a block top while a taller line beside it shows above the foot', () => {
    // A title line and a slightly taller figure on one row: the figure's top is the first ink.
    const rows = [{ top: 502, bottom: 524 }, { top: 504, bottom: 522 }];
    const target = restNudgeTarget(400, rows, band, range, REST_PAGE_NUDGE_LIMIT, bar([]));
    expect(target).toBe(502 - band.foot - REST_GAP);
  });

  it('stays at the scroll end when the band is clean there', () => {
    const rows = [{ top: 504, bottom: 522 }];
    expect(restNudgeTarget(420, rows, band, { min: 73, max: 420 }, REST_PAGE_NUDGE_LIMIT, bar([]))).toBeNull();
  });

  it('hides a filled box only at the solid edge: its edge in the ramp is split', () => {
    // Fuel's Log food pill ending 3.5pt into the ramp: a ghost bar, not hidden.
    const pill = { top: 0, bottom: band.solid + 3.5, fill: true };
    expect(straddlesBand(pill, 0, band)).toBe(true);
    expect(straddlesBand({ ...pill, fill: undefined }, 0, band)).toBe(false);
    expect(straddlesBand(pill, 3.5, band)).toBe(false);
  });
});

describe('two-edge rest: units rest whole', () => {
  // Progress: readout, figures and legend as one 350pt unit.
  const figure = { top: 165, bottom: 515 };

  it('counts any part of a unit in the ramp as split, however much shows', () => {
    expect(straddlesBand(figure, 200, band)).toBe(true); // 112pt+ showing is still split
    expect(straddlesBand(figure, 104, band)).toBe(false); // wholly shown
    expect(straddlesBand(figure, 515 - 44, band)).toBe(false); // wholly hidden
  });

  it('snaps a split unit to whichever whole state is nearer, past the usual limit', () => {
    const shown = restNudgeTarget(180, [figure], band, range, REST_PAGE_NUDGE_LIMIT, bar([]));
    expect(shown).not.toBeNull();
    expect(straddlesBand(figure, shown as number, band)).toBe(false);
    expect(shown as number).toBeLessThan(180);
    const hidden = restNudgeTarget(420, [figure], band, range, REST_PAGE_NUDGE_LIMIT, bar([]));
    expect(hidden).not.toBeNull();
    expect(straddlesBand(figure, hidden as number, band)).toBe(false);
    expect(hidden as number).toBeGreaterThan(420);
  });
});

describe('rule veil', () => {
  it('hides a rule in the ramp and just under it, and shows it fully further down', () => {
    expect(ruleVisibility(50, 64)).toBe(0);
    expect(ruleVisibility(64 + RULE_CLEAR, 64)).toBe(0);
    expect(ruleVisibility(64 + RULE_CLEAR + RULE_FADE / 2, 64)).toBeCloseTo(0.5);
    expect(ruleVisibility(64 + RULE_CLEAR + RULE_FADE, 64)).toBe(1);
  });
});
