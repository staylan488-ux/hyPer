import { describe, expect, it } from 'vitest';
import {
  REST_BAR_CLEAR,
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

  it('moves a line astride the bar clear of it when the band stays clean', () => {
    const line = { top: 1100, bottom: 1118 };
    const target = restNudgeTarget(400, [], band, range, REST_PAGE_NUDGE_LIMIT, bar([line]));
    expect(target).not.toBeNull();
    expect(barDepth(line, target as number, bar([line]))).toBe(0);
    expect(Math.abs((target as number) - 400)).toBeLessThanOrEqual(32);
  });

  it('never trades a clean band for a clean bar', () => {
    // Clearing the bar line would push this row into the ramp.
    const row = { top: 470, bottom: 488 };
    const line = { top: 1130, bottom: 1148 };
    const target = restNudgeTarget(400, [row], band, range, REST_PAGE_NUDGE_LIMIT, bar([line]));
    if (target !== null) expect(straddleCount([row], target, band)).toBe(0);
  });

  it('keeps a header with its first line: it rests clear with it or passes under', () => {
    // "Lunch" alone above the bar, its first entry under it: a header unit.
    const unit = { top: 1080, bottom: 1140 };
    const target = restNudgeTarget(400, [], band, range, REST_PAGE_NUDGE_LIMIT, bar([unit]));
    expect(target).not.toBeNull();
    expect(barDepth(unit, target as number, bar([unit]))).toBe(0);
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

describe('two-edge rest: an even gap under the bar', () => {
  it('closes an empty shelf under the band when that keeps both edges clean', () => {
    // The first content sits 40pt past the ramp's foot.
    const rows = [{ top: 504, bottom: 522 }, { top: 560, bottom: 578 }];
    const target = restNudgeTarget(400, rows, band, range, REST_PAGE_NUDGE_LIMIT, bar([]));
    expect(target).not.toBeNull();
    expect(rows[0].top - (target as number)).toBeLessThanOrEqual(band.foot + 8);
    expect(straddleCount(rows, target as number, band)).toBe(0);
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
