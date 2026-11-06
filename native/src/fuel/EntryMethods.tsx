import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { BlancText } from '~/components/BlancText';
import { useLargeText } from '~/lib/accessibility';
import { useBlanc } from '~/theme/blanc';

export type EntryMethod = 'scan' | 'manual' | 'photo';

type Method = { id: EntryMethod; title: string; symbol: SFSymbol; spoken: string };

/**
 * The three ways to enter a food that isn't in a list yet, under Log food's
 * Recent | Saved | Search. The one on screen sits on white like the
 * segmented control's chosen segment; the others are quiet fills.
 * `gemini`: the analysis tab takes photos and a typed description (Describe);
 * a device set to the worker gets Photo, with a dot while an estimate waits.
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
    { id: 'scan', title: 'Scan', symbol: 'barcode.viewfinder', spoken: 'Scan a barcode' },
    { id: 'manual', title: 'Manual', symbol: 'square.and.pencil', spoken: 'Enter manually' },
    gemini
      ? { id: 'photo', title: 'Describe', symbol: 'sparkles', spoken: 'Describe a meal, with a photo or words' }
      : { id: 'photo', title: 'Photo', symbol: 'camera', spoken: photoWaiting ? 'Photo, estimate waiting' : 'Photo' },
  ];
  return (
    // At the accessibility text sizes the three stack, so each title stays whole.
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
            onPress={() => {
              if (!on) onSelect(method.id);
            }}
            style={({ pressed }) => ({
              flex: large ? undefined : 1,
              minHeight: 44,
              paddingHorizontal: 10,
              paddingVertical: large ? 10 : 0,
              borderRadius: 22,
              borderCurve: 'continuous',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: on ? c.label : pressed ? c.pressed : c.fill,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: on ? c.labelEdge : 'transparent',
              opacity: disabled ? 0.4 : 1,
            })}>
            <SymbolView name={method.symbol} size={15} weight={on ? 'semibold' : 'medium'} tintColor={c.ink} />
            <BlancText variant="secondary" weight={on ? '600' : '500'} numberOfLines={large ? undefined : 1} style={large ? { flexShrink: 1 } : undefined}>
              {method.title}
            </BlancText>
            {method.id === 'photo' && photoWaiting ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.ink }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
