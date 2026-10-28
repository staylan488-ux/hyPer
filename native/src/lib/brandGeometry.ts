// The hyPer mark: a red italic P (Fraunces Mark Medium Italic). On a cold
// launch the P spells out "hyPer" (the rest in Fraunces Mark Light), the word
// folds back into it, and the P flies to its corner. Every number here comes
// from the two fonts in assets/fonts (font units are 1/2000 em). This file has
// no React Native imports, so plain tests can check the layout.

const UPM = 2000;
const em = (units: number) => units / UPM;

/** hhea ascent and descent, the same in both fonts: iOS makes a line their sum tall. */
const ASCENT = em(1956);
const DESCENT = em(510);
const CAP_HEIGHT = em(1400);

/** Clear room each side of a glyph's box, in em: italic ink runs past its advance. */
export const PAD = 0.06;

export type Glyph = { advance: number; inkLeft: number; inkRight: number };

/** The P in Medium Italic: its ink runs from -21 to 1303 units, past its 1217 advance. */
export const P_GLYPH: Glyph = { advance: em(1217), inkLeft: em(-21), inkRight: em(1303.39) };

/** The rest of the word, in Light. */
export const LIGHT_GLYPHS = {
  h: { advance: em(952), inkLeft: em(40), inkRight: em(961) },
  y: { advance: em(848), inkLeft: em(-24), inkRight: em(873) },
  e: { advance: em(792), inkLeft: em(48), inkRight: em(751) },
  r: { advance: em(662), inkLeft: em(41), inkRight: em(646) },
} satisfies Record<string, Glyph>;

export type Letter = keyof typeof LIGHT_GLYPHS;

/** The word spelled out: hy and er at this size, the P 6% larger, tracked in by 4%. */
export const WORD_SIZE = 72;
export const P_SIZE = WORD_SIZE * 1.06;
const TRACKING = -0.04 * WORD_SIZE;

/** The P blooms in at this multiple of its spelled-out size. It is drawn that large and only ever scaled down. */
export const BLOOM = 1.95;
export const P_DRAWN = P_SIZE * BLOOM;

/** How far a letter starts tucked toward the P, and how far it folds back into it. */
export const TUCK = 0.42 * WORD_SIZE;
export const FOLD = 0.5 * WORD_SIZE;

/** hy sits left of the P and tucks rightward; er tucks leftward. */
export const tuckDirection = (letter: Letter) => (letter === 'h' || letter === 'y' ? 1 : -1);

export type Box = { left: number; top: number; width: number; height: number };

/** A glyph's text box at a font size: its advance plus PAD each side, one line tall. */
export function glyphBox(glyph: Glyph, size: number): { width: number; height: number } {
  return { width: (glyph.advance + 2 * PAD) * size, height: (ASCENT + DESCENT) * size };
}

/** The P's text box at a font size, and where the centre of its ink sits inside the box. */
export function markBox(size: number) {
  return {
    ...glyphBox(P_GLYPH, size),
    inkX: (PAD + (P_GLYPH.inkLeft + P_GLYPH.inkRight) / 2) * size,
    inkY: (ASCENT - CAP_HEIGHT / 2) * size,
  };
}

/** Space between the P's text box and its ink, to lay the mark out by what you see. */
export function markInkInsets(size: number): { top: number; bottom: number; left: number } {
  return {
    top: (ASCENT - CAP_HEIGHT) * size,
    bottom: DESCENT * size,
    left: (PAD + P_GLYPH.inkLeft) * size,
  };
}

/**
 * The drawn P's box, placed so its ink centre is at (0, 0), and that ink
 * centre's offset from the box centre (to scale about the ink, not the box).
 */
export function drawnMark(): Box & { inkOffsetX: number; inkOffsetY: number } {
  const box = markBox(P_DRAWN);
  return {
    left: -box.inkX,
    top: -box.inkY,
    width: box.width,
    height: box.height,
    inkOffsetX: box.inkX - box.width / 2,
    inkOffsetY: box.inkY - box.height / 2,
  };
}

/**
 * The spelled-out word around the P's ink centre at (0, 0): each letter's text
 * box, and the shift that centres the whole word's ink once it is spelled out.
 * hy ends where the P begins; er tucks under the P's italic overhang.
 */
export function wordLayout(): { letters: { letter: Letter; box: Box }[]; centring: number } {
  const baseline = (CAP_HEIGHT / 2) * P_SIZE;
  const pOrigin = -((P_GLYPH.inkLeft + P_GLYPH.inkRight) / 2) * P_SIZE;
  const pSpan = P_GLYPH.advance * P_SIZE + TRACKING;
  const { h, y, e } = LIGHT_GLYPHS;

  const origins: Record<Letter, number> = { h: 0, y: 0, e: 0, r: 0 };
  origins.h = pOrigin - (h.advance + y.advance) * WORD_SIZE - 2 * TRACKING;
  origins.y = origins.h + h.advance * WORD_SIZE + TRACKING;
  origins.e = pOrigin + 0.92 * pSpan;
  origins.r = origins.e + e.advance * WORD_SIZE + TRACKING;

  const letters = (Object.keys(origins) as Letter[]).map((letter) => ({
    letter,
    box: {
      ...glyphBox(LIGHT_GLYPHS[letter], WORD_SIZE),
      left: origins[letter] - PAD * WORD_SIZE,
      top: baseline - ASCENT * WORD_SIZE,
    },
  }));

  const inkLeft = origins.h + h.inkLeft * WORD_SIZE;
  const inkRight = origins.r + LIGHT_GLYPHS.r.inkRight * WORD_SIZE;
  return { letters, centring: -(inkLeft + inkRight) / 2 };
}

/** A resting mark on screen: its box in window points and its font size. */
export type MarkAnchor = { x: number; y: number; width: number; height: number; size: number };

/** Where the P's ink centre lands, and the word's scale there (1 = spelled out). */
export function landing(anchor: MarkAnchor): { x: number; y: number; scale: number } {
  const box = markBox(anchor.size);
  return { x: anchor.x + box.inkX, y: anchor.y + box.inkY, scale: anchor.size / P_SIZE };
}

/** A measured box that plausibly holds a mark of that size (not a half-laid-out view). */
export function plausibleAnchor(anchor: MarkAnchor): boolean {
  const box = markBox(anchor.size);
  return (
    anchor.size > 0 &&
    Math.abs(anchor.width - box.width) <= box.width * 0.25 &&
    Math.abs(anchor.height - box.height) <= box.height * 0.25
  );
}
