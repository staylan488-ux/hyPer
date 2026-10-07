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
 *  that may pass under the bar while at least this much of it still shows. */
export interface RestBlock { top: number; bottom: number; sliver?: number }
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
/** A text line rests at least this far above the tab bar's top, or under it. */
export const REST_BAR_CLEAR = 12;
/** The first content may rest this far past the band's foot before the gap
 *  under the bar reads as an empty shelf. */
export const REST_GAP_SLACK = 8;
/** The furthest a rest moves to reach a rest clean at both edges. */
export const REST_CLEAN_REACH = 64;
/** The furthest a rest moves when its only fault is at the tab bar. */
export const REST_BAR_NUDGE_LIMIT = 32;

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
  const top = block.top - scrollTop;
  const bottom = block.bottom - scrollTop;
  const hidden = bottom - (band.solid + REST_HIDDEN_DEPTH);
  const clear = band.foot - REST_CLEAR_DEPTH - top;
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
 *  when it ends at least `REST_BAR_CLEAR` above the bar's top or starts
 *  under it, otherwise the shorter distance to either. */
export function barDepth(item: RestBlock, scrollTop: number, bar: RestBar): number {
  const clear = item.bottom - scrollTop - (bar.top - REST_BAR_CLEAR);
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
    offsets.push(Math.ceil(block.bottom - band.solid - REST_HIDDEN_DEPTH));
    offsets.push(Math.floor(block.top - band.foot + REST_CLEAR_DEPTH));
    if (isTall(block, band)) offsets.push(Math.floor(block.bottom - band.foot - sliverOf(block, band)));
  }
  if (bar) {
    for (const item of bar.items) {
      offsets.push(Math.ceil(item.bottom - bar.top + REST_BAR_CLEAR));
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
 * stage. Prefers no split block at all, then the fewest, then the shortest
 * move; never leaves [min, max]. Null: stay.
 *
 * Given the tab bar, the rest is judged at both edges at once: a line must
 * also not rest astride the bar's top (`barDepth`), nor a header alone above
 * it. The band comes first (a split there is under the title, where the eye
 * is), then the bar, then the smallest move. A rest whose only fault is at
 * the bar moves by at most `barLimit`: the bar is glass, and passing under
 * it is how content reads there anyway.
 */
export function restNudgeTarget(
  scrollTop: number,
  blocks: RestBlock[],
  band: RestBand,
  range: { min: number; max: number },
  limit = REST_NUDGE_LIMIT,
  bar?: RestBar | null,
  barLimit = REST_BAR_NUDGE_LIMIT,
): number | null {
  if (!bar) return bandNudgeTarget(scrollTop, blocks, band, range, limit);
  const topCount = (offset: number) => straddleCount(blocks, offset, band);
  const barCount = (offset: number) => bar.items.reduce((count, item) => count + (barDepth(item, offset, bar) > 0 ? 1 : 0), 0);
  // How far the first content under the band sits past the standard gap
  // (its foot, plus a little): a rest that hides a block above should not
  // leave an empty shelf under the bar.
  const shelf = (offset: number) => {
    let first = Infinity;
    for (const block of blocks) {
      const top = block.top - offset;
      if (top >= band.foot - REST_CLEAR_DEPTH - 1) first = Math.min(first, top);
    }
    return Number.isFinite(first) ? Math.max(0, first - band.foot - REST_GAP_SLACK) : 0;
  };
  const nowTop = topCount(scrollTop);
  const nowBar = barCount(scrollTop);
  const nowShelf = shelf(scrollTop);
  if (nowTop === 0 && nowBar === 0 && nowShelf === 0) return null;
  // A clean rest at both edges within a row and a half wins outright (one
  // with the standard gap under the bar first, then the nearest).
  const cleanLow = Math.max(range.min, scrollTop - (nowTop === 0 && nowBar === 0 ? barLimit : REST_CLEAN_REACH));
  const cleanHigh = Math.min(range.max, scrollTop + (nowTop === 0 && nowBar === 0 ? barLimit : REST_CLEAN_REACH));
  const clean = [scrollTop, cleanLow, cleanHigh, ...criticalOffsets(blocks, band, bar)]
    .filter((offset) => offset >= cleanLow - 1e-6 && offset <= cleanHigh + 1e-6 && topCount(offset) === 0 && barCount(offset) === 0)
    .map((offset) => ({ offset, key: (shelf(offset) > 0 ? 1e6 : 0) + Math.abs(offset - scrollTop) }))
    .sort((a, b) => a.key - b.key)[0];
  if (clean !== undefined) return Math.abs(clean.offset - scrollTop) < 0.5 ? null : clean.offset;
  if (nowTop === 0 && nowBar === 0) return null;
  const reach = nowTop > 0
    ? blocks.reduce((most, block) => (straddlesBand(block, scrollTop, band) ? Math.max(most, reachOf(block, band, limit)) : most), limit)
    : barLimit;
  const low = Math.max(range.min, scrollTop - reach);
  const high = Math.min(range.max, scrollTop + reach);
  if (!(high >= low)) return null;
  const candidates = [...criticalOffsets(blocks, band, bar), low, high].filter((offset) => offset >= low - 1e-6 && offset <= high + 1e-6);
  let best: number | null = null;
  let bestKey = [nowTop, nowBar, nowShelf > 0 ? 1 : 0, splitCost(blocks, scrollTop, band, bar), 0];
  const better = (key: number[], than: number[]) => {
    for (let index = 0; index < key.length; index += 1) {
      // Costs within 2px and moves within half a px tie.
      const slack = index === 3 ? 2 : index === 4 ? 0.5 : 0;
      if (key[index] < than[index] - slack) return true;
      if (key[index] > than[index] + slack) return false;
    }
    return false;
  };
  for (const candidate of candidates) {
    // A rest at the band is not traded for a split there.
    const top = topCount(candidate);
    if (top > nowTop) continue;
    const key = [top, barCount(candidate), shelf(candidate) > 0 ? 1 : 0, splitCost(blocks, candidate, band, bar), Math.abs(candidate - scrollTop)];
    if (better(key, bestKey)) {
      best = candidate;
      bestKey = key;
    }
  }
  return best === null || Math.abs(best - scrollTop) < 0.5 ? null : best;
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

/**
 * Where a page's scroll may end. The trailing space only clears the tab bar;
 * when the natural end would rest with a block split by the band, the page
 * may grow by at most `limit` (about one row) to end on a clean rest instead.
 * A page that cannot collapse its title (`floor`), or with no clean rest in
 * reach, keeps its natural end.
 */
export function cleanScrollEnd(naturalEnd: number, blocks: RestBlock[], band: RestBand, limit: number, floor = 0, bar?: RestBar | null): number {
  if (!(naturalEnd > 0.5) || naturalEnd < floor - 0.5) return Math.max(0, naturalEnd);
  if (straddleCount(blocks, naturalEnd, band, bar) === 0) return naturalEnd;
  const clean = criticalOffsets(blocks, band, bar)
    .filter((offset) => offset > naturalEnd && offset <= naturalEnd + limit)
    .sort((a, b) => a - b)
    .find((offset) => straddleCount(blocks, offset, band, bar) === 0);
  return clean ?? naturalEnd;
}
