import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/** A quiet bar at the foot of the screen that takes back the latest removal. */
export function UndoBar({ label, onUndo }: { label: string | null; onUndo: () => void }) {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  if (!label) return null;
  return (
    <Animated.View
      key={label}
      entering={FadeInDown.duration(200)}
      exiting={FadeOutDown.duration(160)}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) + 8 }}>
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 50,
          paddingLeft: 18,
          paddingRight: 6,
          borderRadius: 25,
          borderCurve: 'continuous',
          backgroundColor: c.capsule,
        }}>
        <BlancText variant="secondary" tone="onCapsule" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </BlancText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Undo. ${label}`}
          hitSlop={6}
          onPress={() => {
            haptics.tap();
            onUndo();
          }}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
          <BlancText variant="secondary" weight="600" tone="onCapsule">
            Undo
          </BlancText>
        </Pressable>
      </View>
    </Animated.View>
  );
}
