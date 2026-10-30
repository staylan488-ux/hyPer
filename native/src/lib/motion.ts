import { Easing, FadeIn, FadeOut, LinearTransition, withTiming, type ExitAnimationsValues } from 'react-native-reanimated';

import { ROLL_SECONDS } from './rollingFigure';

// The one motion for list rows, so every list adds and removes alike.
/** A row that appears fades in. */
export const rowEnter = FadeIn.duration(160);
/**
 * A removed row slides off to the left, as after an iOS swipe-delete: all the
 * way past the edge, fading as it goes so no sliver is left behind.
 */
export const rowExit = (values: ExitAnimationsValues) => {
  'worklet';
  const config = { duration: 220 };
  return {
    initialValues: { originX: values.currentOriginX, opacity: 1 },
    animations: {
      originX: withTiming(-values.currentWidth - 24, config),
      opacity: withTiming(0, config),
    },
  };
};
/** A removed row that was never swiped (a group, a section) fades. */
export const blockExit = FadeOut.duration(180);
/** Rows, cards and sections below a change slide into place. */
export const rowLayout = LinearTransition.duration(220);
/**
 * Text beside a rolling figure (RollingText) moves with it when the figure
 * gains or loses a digit, over the roll's own time, instead of jumping.
 */
export const figureLayout = LinearTransition.duration(ROLL_SECONDS * 1000).easing(Easing.out(Easing.cubic));
