import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import { closeOpenSwipeRow, useSwipeActions } from './SwipeRow';

type RowProps = {
  title: string;
  detail?: string;
  value?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  /** Finished or secondary rows read in graphite. */
  quiet?: boolean;
  /** A row that removes something (Sign out, Disconnect) reads in red. */
  destructive?: boolean;
  onPress?: () => void;
  /** A second action under a long press, offered to VoiceOver as a custom action. */
  onLongPress?: { label: string; run: () => void };
  /** Shown but not usable for now (a save is running): dimmed and inert. */
  disabled?: boolean;
  /** More VoiceOver actions (Move up, Move down) for what a gesture does by sight. */
  actions?: { label: string; run: () => void }[];
  accessibilityLabel?: string;
};

/** A list row that highlights under the finger, like an iOS table cell. */
export function Row({ title, detail, value, leading, trailing, chevron, quiet, destructive, onPress, onLongPress, disabled, actions: extra = [], accessibilityLabel }: RowProps) {
  const c = useBlanc();
  // Spoken as its words only: icons such as the chevron add nothing.
  const label = accessibilityLabel ?? [title, detail, value].filter(Boolean).join(', ');
  // VoiceOver offers the long-press action and any swipe actions around the row.
  const swipe = useSwipeActions() ?? [];
  const actions = [
    ...(onLongPress ? [{ name: 'longpress', label: onLongPress.label }] : []),
    ...swipe.map((action) => ({ name: `swipe:${action.label}`, label: action.label })),
    ...extra.map((action) => ({ name: `extra:${action.label}`, label: action.label })),
  ];
  const onAction = (name: string) => {
    if (name === 'longpress') onLongPress?.run();
    else if (name.startsWith('extra:')) extra.find((action) => `extra:${action.label}` === name)?.run();
    else swipe.find((action) => `swipe:${action.label}` === name)?.onPress();
  };
  const content = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <BlancText variant={quiet ? 'body' : 'bodyStrong'} tone={destructive ? 'live' : quiet ? 'graphite' : 'ink'} numberOfLines={1}>
          {title}
        </BlancText>
        {detail ? (
          <BlancText variant="secondary" tone="graphite" numberOfLines={1} style={{ marginTop: 1 }}>
            {detail}
          </BlancText>
        ) : null}
      </View>
      {value ? (
        <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          {value}
        </BlancText>
      ) : null}
      {trailing}
      {chevron ? (
        <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={c.upcoming} />
      ) : null}
    </>
  );

  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    minHeight: 60,
    paddingVertical: 10,
    paddingLeft: 18,
    paddingRight: 16,
  };

  if (!onPress && !onLongPress) {
    // Read as one element, unless it holds a control (a Start button, say)
    // that VoiceOver must still reach on its own.
    return (
      <View
        style={rowStyle}
        accessible={!trailing}
        accessibilityLabel={trailing ? undefined : label}
        accessibilityActions={!trailing && actions.length > 0 ? actions : undefined}
        onAccessibilityAction={(event) => onAction(event.nativeEvent.actionName)}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      accessibilityActions={actions.length > 0 ? actions : undefined}
      onAccessibilityAction={(event) => onAction(event.nativeEvent.actionName)}
      onPress={() => {
        // A tap while another row stands open only closes that row, as in Mail.
        if (closeOpenSwipeRow()) return;
        if (!onPress) return;
        haptics.tap();
        onPress();
      }}
      onLongPress={
        onLongPress
          ? () => {
              if (closeOpenSwipeRow()) return;
              haptics.select();
              onLongPress.run();
            }
          : undefined
      }
      style={({ pressed }) => [rowStyle, { backgroundColor: pressed ? c.pressed : 'transparent', opacity: disabled ? 0.4 : 1 }]}>
      {content}
    </Pressable>
  );
}

/** A 1-pixel rule between rows, inset to line up with row text. */
export function Hairline({ inset = 18 }: { inset?: number }) {
  const c = useBlanc();
  return <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: c.hairline }} />;
}
