import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useBlanc } from '~/theme/blanc';

/** A thin progress line. Past 100% it turns red, the one alarm colour. */
export function Track({ progress }: { progress: number }) {
  const c = useBlanc();
  const clamped = Math.max(0, Math.min(1, progress));
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(clamped, { duration: 650, easing: Easing.out(Easing.cubic) });
  }, [clamped, width]);

  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <View style={{ height: 3, borderRadius: 2, backgroundColor: c.track, overflow: 'hidden' }}>
      <Animated.View style={[{ height: 3, borderRadius: 2, backgroundColor: progress > 1 ? c.live : c.ink }, fill]} />
    </View>
  );
}
