import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, View, type AccessibilityActionEvent, type ViewStyle } from 'react-native';

import { speak, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { space, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import { Capsule } from './Capsule';
import { Disclosure } from './Disclosure';

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
  /**
   * A section that folds down to its heading (a Fuel meal): the heading is
   * the button, with the small chevron that turns. The caller shows or leaves
   * out the content.
   */
  fold?: { open: boolean; onToggle: () => void };
  children: ReactNode;
  style?: ViewStyle;
};

/** A titled block of a screen. Sections are separated by space, never boxes. */
export function Section({ title, action, note, accessory, page, actions, fold, children, style }: SectionProps) {
  // At the accessibility text sizes the title and its action share the line
  // only while both fit; then the action wraps below.
  const large = useLargeText();
  // The note is a nested text, which VoiceOver reads raw.
  const spoken = speak(note ? `${title}, ${note}` : title);
  const spokenActions = actions?.length ? actions.map((entry) => ({ name: entry.label, label: entry.label })) : undefined;
  const act = (event: AccessibilityActionEvent) => actions?.find((entry) => entry.label === event.nativeEvent.actionName)?.run();
  // A long title wraps rather than pushing the action off the screen.
  const heading = (
    <BlancText
      variant="section"
      accessibilityRole="header"
      accessibilityLabel={spoken}
      accessibilityActions={spokenActions}
      onAccessibilityAction={act}
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
  );
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
        {fold ? (
          // The heading and the space beside it fold the section. It stays a
          // heading for VoiceOver, which reads it open or closed.
          <Pressable
            accessibilityRole="header"
            accessibilityState={{ expanded: fold.open }}
            accessibilityLabel={spoken}
            accessibilityActions={spokenActions}
            onAccessibilityAction={act}
            // the heading row's height, 44 points to touch
            hitSlop={{ top: 4, bottom: 4, left: space.gutter }}
            onPress={() => {
              haptics.tap();
              fold.onToggle();
            }}
            style={({ pressed }) => ({ flexGrow: 1, flexShrink: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.5 : 1 })}>
            {heading}
            <Disclosure open={fold.open} />
          </Pressable>
        ) : (
          heading
        )}
        {action ? (
          <Capsule title={action.title} size="small" variant="quiet" icon={action.symbol ? <ActionMark name={action.symbol} /> : undefined} onPress={action.onPress} />
        ) : (
          accessory ?? null
        )}
      </View>
      {/* Folded, the heading stands alone: no room is kept for content that is not there. */}
      <View style={{ marginTop: page || (fold && !fold.open) ? 0 : 8 }}>{children}</View>
    </View>
  );
}

function ActionMark({ name }: { name: SFSymbol }) {
  const c = useBlanc();
  return <SymbolView name={name} size={13} weight="semibold" tintColor={c.ink} />;
}
