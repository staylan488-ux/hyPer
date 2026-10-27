import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { haptics } from '~/lib/haptics';
import { space } from '~/theme/blanc';

import { BlancText } from './BlancText';

type SectionProps = {
  title: string;
  /** A quiet text action on the right of the title, like "Log food". */
  action?: { title: string; onPress: () => void };
  /** Extra text after the title, in graphite. */
  note?: string;
  /** A control on the right instead of a text action, such as a menu button. */
  accessory?: ReactNode;
  children: ReactNode;
  style?: ViewStyle;
};

/** A titled block of a screen. Sections are separated by space, never boxes. */
export function Section({ title, action, note, accessory, children, style }: SectionProps) {
  return (
    <View style={[{ marginTop: space.section }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 44,
          paddingHorizontal: space.gutter,
        }}>
        <BlancText variant="section" accessibilityRole="header">
          {title}
          {note ? (
            <BlancText variant="secondary" tone="graphite">
              {'  '}
              {note}
            </BlancText>
          ) : null}
        </BlancText>
        {action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              haptics.tap();
              action.onPress();
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.45 : 1, minHeight: 44, justifyContent: 'center' })}>
            <BlancText variant="bodyStrong" size={15}>
              {action.title}
            </BlancText>
          </Pressable>
        ) : (
          accessory ?? null
        )}
      </View>
      <View style={{ marginTop: 6 }}>{children}</View>
    </View>
  );
}
