/**
 * How far a tab page scrolls (TabScroll's `scrolledFromRest`) while iOS 26
 * folds the large title away: the bar is 106 pt with its large title and 54
 * pt collapsed. Until then the page's top edge rides with the bar's lower
 * edge; after it, a point on the page meets that edge once the page has
 * scrolled this much plus the point's own distance from the top of the page.
 * Only the collapsed bar's height counts, and it doesn't grow with the text,
 * so this holds at every text size, however tall the large title gets.
 */
export const LARGE_TITLE_FOLD = 52;

/** A heading's top and bottom on its page, measured from the top of the scroll content. */
export type HeadingSpan = { top: number; bottom: number };

/**
 * How much of a heading the collapsed bar takes over still shows, from 1 to
 * 0, once the page has scrolled `scrolled` from rest: all of it until it
 * meets the bar's lower edge, less as it crosses that edge, none once it has
 * passed under. iOS 26's soft scroll edge leaves the page legible under the
 * bar, so a heading that only slid under would still read beneath a bar
 * showing the same words; it fades out instead, and the bar names it only at
 * 0. The span is the heading's whole block (on Train's set card the name,
 * the set line and the note under it), so no line of it is left legible
 * under the bar's title. Measured spans, so a two-line name, a note or a
 * larger text size moves the point with it. Not measured yet, it shows in full.
 */
export function headingShown(scrolled: number, heading: HeadingSpan | null): number {
  if (!heading) return 1;
  const meets = heading.top + LARGE_TITLE_FOLD;
  const passed = heading.bottom + LARGE_TITLE_FOLD;
  if (scrolled >= passed) return 0;
  if (scrolled <= meets) return 1;
  return (passed - scrolled) / (passed - meets);
}
