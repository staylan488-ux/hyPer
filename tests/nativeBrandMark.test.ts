import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BLOOM,
  LIGHT_GLYPHS,
  P_DRAWN,
  P_GLYPH,
  P_SIZE,
  PAD,
  WORD_SIZE,
  drawnMark,
  glyphBox,
  introWaits,
  landing,
  markBox,
  markInkInsets,
  plausibleAnchor,
  wordLayout,
  type Glyph,
} from '../native/src/lib/brandGeometry';

const glyphs: [string, Glyph][] = [['P', P_GLYPH], ...Object.entries(LIGHT_GLYPHS)];

describe('native brand mark geometry', () => {
  it('gives every glyph room for its ink, which iOS would otherwise clip', () => {
    // iOS draws text inside its box: the italic P's ink runs 0.04 em past its advance.
    for (const [, glyph] of glyphs) {
      expect(PAD).toBeGreaterThan(-glyph.inkLeft + 0.005);
      expect(PAD).toBeGreaterThan(glyph.inkRight - glyph.advance + 0.005);
    }
  });

  it('centres the spelled-out word once it has drifted', () => {
    const { letters, centring } = wordLayout();
    const box = (letter: string) => letters.find((item) => item.letter === letter)!.box;
    const inkLeft = box('h').left + (PAD + LIGHT_GLYPHS.h.inkLeft) * WORD_SIZE;
    const inkRight = box('r').left + (PAD + LIGHT_GLYPHS.r.inkRight) * WORD_SIZE;
    expect(inkLeft + centring).toBeCloseTo(-(inkRight + centring), 6);
    // hy is wider than er, so the word drifts right of the P by about 7 points.
    expect(centring).toBeCloseTo(6.83, 1);
  });

  it('spells h, y, P, e, r left to right on one baseline', () => {
    const { letters } = wordLayout();
    const tops = new Set(letters.map((item) => item.box.top.toFixed(6)));
    expect(tops.size).toBe(1);
    const [h, y, e, r] = letters.map((item) => item.box.left);
    const p = drawnMark();
    const pInkLeft = (P_GLYPH.inkLeft - (P_GLYPH.inkLeft + P_GLYPH.inkRight) / 2) * P_SIZE;
    expect(h).toBeLessThan(y);
    expect(y + glyphBox(LIGHT_GLYPHS.y, WORD_SIZE).width).toBeGreaterThan(pInkLeft);
    expect(e).toBeGreaterThan(pInkLeft);
    expect(r).toBeGreaterThan(e);
    expect(p.left).toBeLessThan(0);
  });

  it('lands the P ink centre on the resting mark at its size', () => {
    const size = 30;
    const box = markBox(size);
    const anchor = { x: 16, y: 61, width: box.width, height: box.height, size };
    const end = landing(anchor);
    expect(end.x).toBeCloseTo(16 + box.inkX, 6);
    expect(end.y).toBeCloseTo(61 + box.inkY, 6);
    // The drawn P ends at exactly the resting mark's font size.
    expect(end.scale * P_SIZE).toBeCloseTo(size, 6);
  });

  it('only ever scales the drawn P down', () => {
    expect(P_DRAWN).toBeCloseTo(P_SIZE * BLOOM, 6);
    for (const size of [30, 48, 120]) {
      const end = landing({ x: 0, y: 0, ...markBox(size), size });
      expect((end.scale * P_SIZE) / P_DRAWN).toBeLessThan(1);
    }
  });

  it('turns down a mark that is not laid out yet', () => {
    const box = markBox(30);
    expect(plausibleAnchor({ x: 16, y: 61, width: box.width, height: box.height, size: 30 })).toBe(true);
    expect(plausibleAnchor({ x: 0, y: 0, width: 0, height: 0, size: 30 })).toBe(false);
    expect(plausibleAnchor({ x: 16, y: 61, width: box.width * 2, height: box.height, size: 30 })).toBe(false);
  });

  it('lays a tight mark out by its ink', () => {
    const size = 48;
    const insets = markInkInsets(size);
    const box = markBox(size);
    // Cap height is 0.7 em: what is left of the box once the insets go.
    expect(box.height - insets.top - insets.bottom).toBeCloseTo(0.7 * size, 6);
    expect(insets.left).toBeGreaterThan(0);
  });
});

describe('the cold-launch intro’s waits for a resting mark', () => {
  const native = (file: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../native', file), 'utf8');

  it('waits a moment for the first screen’s mark, then fades in place without one', () => {
    expect(introWaits(false)).toEqual({ firstScreen: 600, noAnchor: 1200 });
  });

  it('waits for no mark on a screen a widget or card opened', () => {
    expect(introWaits(true)).toEqual({ firstScreen: 0, noAnchor: 0 });
  });

  it('takes both waits from that rule, told by the root layout whether a launch link opened the app', () => {
    const intro = native('src/components/BrandIntro.tsx');
    expect(intro).toContain('setTimeout(() => setFirstScreen(true), introWaits(markless).firstScreen)');
    expect(intro).toContain('setTimeout(() => setNoAnchor(true), introWaits(markless).noAnchor)');

    const layout = native('src/app/_layout.tsx');
    const flag = layout.match(/const \[(\w+)\] = useState\(\(\) => pendingLaunchLink\(\) !== null\);/)?.[1];
    expect(flag).toBeTruthy();
    const start = layout.indexOf('<BrandIntro ');
    expect(layout.slice(start, layout.indexOf('/>', start))).toContain(`markless={${flag}}`);
  });
});
