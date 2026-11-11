import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { Easing, interpolate, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { useCurrentDayKey } from '~/lib/accountData';
import { reduceMotionValue } from '~/lib/accessibility';
import { useHint, type HintKey } from '~/lib/hints';
import { space, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

// A hint arrives once the screen has settled, so it never lands with the
// screen's own motion, and unfolds from the block above it: the space opens
// on one long glide while the words fade up into it. Leaving, the words fade
// first and the space closes after them. Under Reduce Motion nothing moves:
// the words fade in and out in place.
const ARRIVE_AFTER = 450;
const glide = Easing.bezier(0.22, 1, 0.36, 1);
const arrive = { duration: 520, easing: glide, reduceMotion: ReduceMotion.Never };
const leave = { duration: 300, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.Never };

/**
 * One quiet line under the thing it explains, shown the first times someone
 * meets it (lib/hints.ts) and folded away for good once it's acted on. No
 * card, no button: words on the page in graphite, after a small symbol.
 * `gesture` hints say what a swipe or hold does; VoiceOver users reach the
 * same actions from the row itself, so those are hidden from VoiceOver.
 */
export function Hint({ name, ready = true, symbol, gesture = false, style, children }: {
  name: HintKey;
  /** The place's own condition: there is something here to act on. */
  ready?: boolean;
  symbol: SFSymbol;
  gesture?: boolean;
  /** Space around the line, kept inside the fold so a folded hint takes none. */
  style?: ViewStyle;
  children: ReactNode;
}) {
  const c = useBlanc();
  const day = useCurrentDayKey();
  const shows = useHint(name, ready, day);
  // Still drawn while it folds away.
  const [present, setPresent] = useState(shows);
  useEffect(() => {
    if (shows) setPresent(true);
  }, [shows]);
  const open = useSharedValue(0);
  const height = useSharedValue(0);

  useEffect(() => {
    if (!present) return;
    if (shows) {
      open.value = withDelay(ARRIVE_AFTER, withTiming(1, arrive));
    } else {
      open.value = withTiming(0, leave, (finished) => {
        if (finished) runOnJS(setPresent)(false);
      });
    }
  }, [shows, present, open]);

  const fold = useAnimatedStyle(() => {
    const still = reduceMotionValue.value;
    // Under Reduce Motion the space is there for as long as the words are.
    return { height: still ? (open.value > 0 ? height.value : 0) : height.value * open.value };
  });
  const words = useAnimatedStyle(() => {
    const still = reduceMotionValue.value;
    return {
      opacity: interpolate(open.value, still ? [0, 1] : [0.4, 1], [0, 1], 'clamp'),
      transform: [{ translateY: still ? 0 : (1 - open.value) * -6 }],
    };
  });

  if (!present) return null;
  const measure = (event: LayoutChangeEvent) => {
    height.value = event.nativeEvent.layout.height;
  };
  return (
    <Animated.View
      style={[{ overflow: 'hidden' }, fold]}
      accessibilityElementsHidden={gesture}
      importantForAccessibility={gesture ? 'no-hide-descendants' : 'auto'}>
      {/* Measured at its own height, whatever the fold shows of it. */}
      <View onLayout={measure} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <Animated.View
          accessible={!gesture}
          style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: space.gutter, paddingTop: 12 }, style, words]}>
          <SymbolView name={symbol} size={15} weight="medium" tintColor={c.graphite} style={{ width: 18, height: 20 }} />
          <BlancText variant="secondary" tone="graphite" style={{ flex: 1 }}>
            {children}
          </BlancText>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
