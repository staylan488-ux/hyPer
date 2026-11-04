import { FadeIn, FadeOut, LinearTransition, ReduceMotion, withTiming, type ExitAnimationsValues } from 'react-native-reanimated';

import { reduceMotionValue } from './accessibility';
import { rollSpring } from './rollingFigure';

// The one motion for list rows, so every list adds and removes alike. Under
// Reduce Motion nothing slides: fades still play (iOS's own substitute for
// motion), and rows below a change take their place at once.
/** A row that appears fades in, with Reduce Motion too. */
export const rowEnter = FadeIn.duration(160).reduceMotion(ReduceMotion.Never);
/**
 * A removed row slides off to the left, as after an iOS swipe-delete: all the
 * way past the edge, fading as it goes so no sliver is left behind. Under
 * Reduce Motion it only fades, in place.
 */
export const rowExit = (values: ExitAnimationsValues) => {
  'worklet';
  if (reduceMotionValue.value) {
    return {
      initialValues: { opacity: 1 },
      animations: { opacity: withTiming(0, { duration: 180, reduceMotion: ReduceMotion.Never }) },
    };
  }
  const config = { duration: 220 };
  return {
    initialValues: { originX: values.currentOriginX, opacity: 1 },
    animations: {
      originX: withTiming(-values.currentWidth - 24, config),
      opacity: withTiming(0, config),
    },
  };
};
/** A removed row that was never swiped (a group, a section) fades, with Reduce Motion too. */
export const blockExit = FadeOut.duration(180).reduceMotion(ReduceMotion.Never);
/** Rows, cards and sections below a change slide into place (at once under Reduce Motion). */
export const rowLayout = LinearTransition.duration(220);
/**
 * Text beside a rolling figure (RollingText) moves with it when the figure
 * gains or loses a digit: the figure's frame grows or shrinks on SwiftUI's
 * smooth spring, and this follows the same spring, so the text stays at the
 * figure's edge instead of jumping or crossing digits on their way out.
 */
const roll = rollSpring();
export const figureLayout = LinearTransition.springify().mass(roll.mass).stiffness(roll.stiffness).damping(roll.damping);
