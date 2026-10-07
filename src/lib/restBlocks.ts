import { findRuleCarriers } from './ruleVeil';
import type { RestBand, RestBar, RestBlock } from './titleSnap';

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
function createClipper(viewport: HTMLElement) {
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
  return clipped;
}

/** A block's ink extent; `glyphs`: where its first visible ink starts (a
 *  line's glyphs, an icon's strokes), below `top`. */
type InkExtent = Extent & { glyphs: number };

function createInkMeter(viewport: HTMLElement): (block: Element) => InkExtent | null {
  const clipped = createClipper(viewport);
  const glyphInset = createGlyphMeter();
  const inkOf = (block: Element): InkExtent | null => {
    let top = Infinity;
    let bottom = -Infinity;
    let glyphs = Infinity;
    const add = (extent: Extent | null, inset = 0) => {
      if (!extent) return;
      top = Math.min(top, extent.top);
      bottom = Math.max(bottom, extent.bottom);
      glyphs = Math.min(glyphs, Math.min(extent.bottom, extent.top + inset));
    };
    const range = document.createRange();
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!node.textContent?.trim() || !parent || parent.closest('svg') || !visible(parent)) continue;
      const inset = glyphInset(node, parent);
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (!(rect.width > 0.5 && rect.height > 0.5)) continue;
        const extent = clipped(parent, rect);
        // The glyphs start `inset` below the rect (less any part clipped off).
        add(extent, extent ? Math.max(0, rect.top + inset - extent.top) : 0);
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
        if (rect.width > 1 && rect.height > 1) {
          const extent = clipped(element, rect);
          add(extent, extent && graphic ? Math.max(0, rect.top + svgInkInset(element, rect) - extent.top) : 0);
        }
      }
    }
    return Number.isFinite(top) && bottom > top ? { top, bottom, glyphs: Number.isFinite(glyphs) ? glyphs : top } : null;
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

/** Air between a page's last row and the tab bar (`.pb-nav`: the bar's top plus this). */
const NAV_AIR = 24;
/** Section headers: each rests with its first line below it, never alone above the bar. */
const HEAD_SELECTOR = 'h2, h3, .t-label, [data-rest-head]';
/** Graphics up to this tall are judged at the bar like a line (an icon, a scale). */
const BAR_GRAPHIC_MAX = 40;
/** A header further than this above its next line is not a header of it. */
const HEAD_REACH = 64;

/**
 * Where a text node's glyphs start below the top of its line rects: a line
 * rect spans the font's ascent, but its glyphs reach only their own height
 * (a cap's top, a digit's), so the gap under the band is measured to them.
 */
function createGlyphMeter() {
  const context = document.createElement('canvas').getContext('2d');
  const cache = new Map<string, number>();
  return (node: Node, parent: Element): number => {
    if (!context) return 0;
    const style = getComputedStyle(parent);
    const raw = (node.textContent ?? '').trim();
    const text = style.textTransform === 'uppercase' ? raw.toUpperCase() : style.textTransform === 'lowercase' ? raw.toLowerCase() : raw;
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const key = `${font}|${text}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    context.font = font;
    const metrics = context.measureText(text);
    const inset = Math.max(0, metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent);
    const value = Number.isFinite(inset) ? inset : 0;
    cache.set(key, value);
    return value;
  };
}

/** How far below its box's top an svg's drawn strokes start (an icon's
 *  glyph sits inside padding in its viewBox); 0 when unknown. */
function svgInkInset(node: Element, rect: DOMRect): number {
  if (!(node instanceof SVGSVGElement)) return 0;
  try {
    const view = node.viewBox.baseVal;
    if (!view || !(view.height > 0) || !(view.width > 0)) return 0;
    const box = node.getBBox();
    const scale = Math.min(rect.width / view.width, rect.height / view.height);
    const stroke = parseFloat(getComputedStyle(node).strokeWidth) || 0;
    const drawn = (rect.height - view.height * scale) / 2 + (box.y - view.y - stroke / 2) * scale;
    return Number.isFinite(drawn) ? Math.min(rect.height, Math.max(0, drawn)) : 0;
  } catch {
    return 0;
  }
}

/** The tab bar's top edge from the viewport's top: the web bar's own box, or
 *  the clearance a page keeps for the native bar (`.pb-nav`). */
function measureBarTop(root: HTMLElement, viewport: HTMLElement): number | null {
  const viewportRect = viewport.getBoundingClientRect();
  const nav = document.querySelector('.bottom-nav');
  if (nav && visible(nav)) return nav.getBoundingClientRect().top - viewportRect.top;
  const page = root.closest('.pb-nav') ?? root.querySelector('.pb-nav');
  // PageTitle's end trim (--end-trim) is not part of the bar's clearance.
  const style = page ? getComputedStyle(page) : null;
  const trim = style ? parseFloat(style.getPropertyValue('--end-trim')) || 0 : 0;
  const clearance = style ? parseFloat(style.paddingBottom) - NAV_AIR - trim : NaN;
  if (!Number.isFinite(clearance) || clearance <= 0) return null;
  return Math.min(viewportRect.height, window.innerHeight - viewportRect.top) - clearance;
}

export interface RestInk {
  /** What rests whole at the top band: every text line, every graphic (an
   *  icon, a ring, a figure), every filled box (a capsule, a selected day's
   *  disc, a rail) and each `data-rest-block` unit (Progress's figures with
   *  their legend, a search field). */
  blocks: RestBlock[];
  /** The tab bar and what must not rest astride it: every text line, small
   *  graphics, each section header with its first line below it, and
   *  hairline rules. */
  bar: RestBar | null;
}

/**
 * Measures, in scroll column offsets, what a resting page is judged by at
 * both edges (`restNudgeTarget`). Line by line rather than row by row: a row
 * may rest with its first line under the band's solid stage and its second
 * clear of the ramp, as content passes under a navigation bar, but no line,
 * graphic or filled box rests in the ramp. `data-rest-ignore` leaves a
 * subtree out; a sticky header (`data-rest-band`) is judged apart
 * (`measureStickyRest`).
 */
export function measureRestInk(root: HTMLElement, viewport: HTMLElement): RestInk {
  const viewportRect = viewport.getBoundingClientRect();
  const barTop = measureBarTop(root, viewport);
  const columnTop = viewportRect.top - viewport.scrollTop;
  const clipped = createClipper(viewport);
  const inkOf = createInkMeter(viewport);
  const glyphInset = createGlyphMeter();
  type Entry = Extent & { node: Node };
  const blocks: RestBlock[] = [];
  const entries: Entry[] = [];
  const heads: { element: Element; last: number; top: number; bottom: number }[] = [];
  const range = document.createRange();
  const column = (extent: Extent): Extent => ({ top: extent.top - columnTop, bottom: extent.bottom - columnTop });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node instanceof Element) {
        // The page header collapses on its own (PageTitle's title snap).
        if (node.matches('[data-rest-ignore], [data-rest-band], .page-header')) return NodeFilter.FILTER_REJECT;
        return node.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (!visible(node)) continue;
      const unit = node.matches('[data-rest-block]');
      const graphic = node.matches(GRAPHIC);
      const fill = !unit && !graphic && filled(getComputedStyle(node));
      if (unit || graphic || fill) {
        const rect = node.getBoundingClientRect();
        const ink = unit ? inkOf(node) : rect.width > 1 && rect.height > 1 ? clipped(node, rect) : null;
        // A filled box hides only at the solid stage's edge (`RestBlock.fill`).
        // An icon's strokes start inside its box (the gap is measured to them).
        const strokes = ink && graphic ? Math.max(0, rect.top + svgInkInset(node, rect) - ink.top) : 0;
        const unitGlyphs = unit && ink ? (ink as InkExtent).glyphs - ink.top : 0;
        const inset = Math.max(strokes, unitGlyphs);
        const extent = ink ? { top: ink.top, bottom: ink.bottom } : null;
        if (extent) blocks.push(fill ? { ...column(extent), fill: true } : inset > 0.25 ? { ...column(extent), ink: column(extent).top + inset } : column(extent));
        if (graphic && ink) entries.push({ ...column({ top: ink.top, bottom: Math.min(ink.bottom, ink.top + BAR_GRAPHIC_MAX) }), node });
      }
      if (node.matches(HEAD_SELECTOR) && !heads.some((head) => head.element.contains(node))) {
        heads.push({ element: node, last: entries.length, top: Infinity, bottom: -Infinity });
      }
      continue;
    }
    const parent = node.parentElement;
    if (!parent || !visible(parent)) continue;
    // A unit's lines rest with it.
    const unit = parent.closest('[data-rest-block]');
    const inUnit = Boolean(unit && root.contains(unit));
    // At the bar a line is its glyphs' em box, not its line box: the
    // half-leading above and below shows nothing.
    const fontSize = parseFloat(getComputedStyle(parent).fontSize) || 0;
    const glyphs = inUnit ? 0 : glyphInset(node, parent);
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 0.5 || rect.height < 4) continue;
      const extent = clipped(parent, rect);
      if (!extent) continue;
      const line = column(extent);
      // The band's gap is measured to where the glyphs start.
      const ink = Math.max(line.top, column({ top: rect.top + glyphs, bottom: rect.bottom }).top);
      if (!inUnit) blocks.push(ink > line.top + 0.25 && ink < line.bottom ? { ...line, ink } : line);
      const leading = Math.max(0, (rect.height - fontSize) / 2);
      entries.push({ top: line.top + leading, bottom: Math.max(line.top + leading + 1, line.bottom - leading), node });
      const head = heads.find((candidate) => candidate.element.contains(node));
      if (head) {
        head.top = Math.min(head.top, line.top);
        head.bottom = Math.max(head.bottom, line.bottom);
        head.last = entries.length;
      }
    }
  }
  if (barTop === null) return { blocks, bar: null };
  const items: RestBlock[] = entries.map(({ top, bottom }) => ({ top, bottom }));
  for (const head of heads) {
    if (!Number.isFinite(head.top)) continue;
    // The first line under the header (not beside it on its own line).
    const next = entries.slice(head.last).find((entry) => !head.element.contains(entry.node) && entry.top > head.bottom - 2);
    if (next && next.top - head.bottom <= HEAD_REACH) items.push({ top: head.top, bottom: next.bottom });
  }
  // Hairline rules rest well clear of the bar or under it (`REST_BAR_RULE_CLEAR`).
  for (const carrier of findRuleCarriers(root, columnTop)) {
    // A scale's hairline (a figure, `role="img"`) is part of its graphic, not a divider.
    if (carrier.element.closest('.page-header, [role="img"]')) continue;
    items.push({ top: carrier.offset, bottom: carrier.offset + 1, rule: true });
  }
  return { blocks, bar: { top: barTop, items } };
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
  // The selected week held right under the header (History) is part of it.
  const week = header.hasAttribute('data-week-stuck') ? root.querySelector<HTMLElement>('[data-selected-week][data-stuck]') : null;
  const weekRect = week?.getBoundingClientRect();
  const held = weekRect && Math.abs(weekRect.top - rect.bottom) < 1 ? weekRect : null;
  const bottom = (held ?? rect).bottom - viewportTop;
  if (header.hasAttribute('data-stuck') && Math.abs(top - band.solid) < 0.5 && bottom > band.solid) {
    return { band: { solid: bottom, foot: bottom + STUCK_RAMP }, blocks: [], covers: null };
  }
  const meter = createInkMeter(viewport);
  const ink = meter(header);
  const weekInk = held && week ? meter(week) : null;
  const unit = ink && weekInk ? { top: Math.min(ink.top, weekInk.top), bottom: Math.max(ink.bottom, weekInk.bottom) } : ink;
  const blocks = unit ? [{ top: unit.top - columnTop, bottom: unit.bottom - columnTop, sliver: unit.bottom - unit.top }] : [];
  const pushed = header.hasAttribute('data-stuck') && top < band.solid - 0.5;
  return { band, blocks, covers: pushed ? { top: rect.top - columnTop, bottom: (held ?? rect).bottom - columnTop } : null };
}

/** Blocks a sticky header's box hides while it moves with its grid are left out. */
export function uncovered(blocks: RestBlock[], covers: RestBlock | null): RestBlock[] {
  if (!covers) return blocks;
  return blocks.filter((block) => !(block.top >= covers.top - 0.5 && block.bottom <= covers.bottom + 0.5));
}
