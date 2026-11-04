import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAnnounce, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/**
 * A quiet bar at the foot of the screen that takes back the latest removal.
 * `bottom` lifts it over bars the screen sits under (a tab page's tab bar).
 * VoiceOver announces what was removed when the bar appears; the Undo
 * button names it too.
 */
export function UndoBar({ label, onUndo, bottom }: { label: string | null; onUndo: () => void; bottom?: number }) {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const large = useLargeText();
  useAnnounce(label ? `${label}. Undo is at the bottom of the screen.` : null);
  if (!label) return null;
  return (
    <Animated.View
      key={label}
      entering={FadeInDown.duration(200)}
      exiting={FadeOutDown.duration(160)}
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 16, right: 16, bottom: bottom ?? Math.max(insets.bottom, 12) + 8 }}>
      <View
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
        <BlancText variant="secondary" tone="onCapsule" numberOfLines={large ? 3 : 1} style={{ flex: 1, ...(large ? { paddingVertical: 8 } : null) }}>
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
