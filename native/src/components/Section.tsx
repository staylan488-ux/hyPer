import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { speak, useLargeText } from '~/lib/accessibility';
import { space, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import { Capsule } from './Capsule';

type SectionProps = {
  title: string;
  /** The heading's one action, like "Log food": a small glass capsule, as everything that is pressed. */
  action?: { title: string; onPress: () => void; symbol?: SFSymbol };
  /** Extra text after the title, in graphite. */
  note?: string;
  /** A control on the right instead of an action, such as a menu button. */
  accessory?: ReactNode;
  /**
   * A group of a tab's own page (Today's Fuel, Train's days): set apart by
   * `space.group`, clearly more than any gap inside a group, with its heading
   * close over its content. With no cards, that space is what groups a page.
   */
  page?: boolean;
  /** VoiceOver actions on the heading, for what a gesture does by sight (Move up, Move down). */
  actions?: { label: string; run: () => void }[];
  children: ReactNode;
  style?: ViewStyle;
};

/** A titled block of a screen. Sections are separated by space, never boxes. */
export function Section({ title, action, note, accessory, page, actions, children, style }: SectionProps) {
  // At the accessibility text sizes the title and its action share the line
  // only while both fit; then the action wraps below.
  const large = useLargeText();
  return (
    <View style={[{ marginTop: page ? space.group : space.section }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          // A heading row no taller than it needs; a page's group keeps a button's height, with or without one.
          minHeight: page ? 44 : 36,
          paddingHorizontal: space.gutter,
          ...(large ? { flexWrap: 'wrap', columnGap: 12 } : null),
        }}>
        {/* A long title wraps rather than pushing the action off the screen. */}
        <BlancText
          variant="section"
          accessibilityRole="header"
          // The note is a nested text, which VoiceOver reads raw.
          accessibilityLabel={speak(note ? `${title}, ${note}` : title)}
          accessibilityActions={actions?.length ? actions.map((entry) => ({ name: entry.label, label: entry.label })) : undefined}
          onAccessibilityAction={(event) => actions?.find((entry) => entry.label === event.nativeEvent.actionName)?.run()}
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
          <Capsule title={action.title} size="small" variant="quiet" icon={action.symbol ? <ActionMark name={action.symbol} /> : undefined} onPress={action.onPress} />
        ) : (
          accessory ?? null
        )}
      </View>
      <View style={{ marginTop: page ? 0 : 8 }}>{children}</View>
    </View>
  );
}

function ActionMark({ name }: { name: SFSymbol }) {
  const c = useBlanc();
  return <SymbolView name={name} size={13} weight="semibold" tintColor={c.ink} />;
}
