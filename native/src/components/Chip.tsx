import { Pressable } from 'react-native';

import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/** A choice capsule: ink when selected, quiet fill otherwise. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 17,
        justifyContent: 'center',
        backgroundColor: selected ? c.capsule : pressed ? c.pressed : c.fill,
      })}>
      <BlancText variant="footnote" weight="600" tone={selected ? 'onCapsule' : 'ink'}>
        {label}
      </BlancText>
    </Pressable>
  );
}
