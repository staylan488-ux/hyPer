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
