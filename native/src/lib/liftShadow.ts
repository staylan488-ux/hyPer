/** The shadow of a row at rest: written out, so it replaces the last one. */
export const RESTING_SHADOW = '0 0px 0px rgba(0, 0, 0, 0)';

/**
 * The shadow under a row lifted to be dragged into place, for a lift from 0
 * (resting) to 1 (held): it deepens as the row rises and fades as it is set
 * down.
 *
 * Reanimated parses this string on the UI thread every frame, and its colour
 * parser reads plain decimals only. JavaScript writes a number below one
 * millionth as "1.6e-7", which Reanimated rejects by throwing, and an error
 * there closes a release build. The first frame of a lift and the last frame
 * of a set-down can come that close to 0, so every figure is written with
 * fixed decimals.
 *
 * At rest it is an empty shadow, never undefined: Reanimated sends nothing
 * for a style value that is undefined, so the row kept the shadow of the last
 * frame it drew while lifted (often most of the lift, when a frame is dropped
 * as the new order saves).
 */
export function liftShadow(raised: number): string {
  'worklet';
  if (!(raised > 0)) return RESTING_SHADOW;
  return `0 ${(8 * raised).toFixed(2)}px ${(24 * raised).toFixed(2)}px rgba(0, 0, 0, ${(0.16 * raised).toFixed(3)})`;
}
