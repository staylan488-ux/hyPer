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
