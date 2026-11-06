import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, View } from 'react-native';

import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

type GlassButtonProps = {
  symbol: SFSymbol;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  /** Shown but not usable (the last month, say): dimmed and inert. */
  disabled?: boolean;
};

/** A round button for custom bars (sheets): a quiet fill, the same in every sheet. */
export function GlassButton({ symbol, onPress, accessibilityLabel, size = 44, disabled }: GlassButtonProps) {
  const c = useBlanc();
  const face = { width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const };
  const icon = <SymbolView name={symbol} size={17} weight="semibold" tintColor={c.ink} />;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      hitSlop={6}
      style={{ opacity: disabled ? 0.35 : 1 }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}>
      {/* One look in every sheet: Liquid Glass drew as raised glass in a page sheet but flat in a floating one,
          so the close buttons of two sheets didn't match. The quiet fill is the same everywhere. */}
      <View style={[face, { backgroundColor: c.fill }]}>{icon}</View>
    </Pressable>
  );
}
