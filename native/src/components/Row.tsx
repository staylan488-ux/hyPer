import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

type RowProps = {
  title: string;
  detail?: string;
  value?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  /** Finished or secondary rows read in graphite. */
  quiet?: boolean;
  onPress?: () => void;
  /** A second action under a long press, offered to VoiceOver as a custom action. */
  onLongPress?: { label: string; run: () => void };
  accessibilityLabel?: string;
};

/** A list row that highlights under the finger, like an iOS table cell. */
export function Row({ title, detail, value, leading, trailing, chevron, quiet, onPress, onLongPress, accessibilityLabel }: RowProps) {
  const c = useBlanc();
  // Spoken as its words only: icons such as the chevron add nothing.
  const label = accessibilityLabel ?? [title, detail, value].filter(Boolean).join(', ');
  const content = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <BlancText variant={quiet ? 'body' : 'bodyStrong'} tone={quiet ? 'graphite' : 'ink'} numberOfLines={1}>
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

  if (!onPress) {
    // Read as one element, unless it holds a control (a Start button, say)
    // that VoiceOver must still reach on its own.
    return (
      <View style={rowStyle} accessible={!trailing} accessibilityLabel={trailing ? undefined : label}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityActions={onLongPress ? [{ name: 'longpress', label: onLongPress.label }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress?.run();
      }}
      onPress={() => {
        haptics.tap();
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
      style={({ pressed }) => [rowStyle, { backgroundColor: pressed ? c.pressed : 'transparent' }]}>
      {content}
    </Pressable>
  );
}

/** A 1-pixel rule between rows, inset to line up with row text. */
export function Hairline({ inset = 18 }: { inset?: number }) {
  const c = useBlanc();
  return <View style={{ height: StyleSheet.hairlineWidth, marginLeft: inset, backgroundColor: c.hairline }} />;
}
