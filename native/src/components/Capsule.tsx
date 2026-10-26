import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

type CapsuleProps = {
  title: string;
  onPress: () => void;
  /** A small mark before the title, such as a provider logo. */
  icon?: ReactNode;
  /** Ink fill for the screen's main action; a quiet fill for the rest. */
  variant?: 'primary' | 'quiet';
  size?: 'regular' | 'large';
  busy?: boolean;
  disabled?: boolean;
  fill?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const pressSpring = { damping: 20, stiffness: 420, mass: 0.6 };

/** Blanc's button: a capsule that gives under the finger. */
export function Capsule({
  title,
  onPress,
  icon,
  variant = 'primary',
  size = 'regular',
  busy,
  disabled,
  fill,
  accessibilityLabel,
  style,
}: CapsuleProps) {
  const c = useBlanc();
  const scale = useSharedValue(1);
  const height = size === 'large' ? 54 : 44;
  const primary = variant === 'primary';
  const inactive = disabled || busy;

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPressIn={() => {
        scale.value = withSpring(0.96, pressSpring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, pressSpring);
      }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={[
        {
          height,
          paddingHorizontal: size === 'large' ? 26 : 20,
          borderRadius: height / 2,
          borderCurve: 'continuous',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: fill ? 'stretch' : 'flex-start',
          backgroundColor: primary ? c.capsule : c.fill,
          opacity: disabled ? 0.4 : 1,
        },
        animated,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={primary ? c.onCapsule : c.ink} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          <BlancText
            variant="headline"
            tone={primary ? 'onCapsule' : 'ink'}
            size={size === 'large' ? 17 : 16}
            style={{ lineHeight: size === 'large' ? 22 : 20 }}>
            {title}
          </BlancText>
        </View>
      )}
    </AnimatedPressable>
  );
}
