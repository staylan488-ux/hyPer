import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/**
 * A choice capsule: lifted on the fill when selected, as a segmented control's choice; quiet fill otherwise. Choosing ticks
 * (a value change); a hold can offer more, as a VoiceOver action too. Without
 * `selected` it is a quiet action pill (Add RPE, Skip) in the same metrics.
 */
export function Chip({ label, selected, onPress, onLongPress, tabular, haptic = true, disabled, accessibilityLabel, accessibilityHint, style, inTrack }: {
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
  /** One of a row of choices on a shared fill track (a segmented control's look): clear at rest, lifted when chosen. */
  inTrack?: boolean;
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
          // Chosen reads as a segmented control's choice: lifted on the fill (white in light, a lighter grey in
          // dark, as iOS's own) with a hairline edge, so a sheet's one filled shape stays its main button.
          backgroundColor: selected ? c.chosen : pressed ? c.pressed : inTrack ? 'transparent' : c.fill,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: selected ? c.labelEdge : 'transparent',
          ...(selected ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } } : null),
        },
        style,
      ]}>
      <BlancText variant="footnote" weight={selected ? '700' : '600'} tone="ink" style={tabular ? { fontVariant: ['tabular-nums'] } : undefined}>
        {label}
      </BlancText>
    </Pressable>
  );
}
