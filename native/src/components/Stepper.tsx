import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

type StepperProps = {
  /** Return false when nothing changed (already at a bound): no tick, and a hold stops. */
  onMinus: () => boolean | void;
  onPlus: () => boolean | void;
  /** False at the low end: the minus half greys out. */
  canMinus?: boolean;
  /** False at the high end: the plus half greys out. */
  canPlus?: boolean;
  /** A step is saving: both halves wait. */
  busy?: boolean;
  /** Holding a half keeps stepping, as iOS's stepper does (local values only, never a save per step). */
  repeat?: boolean;
  /** VoiceOver names for the halves, such as "Remove a set" and "Add a set". */
  minusLabel: string;
  plusLabel: string;
};

/**
 * iOS's stepper: minus and plus halves of one pill, drawn 34 pt tall in a
 * 44 pt touch row. Each step ticks (select haptic); the value sits to its left.
 */
export function Stepper({ onMinus, onPlus, canMinus = true, canPlus = true, busy = false, repeat, minusLabel, plusLabel }: StepperProps) {
  const c = useBlanc();
  // A held half reads the newest props each tick: the value has moved on since the hold began.
  // Kept from here rather than written during render, so the React Compiler compiles the stepper.
  const latest = useRef({ onMinus, onPlus, canMinus, canPlus, busy });
  useLayoutEffect(() => {
    latest.current = { onMinus, onPlus, canMinus, canPlus, busy };
  });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const step = (side: 'minus' | 'plus') => {
    const now = latest.current;
    if (now.busy || !(side === 'minus' ? now.canMinus : now.canPlus)) return false;
    if ((side === 'minus' ? now.onMinus : now.onPlus)() === false) return false;
    haptics.select();
    return true;
  };

  const half = (side: 'minus' | 'plus', symbol: SFSymbol, enabled: boolean, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled || busy, busy }}
      disabled={!enabled || busy}
      onPress={() => step(side)}
      onLongPress={
        repeat
          ? () => {
              stop();
              timer.current = setInterval(() => {
                if (!step(side)) stop();
              }, 110);
            }
          : undefined
      }
      delayLongPress={350}
      onPressOut={stop}
      style={{ width: 48, height: 44, justifyContent: 'center' }}>
      {({ pressed }) => (
        <View
          style={[
            { height: 34, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous', backgroundColor: pressed ? c.pressed : 'transparent' },
            side === 'minus' ? { borderTopLeftRadius: 9, borderBottomLeftRadius: 9 } : { borderTopRightRadius: 9, borderBottomRightRadius: 9 },
          ]}>
          <SymbolView name={symbol} size={15} weight="semibold" tintColor={enabled && !busy ? c.ink : c.upcoming} />
        </View>
      )}
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {/* The pill itself, behind the two 44 pt halves. */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 5, bottom: 5, borderRadius: 9, borderCurve: 'continuous', backgroundColor: c.fill }} />
      {half('minus', 'minus', canMinus, minusLabel)}
      <View style={{ width: StyleSheet.hairlineWidth, height: 18, backgroundColor: c.hairline }} />
      {half('plus', 'plus', canPlus, plusLabel)}
    </View>
  );
}
