import { Pressable, type ViewStyle } from 'react-native';

import { useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/**
 * A choice capsule: an ink ring when selected, quiet fill otherwise. Choosing ticks
 * (a value change); a hold can offer more, as a VoiceOver action too. Without
 * `selected` it is a quiet action pill (Add RPE, Skip) in the same metrics.
 */
export function Chip({ label, selected, onPress, onLongPress, tabular, haptic = true, disabled, accessibilityLabel, accessibilityHint, style }: {
  label: string;
  /** Ink when chosen; leave out for an action pill that is never chosen. */
  selected?: boolean;
  onPress: () => void;
  onLongPress?: { label: string; run: () => void };
  /** Figures that line up across chips (rest lengths). */
  tabular?: boolean;
  /** False when onPress plays its own haptic. */
  haptic?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Placement and width, such as a minimum width or a top margin. */
  style?: ViewStyle;
}) {
  const c = useBlanc();
  // At the accessibility text sizes the chip grows with its label.
  const large = useLargeText();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: onLongPress.label }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress?.run();
      }}
      disabled={disabled}
      // 34 points drawn, 44 to touch.
      hitSlop={{ top: 5, bottom: 5 }}
      onPress={() => {
        if (haptic) haptics.select();
        onPress();
      }}
      onLongPress={
        onLongPress
          ? () => {
              haptics.select();
              onLongPress.run();
            }
          : undefined
      }
      style={({ pressed }) => [
        {
          ...(large ? { minHeight: 34, paddingVertical: 6 } : { height: 34 }),
          paddingHorizontal: 14,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          // Chosen is an ink ring on the label colour, so a sheet's one filled shape stays its main button.
          backgroundColor: selected ? c.label : pressed ? c.pressed : c.fill,
          borderWidth: 1.5,
          borderColor: selected ? c.ink : 'transparent',
        },
        style,
      ]}>
      <BlancText variant="footnote" weight="600" tone="ink" style={tabular ? { fontVariant: ['tabular-nums'] } : undefined}>
        {label}
      </BlancText>
    </Pressable>
  );
}
