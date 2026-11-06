import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { BlancText } from '~/components/BlancText';
import { useLargeText } from '~/lib/accessibility';
import { useBlanc } from '~/theme/blanc';

export type EntryMethod = 'scan' | 'manual' | 'photo' | 'describe';

type Method = { id: EntryMethod; title: string; symbol: SFSymbol; spoken: string };

/**
 * The ways to enter a food that isn't in a list yet, under Log food's
 * Recent | Saved | Search, each a small symbol over its name. The one on
 * screen sits on white like the segmented control's chosen segment; the
 * others are quiet. `gemini`: Photo and Describe are two doors into the one
 * meal view (a photo first, or words first; both can be combined before the
 * estimate). A device set to the worker gets Photo only, with a dot while an
 * estimate waits. A press on the open door still reaches `onSelect`: Photo
 * then adds another photo and Describe returns to the words.
 */
export function EntryMethods({
  selected,
  gemini,
  photoWaiting,
  disabled,
  onSelect,
}: {
  selected: EntryMethod | null;
  gemini: boolean;
  photoWaiting: boolean;
  disabled: boolean;
  onSelect: (method: EntryMethod) => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const methods: Method[] = [
    { id: 'scan', title: 'Barcode', symbol: 'barcode.viewfinder', spoken: 'Scan a barcode' },
    { id: 'manual', title: 'Manual', symbol: 'square.and.pencil', spoken: 'Enter manually' },
    ...(gemini
      ? [
          { id: 'photo', title: 'Photo', symbol: 'camera', spoken: 'Photo of a meal' } satisfies Method,
          { id: 'describe', title: 'Describe', symbol: 'text.bubble', spoken: 'Describe a meal in words' } satisfies Method,
        ]
      : [{ id: 'photo', title: 'Photo', symbol: 'camera', spoken: photoWaiting ? 'Photo, estimate waiting' : 'Photo' } satisfies Method]),
  ];
  return (
    // At the accessibility text sizes they stack as rows, so each title stays whole.
    <View style={large ? { gap: 8 } : { flexDirection: 'row', gap: 8 }}>
      {methods.map((method) => {
        const on = selected === method.id;
        return (
          <Pressable
            key={method.id}
            accessibilityRole="button"
            accessibilityLabel={method.spoken}
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => onSelect(method.id)}
            style={({ pressed }) => ({
              flex: large ? undefined : 1,
              minHeight: large ? 44 : 56,
              paddingHorizontal: large ? 14 : 4,
              paddingVertical: large ? 10 : 7,
              borderRadius: large ? 22 : 14,
              borderCurve: 'continuous',
              // a symbol over its name, so four fit across; side by side at the accessibility sizes
              flexDirection: large ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: large ? 8 : 4,
              // Actions, not a second segmented control: no fill at rest; the open one sits on the label colour.
              backgroundColor: on ? c.label : pressed ? c.pressed : 'transparent',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: on ? c.labelEdge : 'transparent',
              opacity: disabled ? 0.4 : 1,
            })}>
            <SymbolView name={method.symbol} size={20} weight={on ? 'semibold' : 'medium'} tintColor={c.ink} />
            <BlancText variant={large ? 'secondary' : 'footnote'} weight={on ? '600' : '500'} numberOfLines={large ? undefined : 1} style={large ? { flexShrink: 1 } : undefined}>
              {method.title}
            </BlancText>
            {method.id === 'photo' && photoWaiting ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
