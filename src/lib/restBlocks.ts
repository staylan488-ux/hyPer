import type { RestBand, RestBlock } from './titleSnap';

/**
 * The blocks a resting page is judged by (see `restNudgeTarget`): sections,
 * figures, platters and their rows, full-width buttons and anything marked
 * `data-rest-block` (a calendar week, a key figure, a field). A counted
 * element taller than `ATOMIC_MAX` counts through its children instead (a
 * section through its rows, a month grid through its days), so a block is
 * about one row; graphics (an svg figure, an image) always count whole.
 * `data-rest-ignore` leaves a subtree out. `data-rest-sliver="N"` on a block
 * makes it one unit (a figure and its legend) that rests hidden or with at
 * least N px showing.
 */
export const REST_BLOCK_SELECTOR = 'section, figure, .platter, .platter-row, button.w-full, [data-rest-block]';
const ATOMIC_MAX = 96;
const GRAPHIC = 'svg, img, canvas, video';

type Extent = { top: number; bottom: number };

const visible = (element: Element) =>
  typeof element.checkVisibility === 'function'
    ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    : element.getClientRects().length > 0;

const filled = (style: CSSStyleDeclaration) => {
  const match = style.backgroundColor.match(/rgba?\(([^)]+)\)/);
  if (!match) return false;
  const alpha = match[1].split(/[\s,/]+/).filter(Boolean)[3];
  // 5%: a 6% ink tint on Ivory shows as plainly as a 10% white one on Black,
  // so a filled control counts the same in both themes.
  return alpha === undefined ? true : parseFloat(alpha) > 0.05;
};

/**
 * Measures where each counted block's ink sits in the scroll column. Ink is
 * what can show: text lines, graphics and filled boxes, clipped by any
 * overflow-clipping ancestor (a rolling figure's hidden digits do not count);
 * a row's padding and hairlines do not.
 */
function createInkMeter(viewport: HTMLElement): (block: Element) => Extent | null {
  const clips = new Map<Element, Extent | null>();
  const clipOf = (element: Element): Extent | null => {
    if (clips.has(element)) return clips.get(element)!;
    let extent: Extent | null = null;
    if (element !== viewport && element.parentElement) {
      const parent = clipOf(element.parentElement);
      const style = getComputedStyle(element);
      if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
        const rect = element.getBoundingClientRect();
        extent = parent ? { top: Math.max(parent.top, rect.top), bottom: Math.min(parent.bottom, rect.bottom) } : { top: rect.top, bottom: rect.bottom };
      } else extent = parent;
    }
    clips.set(element, extent);
    return extent;
  };
  const clipped = (element: Element, rect: Extent): Extent | null => {
    const clip = element.parentElement ? clipOf(element.parentElement) : null;
    const top = clip ? Math.max(rect.top, clip.top) : rect.top;
    const bottom = clip ? Math.min(rect.bottom, clip.bottom) : rect.bottom;
    return bottom - top > 0.5 ? { top, bottom } : null;
  };

  const inkOf = (block: Element): Extent | null => {
    let top = Infinity;
    let bottom = -Infinity;
    const add = (extent: Extent | null) => {
      if (!extent) return;
      top = Math.min(top, extent.top);
      bottom = Math.max(bottom, extent.bottom);
    };
    const range = document.createRange();
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest('svg') || !visible(parent)) continue;
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0.5 && rect.height > 0.5) add(clipped(parent, rect));
      }
    }
    const elements = [block, ...Array.from(block.querySelectorAll('*'))];
    for (const element of elements) {
      // A graphic counts whole (its own box); nothing inside it counts apart.
      if (element.parentElement?.closest('svg')) continue;
      const graphic = element.matches(GRAPHIC);
      if (!visible(element)) continue;
      if (graphic || filled(getComputedStyle(element))) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 1 && rect.height > 1) add(clipped(element, rect));
      }
    }
    return Number.isFinite(top) && bottom > top ? { top, bottom } : null;
  };
  return inkOf;
}

export function measureRestBlocks(root: HTMLElement, viewport: HTMLElement): RestBlock[] {
  const columnTop = viewport.getBoundingClientRect().top - viewport.scrollTop;
  const inkOf = createInkMeter(viewport);
  const blocks: RestBlock[] = [];
  const visit = (element: Element) => {
    // A sticky header (`[data-rest-band]`) is judged apart (measureStickyRest).
    if (element.closest('[data-rest-ignore], [data-rest-band]') || !visible(element)) return;
    const rect = element.getBoundingClientRect();
    if (rect.height < 1) return;
    const whole = element.matches('[data-rest-block]') || element.matches(GRAPHIC) || rect.height <= ATOMIC_MAX || element.children.length === 0;
    if (!whole) {
      for (const child of Array.from(element.children)) visit(child);
      return;
    }
    const ink = inkOf(element);
    if (!ink) return;
    const sliver = parseFloat(element.getAttribute('data-rest-sliver') ?? '');
    blocks.push(Number.isFinite(sliver)
      ? { top: ink.top - columnTop, bottom: ink.bottom - columnTop, sliver }
      : { top: ink.top - columnTop, bottom: ink.bottom - columnTop });
  };
  for (const element of Array.from(root.querySelectorAll(REST_BLOCK_SELECTOR))) {
    const outer = element.parentElement?.closest(REST_BLOCK_SELECTOR);
    if (outer && root.contains(outer)) continue;
    visit(element);
  }
  return blocks;
}

/** The scroll-edge band (`.page-scroll-edge`) measured from the viewport's top edge. */
export function measureRestBand(band: Element, viewport: HTMLElement, fallback = { solid: 40, fade: 24 }): RestBand {
  const style = getComputedStyle(band);
  const solidValue = parseFloat(style.getPropertyValue('--edge-solid'));
  const fadeValue = parseFloat(style.getPropertyValue('--edge-fade'));
  const solid = Number.isFinite(solidValue) ? solidValue : fallback.solid;
  const fade = Number.isFinite(fadeValue) ? fadeValue : fallback.fade;
  const top = band.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  return { solid: top + solid, foot: top + solid + fade };
}

/** How far a stuck header's own ramp reaches below it (`.calendar-sticky::after`). */
export const STUCK_RAMP = 16;

export interface StickyRest {
  /** The band blocks rest against. */
  band: RestBand;
  /** The header itself, while it moves with its grid. */
  blocks: RestBlock[];
  /** Column offsets the header's opaque box hides while it moves with its grid. */
  covers: RestBlock | null;
}

/**
 * A sticky header (`[data-rest-band]`, History's month and weekday letters)
 * changes what blocks rest against. Held at the band's solid edge
 * (`data-stuck`), its opaque foot and short ramp are the band: content above
 * is hidden. Pushed up by the end of its grid, it moves with the grid like
 * any block, so it must rest hidden or wholly clear (a unit as tall as its
 * ink), and the rows under its box are hidden with it. In the flow it is
 * an ordinary block.
 */
export function measureStickyRest(root: HTMLElement, viewport: HTMLElement, band: RestBand): StickyRest {
  const header = root.querySelector<HTMLElement>('[data-rest-band]');
  if (!header || !visible(header)) return { band, blocks: [], covers: null };
  const viewportTop = viewport.getBoundingClientRect().top;
  const columnTop = viewportTop - viewport.scrollTop;
  const rect = header.getBoundingClientRect();
  const top = rect.top - viewportTop;
  const bottom = rect.bottom - viewportTop;
  if (header.hasAttribute('data-stuck') && Math.abs(top - band.solid) < 0.5 && bottom > band.solid) {
    return { band: { solid: bottom, foot: bottom + STUCK_RAMP }, blocks: [], covers: null };
  }
  const ink = createInkMeter(viewport)(header);
  const blocks = ink ? [{ top: ink.top - columnTop, bottom: ink.bottom - columnTop, sliver: ink.bottom - ink.top }] : [];
  const pushed = header.hasAttribute('data-stuck') && top < band.solid - 0.5;
  return { band, blocks, covers: pushed ? { top: rect.top - columnTop, bottom: rect.bottom - columnTop } : null };
}

/** Blocks a sticky header's box hides while it moves with its grid are left out. */
export function uncovered(blocks: RestBlock[], covers: RestBlock | null): RestBlock[] {
  if (!covers) return blocks;
  return blocks.filter((block) => !(block.top >= covers.top - 0.5 && block.bottom <= covers.bottom + 0.5));
}
