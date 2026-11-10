import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useBlanc } from '~/theme/blanc';

/**
 * The small chevron after the name of something that opens in place (a
 * Progress muscle, a Fuel meal): down while closed, turning up as it opens
 * (Reduce Motion: at once). The control it sits in says the state to VoiceOver.
 */
export function Disclosure({ open }: { open: boolean }) {
  const c = useBlanc();
  // The turn follows `open` through a shared value: on native, Reanimated ignores a dependency list.
  const angle = useSharedValue(open ? 180 : 0);
  useEffect(() => {
    angle.value = withTiming(open ? 180 : 0, { duration: 200 });
  }, [open, angle]);
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  return (
    <Animated.View style={turn} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <SymbolView name="chevron.down" size={11} weight="semibold" tintColor={c.graphite} />
    </Animated.View>
  );
}
