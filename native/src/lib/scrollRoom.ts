// iOS 26 shrinks the tab bar on scroll only when a page scrolls well past the
// screen. On a page that scrolls only a little past that cut-off the bar sticks:
// it stays small on the way up, then opens on the way down. A plain SwiftUI tab
// app does exactly the same (checked with real swipes on iPhone 17 Pro and
// 17 Pro Max simulators, iOS 26.5), so it is Apple's rule. The fix is page
// length: a page that scrolls at all gets at least MIN_TRAVEL points of travel.

/** Travel at which the shrink behaves; it stuck at 135 points and worked from 169. */
export const MIN_TRAVEL = 200;
/** Pages that scroll this little or less count as fitting and get nothing. */
export const FITS = 32;

export type ScrollRoomInput = {
  /** Height of the scroll view (the whole screen for a tab page). */
  viewport: number;
  /** Height of the page's own content, without the end space. */
  content: number;
  /** Fixed space after the content. */
  endSpace: number;
  /** What iOS covers at the top: status bar, navigation bar, large title. */
  insetTop: number;
  /** What iOS covers at the bottom: tab bar, workout accessory, home indicator. */
  insetBottom: number;
};

/** Extra end space for a page that scrolls, so it scrolls far enough for iOS. */
export function scrollRoomExtra({ viewport, content, endSpace, insetTop, insetBottom }: ScrollRoomInput): number {
  if (viewport <= 0 || content <= 0) return 0;
  const travel = content + endSpace - (viewport - insetTop - insetBottom);
  return travel > FITS && travel < MIN_TRAVEL ? Math.ceil(MIN_TRAVEL - travel) : 0;
}
