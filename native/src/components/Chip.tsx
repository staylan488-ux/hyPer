import { Pressable } from 'react-native';

import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/**
 * A choice capsule: ink when selected, quiet fill otherwise. Choosing ticks
 * (a value change); a hold can offer more, as a VoiceOver action too.
 */
export function Chip({ label, selected, onPress, onLongPress }: {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLongPress?: { label: string; run: () => void };
}) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: onLongPress.label }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress?.run();
      }}
      // 34 points drawn, 44 to touch.
      hitSlop={{ top: 5, bottom: 5 }}
      onPress={() => {
        haptics.select();
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
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 17,
        justifyContent: 'center',
        backgroundColor: selected ? c.capsule : pressed ? c.pressed : c.fill,
      })}>
      <BlancText variant="footnote" weight="600" tone={selected ? 'onCapsule' : 'ink'}>
        {label}
      </BlancText>
    </Pressable>
  );
}
