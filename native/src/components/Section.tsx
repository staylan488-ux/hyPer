import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { speak, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { space, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

type SectionProps = {
  title: string;
  /** A quiet text action on the right of the title, like "Log food", with a small symbol so it reads as a button. */
  action?: { title: string; onPress: () => void; symbol?: SFSymbol };
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
  const c = useBlanc();
  return (
    <View style={[{ marginTop: space.section }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          // A heading row no taller than it needs: its action keeps a 44 pt target through hit slop.
          minHeight: 36,
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
            // A nested text takes the title's weight unless it names its own: the note stays quiet.
            <BlancText variant="secondary" weight="400" tone="graphite">
              {'  '}
              {note}
            </BlancText>
          ) : null}
        </BlancText>
        {action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            onPress={() => {
              haptics.tap();
              action.onPress();
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.45 : 1, minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5 })}>
            {action.symbol ? <SymbolView name={action.symbol} size={13} weight="semibold" tintColor={c.ink} /> : null}
            <BlancText variant="bodyStrong" size={15}>
              {action.title}
            </BlancText>
          </Pressable>
        ) : (
          accessory ?? null
        )}
      </View>
      <View style={{ marginTop: 8 }}>{children}</View>
    </View>
  );
}
