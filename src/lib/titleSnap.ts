/**
 * Large-title settling, as UIKit does it: a page never rests with its large
 * title half collapsed. When scrolling ends inside the collapse range the page
 * settles fully expanded (top) or fully collapsed, whichever is nearer.
 *
 * Returns the offset to settle at, or null when the page already rests in a
 * settled state (at the top, past the collapse, or at a scroll limit it cannot
 * leave).
 */
export function titleSnapTarget(scrollTop: number, collapseEnd: number, maxScroll: number): number | null {
  if (!(collapseEnd > 0) || !(maxScroll > 0)) return null;
  // Rubber-banding past either end settles on its own.
  if (scrollTop <= 0.5 || scrollTop >= maxScroll - 0.5) return null;
  // A short page that cannot reach the collapse settles at one of its ends.
  const end = Math.min(collapseEnd, maxScroll);
  if (scrollTop >= end - 0.5) return null;
  const target = scrollTop < end / 2 ? 0 : end;
  return Math.abs(target - scrollTop) < 0.5 ? null : target;
}

/**
 * Where a page's scroll may end. Its natural end can leave a row split under
 * the bar, so the page may grow a little (at most `limit`) to end on a rest
 * instead: an offset where a row's or section's content starts at the
 * scroll-edge ramp's foot, with what came before wholly under the bar. A
 * page that does not scroll is left alone, as is one with no rest in reach.
 */
export function restingScrollEnd(naturalEnd: number, rests: number[], limit: number): number {
  if (!(naturalEnd > 0.5)) return Math.max(0, naturalEnd);
  const next = rests.filter((rest) => Number.isFinite(rest) && rest >= naturalEnd - 0.5).sort((a, b) => a - b)[0];
  if (next === undefined || next - naturalEnd > limit) return naturalEnd;
  return Math.max(naturalEnd, next);
}

// ═══════════════════════════════════
// REST NUDGE (UIKit's targetContentOffset adjustment), at both edges
// ═══════════════════════════════════

/** A block's visible ink in the scroll column: offsets that do not change with the scroll.
 *  `sliver` (legacy rule, used only when the band has no `window`): a unit
 *  that may pass under the bar while at least this much of it still shows.
 *  `fill`: a filled box (a capsule button, a track). Its edge is a long
 *  straight line the band's blur would smear into a ghost bar, so it counts
 *  as hidden only once it ends at the solid stage's edge, with no allowance
 *  into the ramp. `ink`: where a text line's glyphs start, below its line
 *  box's top; the gap under the band is measured to it. `rule`: a hairline
 *  at the tab bar, which rests `REST_BAR_RULE_CLEAR` clear of it. `whole`:
 *  a unit at the tab bar (a scale with its labels) that rests astride it
 *  only when every rest in reach would. */
export interface RestBlock { top: number; bottom: number; sliver?: number; fill?: boolean; ink?: number; rule?: boolean; whole?: boolean }
/** The scroll-edge band, measured down from the scroll viewport's top edge:
 *  the solid stage ends at `solid`, the ramp at `foot`. `window`: the height
 *  between the ramp's foot and the tab bar's clear line. With it, every block
 *  that fits rests whole, hidden or wholly shown (a figure, a ring, a row);
 *  only a block taller than the window passes under the bar like a photo. */
export interface RestBand { solid: number; foot: number; window?: number }
/** The floating tab bar's top edge, measured down from the scroll viewport's
 *  top edge, and what must not rest astride it: text lines, small graphics,
 *  and each section header with its first line below it (one unit, so a
 *  header never rests alone above the bar). */
export interface RestBar { top: number; items: RestBlock[] }

/** Ink this far into the ramp still counts as hidden: the veil leaves under a
 *  tenth of it there (smoothstep at 4/24 ≈ 7%), blurred. */
export const REST_HIDDEN_DEPTH = 4;
/** Ink starting this far above the ramp's foot still counts as clear (≥ 95% shows). */
export const REST_CLEAR_DEPTH = 3;
/** Legacy rule (a band with no `window`): a block taller than this passes
 *  under the bar like a photo while more than a sliver (`REST_SLIVER`) shows. */
export const REST_TALL_BLOCK = 160;
export const REST_SLIVER = 40;
/** The furthest a rest is nudged, either way, for a row-sized block. A split
 *  block may move as far as half its split stretch (a figure snaps hidden or
 *  shown, as a large title settles). */
export const REST_NUDGE_LIMIT = 32;
/** A page judged at both edges moves up to this far to clear the band. */
export const REST_PAGE_NUDGE_LIMIT = 64;
/** A text line rests at least this far above the tab bar's top (clear of its
 *  8px stage fade), or wholly under it. */
export const REST_BAR_CLEAR = 8;
/** A hairline rule rests at least this far above the tab bar's top, or under
 *  it: closer, it reads as a second edge drawn just above the bar. */
export const REST_BAR_RULE_CLEAR = 20;
const barClear = (item: RestBlock) => (item.rule ? REST_BAR_RULE_CLEAR : REST_BAR_CLEAR);
/** Where a block's visible ink starts (a text line's glyphs, not its line box). */
const inkTop = (block: RestBlock) => block.ink ?? block.top;
/** Where the first content under the band rests, past the ramp's foot: on
 *  every page, the first line, graphic or filled box below the band starts
 *  at the foot, where the veil has wholly cleared, or up to `REST_GAP_FLEX`
 *  past it. */
export const REST_GAP = 0;
/** How far past the foot the first content may rest, so the page can also
 *  rest with no line astride the tab bar. */
export const REST_GAP_FLEX = 12;
/** Within the flex, the gap pages aim for, and what a point of travel costs
 *  against a point of gap (`restNudgeTarget`). */
export const REST_GAP_AIM = 4;
export const REST_GAP_TRAVEL = 0.2;
/** The furthest a rest moves to reach that gap (about one and a half rows;
 *  half a long figure's height). */
export const REST_GAP_REACH = 120;

const isTall = (block: RestBlock, band: RestBand) => (band.window !== undefined
  ? block.bottom - block.top > band.window
  : block.sliver !== undefined || block.bottom - block.top > REST_TALL_BLOCK);
const sliverOf = (block: RestBlock, band: RestBand) => (band.window !== undefined ? REST_SLIVER : block.sliver ?? REST_SLIVER);

/**
 * How far a block is from resting clean at this scroll offset: 0 when it is
 * hidden under the solid stage or clear of the ramp, otherwise the shorter
 * distance to either. A block taller than the band's window (or, without a
 * window, a tall block) is split only while no more than a sliver shows.
 */
export function splitDepth(block: RestBlock, scrollTop: number, band: RestBand): number {
  // A line clears the ramp by its glyphs (`ink`), not its line box.
  const top = inkTop(block) - scrollTop;
  const bottom = block.bottom - scrollTop;
  const hidden = bottom - (band.solid + (block.fill ? 0 : REST_HIDDEN_DEPTH));
  const clear = band.foot - (block.fill ? 0 : REST_CLEAR_DEPTH) - top;
  // Under a pixel either way is a rounding difference, not a visible split.
  if (hidden < 1 || clear < 1) return 0;
  if (isTall(block, band)) {
    const shown = bottom - (band.foot + sliverOf(block, band));
    return shown >= -1e-6 ? 0 : Math.min(hidden, -shown);
  }
  return Math.min(hidden, clear);
}

/** Whether a block rests split by the band at this scroll offset: part of it
 *  in the ramp, neither hidden under the solid stage nor clear of the ramp. */
export function straddlesBand(block: RestBlock, scrollTop: number, band: RestBand): boolean {
  return splitDepth(block, scrollTop, band) > 0;
}

/** How far a line (or header unit) is from resting clean at the tab bar: 0
 *  when it ends at least `REST_BAR_CLEAR` above the bar's top (a rule
 *  `REST_BAR_RULE_CLEAR`) or starts under it, otherwise the shorter
 *  distance to either. */
export function barDepth(item: RestBlock, scrollTop: number, bar: RestBar): number {
  const clear = item.bottom - scrollTop - (bar.top - barClear(item));
  const under = bar.top - (item.top - scrollTop);
  if (clear < 1 || under < 1) return 0;
  return Math.min(clear, under);
}

export function straddleCount(blocks: RestBlock[], scrollTop: number, band: RestBand, bar?: RestBar | null): number {
  let count = 0;
  for (const block of blocks) if (straddlesBand(block, scrollTop, band)) count += 1;
  if (bar) for (const item of bar.items) if (barDepth(item, scrollTop, bar) > 0) count += 1;
  return count;
}

/** Total distance the split blocks (and lines astride the bar) are from resting clean (0: a clean rest). */
export function splitCost(blocks: RestBlock[], scrollTop: number, band: RestBand, bar?: RestBar | null): number {
  let cost = 0;
  for (const block of blocks) cost += splitDepth(block, scrollTop, band);
  if (bar) for (const item of bar.items) cost += barDepth(item, scrollTop, bar);
  return cost;
}

/** Offsets where some block's state changes (just hidden, just clear, just
 *  more than a sliver; at the bar, just clear above it or just under it). */
function criticalOffsets(blocks: RestBlock[], band: RestBand, bar?: RestBar | null): number[] {
  const offsets: number[] = [];
  for (const block of blocks) {
    offsets.push(Math.ceil(block.bottom - band.solid - (block.fill ? 0 : REST_HIDDEN_DEPTH)));
    offsets.push(Math.floor(inkTop(block) - band.foot + (block.fill ? 0 : REST_CLEAR_DEPTH)));
    if (isTall(block, band)) offsets.push(Math.floor(block.bottom - band.foot - sliverOf(block, band)));
  }
  if (bar) {
    for (const item of bar.items) {
      offsets.push(Math.ceil(item.bottom - bar.top + barClear(item)));
      offsets.push(Math.floor(item.top - bar.top));
    }
  }
  return offsets;
}

/** How far a split block may move to rest clean: half its split stretch, as
 *  a large title settles (at least the usual limit). */
function reachOf(block: RestBlock, band: RestBand, limit: number): number {
  if (band.window === undefined) {
    return block.sliver !== undefined ? Math.max(limit, Math.ceil((band.foot - band.solid + block.sliver) / 2) + 1) : limit;
  }
  if (isTall(block, band)) return limit;
  const stretch = block.bottom - block.top + band.foot - band.solid - REST_HIDDEN_DEPTH - REST_CLEAR_DEPTH;
  return Math.max(limit, Math.ceil(stretch / 2) + 1);
}

/**
 * Where a page that has stopped scrolling should come to rest, as UIKit's
 * targetContentOffset adjustment does: when a block rests split by the band,
 * move by at most `limit` (or half a split block's stretch, so a figure snaps
 * hidden or shown) so it clears the band or sits wholly under its solid
 * stage. Never leaves [min, max]. Null: stay.
 *
 * Given the tab bar (`null` where there is none to judge), the page rests on
 * one gap instead: the first ink under the band (a line's glyphs, not its
 * line box) starts at the ramp's foot or up to `REST_GAP_FLEX` past it
 * (`REST_GAP`), as UIKit pages rest
 * with a row's top under the navigation bar, with nothing split by the
 * band. Within that, the nearest offset (within `REST_GAP_REACH`) with no
 * line astride the tab bar's top or within `REST_BAR_CLEAR` above it (a
 * hairline rule within `REST_BAR_RULE_CLEAR`) wins;
 * only when no such offset is in reach does a line rest passing under the
 * bar (the nearest rest at the gap). The scroll end with a clean band is a
 * rest as well (its end space is the one bottom inset), and a page at its
 * end always stays. With no rest at the gap in reach, the nearest rest
 * with a clean band, then the fewest splits.
 */
export function restNudgeTarget(
  scrollTop: number,
  blocks: RestBlock[],
  band: RestBand,
  range: { min: number; max: number },
  limit = REST_NUDGE_LIMIT,
  bar?: RestBar | null,
): number | null {
  if (bar === undefined) return bandNudgeTarget(scrollTop, blocks, band, range, limit);
  const topCount = (offset: number) => straddleCount(blocks, offset, band);
  const barCount = (offset: number) => (bar ? bar.items.reduce((count, item) => count + (barDepth(item, offset, bar) > 0 ? 1 : 0), 0) : 0);
  const nowTop = topCount(scrollTop);
  // A page always rests at its scroll end, as UIKit's does (its end was
  // already chosen to rest clean where it could, `restingScrollEndAt`).
  if (scrollTop >= range.max - 0.5) return null;
  const low = Math.max(range.min, scrollTop - REST_GAP_REACH);
  const high = Math.min(range.max, scrollTop + REST_GAP_REACH);
  if (!(high >= low - 1e-6)) return null;
  // The scroll end with a clean band is a rest too (its end space is the
  // one bottom inset), so a page just short of its end goes there.
  const atEnd = high >= range.max - 1e-6 && topCount(range.max) === 0 ? [range.max] : [];
  // Where the first shown ink starts past the foot (Infinity: none).
  const firstShown = (offset: number) => blocks.reduce((first, block) => (
    block.bottom - offset > band.solid + (block.fill ? 0 : REST_HIDDEN_DEPTH) ? Math.min(first, inkTop(block) - offset) : first
  ), Infinity) - band.foot - REST_GAP;
  // The offsets where something changes: a block's top at either end of the
  // gap's flex, a block just hidden or just clear at the band, a line just
  // clear above the bar or just under it.
  const marks = new Set<number>([scrollTop, low, high, ...criticalOffsets(blocks, band)]);
  for (const block of blocks) {
    marks.add(inkTop(block) - band.foot - REST_GAP);
    marks.add(inkTop(block) - band.foot - REST_GAP - REST_GAP_FLEX);
    marks.add(inkTop(block) - band.foot - REST_GAP - REST_GAP_AIM);
  }
  if (bar) {
    for (const item of bar.items) {
      marks.add(Math.ceil(item.bottom - bar.top + barClear(item)));
      marks.add(Math.floor(item.top - bar.top));
    }
  }
  const atGap = [...marks].filter((offset) => {
    if (offset < low - 1e-6 || offset > high + 1e-6 || topCount(offset) !== 0) return false;
    const gap = firstShown(offset);
    return gap >= -0.5 && gap <= REST_GAP_FLEX + 0.5;
  });
  // Nearest first, but a rest nearer one gap (`REST_GAP_AIM` past the foot)
  // is worth a little more travel, so pages rest alike (the scroll end, whose
  // gap is what it is, by distance alone).
  const cost = (offset: number) => Math.abs(offset - scrollTop) * REST_GAP_TRAVEL
    + (atEnd.includes(offset) ? 0 : Math.abs(firstShown(offset) - REST_GAP_AIM));
  const nearest = (offsets: number[]) => offsets.sort((a, b) => cost(a) - cost(b))[0];
  // With no rest wholly clear of the bar, a line may pass under it, but a
  // scale stays whole with its labels and a divider stays clear where any
  // rest in reach allows (`whole`, `rule`).
  // (Where none can, the one least astride.)
  const pool = [...atGap, ...atEnd];
  const hardItems = bar ? bar.items.filter((item) => item.whole || item.rule) : [];
  const hard = (offset: number) => hardItems.reduce((count, item) => count + (barDepth(item, offset, bar as RestBar) > 0 ? 1 : 0), 0);
  const hardDepth = (offset: number) => hardItems.reduce((sum, item) => sum + barDepth(item, offset, bar as RestBar), 0);
  const fewestHard = Math.min(...pool.map(hard));
  const fallback = pool.filter((offset) => hard(offset) === fewestHard);
  const leastHard = Math.min(...fallback.map(hardDepth));
  const target = nearest(pool.filter((offset) => barCount(offset) === 0))
    ?? nearest(fallback.filter((offset) => hardDepth(offset) <= leastHard + 2));
  if (target !== undefined) return Math.abs(target - scrollTop) < 0.5 ? null : target;
  if (nowTop === 0) return null;
  const reach = blocks.reduce((most, block) => (straddlesBand(block, scrollTop, band) ? Math.max(most, reachOf(block, band, limit)) : most), limit);
  const from = Math.max(range.min, scrollTop - reach);
  const to = Math.min(range.max, scrollTop + reach);
  if (!(to >= from)) return null;
  const candidates = [...criticalOffsets(blocks, band), from, to].filter((offset) => offset >= from - 1e-6 && offset <= to + 1e-6);
  let best: number | null = null;
  let bestKey = [nowTop, splitCost(blocks, scrollTop, band), 0];
  const better = (key: number[], than: number[]) => {
    for (let index = 0; index < key.length; index += 1) {
      // Costs within 2px and moves within half a px tie.
      const slack = index === 1 ? 2 : index === 2 ? 0.5 : 0;
      if (key[index] < than[index] - slack) return true;
      if (key[index] > than[index] + slack) return false;
    }
    return false;
  };
  for (const candidate of candidates) {
    const key = [topCount(candidate), splitCost(blocks, candidate, band), Math.abs(candidate - scrollTop)];
    if (better(key, bestKey)) {
      best = candidate;
      bestKey = key;
    }
  }
  return best === null || Math.abs(best - scrollTop) < 0.5 ? null : best;
}

/** Every offset where the page rests on the gap: a block's ink at the
 *  ramp's foot (`REST_GAP`), nothing split by the band and nothing that
 *  shows starting above the foot (a taller line beside it, say). Sorted. */
export function gapRestOffsets(blocks: RestBlock[], band: RestBand): number[] {
  const firstShown = (offset: number) => blocks.reduce((first, block) => (
    block.bottom - offset > band.solid + (block.fill ? 0 : REST_HIDDEN_DEPTH) ? Math.min(first, inkTop(block) - offset) : first
  ), Infinity);
  return [...new Set(blocks.map((block) => inkTop(block) - band.foot - REST_GAP))]
    .filter((offset) => straddleCount(blocks, offset, band) === 0 && firstShown(offset) >= band.foot + REST_GAP - 0.5)
    .sort((a, b) => a - b);
}

/** The band-only nudge (no tab bar to judge). */
function bandNudgeTarget(
  scrollTop: number,
  blocks: RestBlock[],
  band: RestBand,
  range: { min: number; max: number },
  limit: number,
): number | null {
  const now = splitCost(blocks, scrollTop, band);
  if (now === 0) return null;
  const reach = blocks.reduce((most, block) => (
    straddlesBand(block, scrollTop, band) ? Math.max(most, reachOf(block, band, limit)) : most
  ), limit);
  const low = Math.max(range.min, scrollTop - reach);
  const high = Math.min(range.max, scrollTop + reach);
  if (!(high >= low)) return null;
  const candidates = [...criticalOffsets(blocks, band), low, high].filter((offset) => offset >= low - 1e-6 && offset <= high + 1e-6);
  const nowCount = straddleCount(blocks, scrollTop, band);
  let best: number | null = null;
  let bestCount = nowCount;
  let bestCost = now;
  for (const candidate of candidates) {
    const count = straddleCount(blocks, candidate, band);
    const cost = splitCost(blocks, candidate, band);
    // Fewer split blocks first, then less of them in the ramp. With as many
    // split blocks as now, move only to a rest that is all but clean (every
    // block within a few px of hidden or clear): trading one visible split
    // for another is not worth a move.
    const acceptable = count < nowCount || cost <= 4;
    const better = acceptable && (count < bestCount
      || (count === bestCount && cost < bestCost - 2)
      || (best !== null && count === bestCount && Math.abs(cost - bestCost) <= 2 && Math.abs(candidate - scrollTop) < Math.abs(best - scrollTop)));
    if (better) {
      best = candidate;
      bestCount = count;
      bestCost = cost;
    }
  }
  return best === null || Math.abs(best - scrollTop) < 0.5 ? null : best;
}

/** Air between a page's last ink and the tab bar's top at the scroll end. */
export const REST_END_AIR = 24;
/** The end may grow by up to this much past that air to end with a clean band. */
export const REST_END_SLACK = 8;
/** Or give back up to this much of that air, whichever clean end is nearer. */
export const REST_END_GIVE = 4;

/**
 * Where a page's scroll should end: its last ink (`lastInk`, a column offset)
 * rests `REST_END_AIR` above the tab bar's top (`barTop`, from the viewport's
 * top), the same on every page whatever padding its
 * last row carries. When that end would rest with a block split by the band,
 * it may move to the nearest clean end, growing by at most `REST_END_SLACK` or
 * giving back at most `REST_END_GIVE` of the air (a tie goes to an end at
 * the gap). A page that cannot collapse its title (`floor`) keeps its end.
 */
export function restingScrollEndAt(lastInk: number, barTop: number, blocks: RestBlock[], band: RestBand, floor = 0): number {
  const end = lastInk - (barTop - REST_END_AIR);
  if (!(end > 0.5) || end < floor - 0.5 || !Number.isFinite(end)) return end;
  if (straddleCount(blocks, end, band) === 0) return end;
  const within = (offset: number) => offset >= end - REST_END_GIVE && offset <= end + REST_END_SLACK
    && Math.abs(offset - end) > 1e-6 && straddleCount(blocks, offset, band) === 0;
  const gap = blocks.map((block) => inkTop(block) - band.foot - REST_GAP).filter(within);
  const near = [...gap, ...criticalOffsets(blocks, band).filter(within)]
    .sort((a, b) => Math.abs(a - end) - Math.abs(b - end) || Number(gap.includes(b)) - Number(gap.includes(a)));
  return near[0] ?? end;
}
