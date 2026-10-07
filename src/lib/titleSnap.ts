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
// REST NUDGE (UIKit's targetContentOffset adjustment)
// ═══════════════════════════════════

/** A block's visible ink in the scroll column: offsets that do not change with the scroll. */
export interface RestBlock { top: number; bottom: number }
/** The scroll-edge band, measured down from the scroll viewport's top edge:
 *  the solid stage ends at `solid`, the ramp at `foot`. */
export interface RestBand { solid: number; foot: number }

/** Ink this far into the ramp still counts as hidden: the veil leaves under a
 *  tenth of it there (smoothstep at 4/24 ≈ 7%), blurred. */
export const REST_HIDDEN_DEPTH = 4;
/** Ink starting this far above the ramp's foot still counts as clear (≥ 95% shows). */
export const REST_CLEAR_DEPTH = 3;
/** A block taller than this (a figure, a chart) passes under the bar like a
 *  photo: it is split only while no more than a sliver (`REST_SLIVER`) of it
 *  shows below the ramp. A sliver under 40px keeps every such block within a
 *  nudge of a clean rest (hidden, or at least that much showing). */
export const REST_TALL_BLOCK = 160;
export const REST_SLIVER = 40;
/** The furthest a rest is nudged, either way. */
export const REST_NUDGE_LIMIT = 32;

/**
 * How far a block is from resting clean at this scroll offset: 0 when it is
 * hidden under the solid stage or clear of the ramp, otherwise the shorter
 * distance to either. A tall block is split only while no more than a sliver
 * of it shows below the ramp.
 */
export function splitDepth(block: RestBlock, scrollTop: number, band: RestBand): number {
  const top = block.top - scrollTop;
  const bottom = block.bottom - scrollTop;
  const hidden = bottom - (band.solid + REST_HIDDEN_DEPTH);
  const clear = band.foot - REST_CLEAR_DEPTH - top;
  // Under a pixel either way is a rounding difference, not a visible split.
  if (hidden < 1 || clear < 1) return 0;
  if (block.bottom - block.top > REST_TALL_BLOCK) {
    const shown = bottom - (band.foot + REST_SLIVER);
    return shown >= -1e-6 ? 0 : Math.min(hidden, -shown);
  }
  return Math.min(hidden, clear);
}

/** Whether a block rests split by the band at this scroll offset: part of it
 *  in the ramp, neither hidden under the solid stage nor clear of the ramp. */
export function straddlesBand(block: RestBlock, scrollTop: number, band: RestBand): boolean {
  return splitDepth(block, scrollTop, band) > 0;
}

export function straddleCount(blocks: RestBlock[], scrollTop: number, band: RestBand): number {
  let count = 0;
  for (const block of blocks) if (straddlesBand(block, scrollTop, band)) count += 1;
  return count;
}

/** Total distance the split blocks are from resting clean (0: a clean rest). */
export function splitCost(blocks: RestBlock[], scrollTop: number, band: RestBand): number {
  let cost = 0;
  for (const block of blocks) cost += splitDepth(block, scrollTop, band);
  return cost;
}

/** Offsets where some block's state changes (just hidden, just clear, just more than a sliver). */
function criticalOffsets(blocks: RestBlock[], band: RestBand): number[] {
  const offsets: number[] = [];
  for (const block of blocks) {
    offsets.push(Math.ceil(block.bottom - band.solid - REST_HIDDEN_DEPTH));
    offsets.push(Math.floor(block.top - band.foot + REST_CLEAR_DEPTH));
    if (block.bottom - block.top > REST_TALL_BLOCK) offsets.push(Math.floor(block.bottom - band.foot - REST_SLIVER));
  }
  return offsets;
}

/**
 * Where a page that has stopped scrolling should come to rest, as UIKit's
 * targetContentOffset adjustment does: when a block rests split by the band,
 * move by at most `limit` so it clears the band or sits wholly under its
 * solid stage. Prefers no split block at all, then the fewest, then the
 * shortest move; never leaves [min, max]. Null: stay.
 */
export function restNudgeTarget(
  scrollTop: number,
  blocks: RestBlock[],
  band: RestBand,
  range: { min: number; max: number },
  limit = REST_NUDGE_LIMIT,
): number | null {
  const now = splitCost(blocks, scrollTop, band);
  if (now === 0) return null;
  const low = Math.max(range.min, scrollTop - limit);
  const high = Math.min(range.max, scrollTop + limit);
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
export function cleanScrollEnd(naturalEnd: number, blocks: RestBlock[], band: RestBand, limit: number, floor = 0): number {
  if (!(naturalEnd > 0.5) || naturalEnd < floor - 0.5) return Math.max(0, naturalEnd);
  if (straddleCount(blocks, naturalEnd, band) === 0) return naturalEnd;
  const clean = criticalOffsets(blocks, band)
    .filter((offset) => offset > naturalEnd && offset <= naturalEnd + limit)
    .sort((a, b) => a - b)
    .find((offset) => straddleCount(blocks, offset, band) === 0);
  return clean ?? naturalEnd;
}
