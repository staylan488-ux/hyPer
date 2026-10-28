import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
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

/** A round Liquid Glass button for custom bars (sheets); a quiet fill before iOS 26. */
export function GlassButton({ symbol, onPress, accessibilityLabel, size = 44, disabled }: GlassButtonProps) {
  const c = useBlanc();
  const glass = isLiquidGlassAvailable();
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
      {glass ? (
        <GlassView isInteractive style={face}>
          {icon}
        </GlassView>
      ) : (
        <View style={[face, { backgroundColor: c.fill }]}>{icon}</View>
      )}
    </Pressable>
  );
}
