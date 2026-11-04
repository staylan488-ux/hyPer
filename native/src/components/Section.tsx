import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { speak, useLargeText } from '~/lib/accessibility';
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
  // At the accessibility text sizes the title and its action share the line
  // only while both fit; then the action wraps below.
  const large = useLargeText();
  return (
    <View style={[{ marginTop: space.section }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          minHeight: 44,
          paddingHorizontal: space.gutter,
          ...(large ? { flexWrap: 'wrap', columnGap: 12 } : null),
        }}>
        {/* A long title wraps rather than pushing the action off the screen. */}
        <BlancText
          variant="section"
          accessibilityRole="header"
          // The note is a nested text, which VoiceOver reads raw.
          accessibilityLabel={speak(note ? `${title}, ${note}` : title)}
          style={{ flexShrink: 1 }}>
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
