import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, useColorScheme, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useReduceMotion } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BloomClip, useTapBloom } from './TapBloom';

type GlassButtonProps = {
  symbol: SFSymbol;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  /** Shown but not usable (the last month, say): dimmed and inert. */
  disabled?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const pressSpring = { damping: 20, stiffness: 420, mass: 0.6 };

/**
 * A round button for custom bars (sheets): a quiet fill, the same in every
 * sheet, that gives under the finger and lights up from it like the capsules.
 */
export function GlassButton({ symbol, onPress, accessibilityLabel, size = 44, disabled }: GlassButtonProps) {
  const c = useBlanc();
  const dark = useColorScheme() === 'dark';
  const reduceMotion = useReduceMotion();
  const bloom = useTapBloom({ tone: 'neutral', dark, reduceMotion });
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const face = { width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const };
  const icon = <SymbolView name={symbol} size={17} weight="semibold" tintColor={c.ink} />;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      hitSlop={6}
      style={[face, { opacity: disabled ? 0.35 : 1, backgroundColor: c.fill }, animated]}
      onPressIn={(event: GestureResponderEvent) => {
        scale.set(withSpring(reduceMotion ? 1 : 0.92, pressSpring));
        bloom.play(event.nativeEvent.locationX, event.nativeEvent.locationY);
      }}
      onPressOut={() => {
        scale.set(withSpring(1, pressSpring));
      }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}>
      {/* One look in every sheet: Liquid Glass draws as raised glass in a page sheet but flat in a floating one
          (checked again with the glass capsules, 2026-11-09), so the close buttons of two sheets wouldn't match.
          The quiet fill is the same everywhere. */}
      <BloomClip radius={size / 2}>{bloom.layer}</BloomClip>
      <View pointerEvents="none">{icon}</View>
    </AnimatedPressable>
  );
}
