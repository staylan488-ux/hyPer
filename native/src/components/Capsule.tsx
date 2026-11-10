import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useColorScheme,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useLargeText, useReduceMotion } from '~/lib/accessibility';
import { emitGlassPress } from '~/lib/glassPress';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';
import { useScriptedCapsule, type ScriptedCapsule } from './GlassDemo';
import { BloomClip, DemoFinger, readPressDemo, useTapBloom, type BloomTone } from './TapBloom';

type CapsuleProps = {
  title: string;
  onPress: () => void;
  /** A small mark before the title, such as a provider logo. */
  icon?: ReactNode;
  /** The screen's main action, or a quieter one beside it. */
  variant?: 'primary' | 'quiet';
  /**
   * `effort` for the workout actions (Log set and its Retry, Resume, Start,
   * Finish workout): the light under the finger is warm and the glass field
   * behind the app sends its wave up from the press. Every other button
   * blooms a neutral light.
   */
  tone?: BloomTone;
  size?: 'regular' | 'large';
  busy?: boolean;
  disabled?: boolean;
  fill?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const pressSpring = { damping: 20, stiffness: 420, mass: 0.6 };

// Liquid Glass needs iOS 26; before it (and off iOS) capsules keep Blanc's fills.
const glassAvailable = (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

/**
 * Blanc's button: a capsule of Apple's interactive Liquid Glass with its title
 * in ink. Under the finger it gives a little and lights up from the fingertip
 * (warm for workout actions), with a light haptic tap. At the accessibility
 * text sizes it grows taller and its title wraps instead of being cut short.
 */
export function Capsule({
  title,
  onPress,
  icon,
  variant = 'primary',
  tone = 'neutral',
  size = 'regular',
  busy,
  disabled,
  fill,
  accessibilityLabel,
  style,
}: CapsuleProps) {
  const c = useBlanc();
  const dark = useColorScheme() === 'dark';
  const large = useLargeText();
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const height = size === 'large' ? 54 : 44;
  const primary = variant === 'primary';
  const inactive = disabled || busy;
  // A capsule that cannot be used yet is not glass: it sits back in a flat
  // grey with a dimmed title, so it never reads as something to press (in
  // dark the quieter fill, since lit glass there is itself a lighter grey).
  // A busy one stays glass (its press is still lighting it). Without Liquid
  // Glass (before iOS 26) Blanc's fills stay: an ink primary, a quiet fill,
  // and a primary that cannot be used yet in the track's grey.
  const glass = glassAvailable && !(disabled && !busy);
  const resting = glassAvailable ? disabled && !busy : primary && disabled && !busy;

  const demo = readPressDemo();
  const demoOn = demo !== null && demo.title === title;
  const slow = demoOn ? demo.slow : 1;
  const bloom = useTapBloom({ tone, dark, reduceMotion, slow });

  const sizeRef = useRef({ width: 0, height });
  const pressAt = useRef({ pageX: 0, pageY: 0, landed: false });
  const viewRef = useRef<ComponentRef<typeof View>>(null);

  // A full-width capsule gives a little; a small one more, so both move by about the same few points.
  // Reduce Motion: no give at all; the light's short fade answers the press.
  const sunk = reduceMotion ? 1 : fill ? 0.985 : 0.96;
  const spring = { damping: pressSpring.damping / slow, stiffness: pressSpring.stiffness / (slow * slow), mass: pressSpring.mass };
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const pressIn = (event: GestureResponderEvent) => {
    scale.set(withSpring(sunk, spring));
    const { locationX, locationY, pageX, pageY } = event.nativeEvent;
    const box = sizeRef.current;
    pressAt.current = { pageX, pageY, landed: false };
    bloom.play(clamp(locationX, 0, box.width || locationX), clamp(locationY, 0, box.height));
  };

  const pressOut = () => {
    scale.set(withSpring(1, spring));
    // onPress comes just before or just after this (React Native holds the
    // press out for a short minimum); a press that never lands was a scroll.
    setTimeout(() => {
      if (!pressAt.current.landed) bloom.cancel();
    }, 0);
  };

  const press = () => {
    pressAt.current.landed = true;
    haptics.tap();
    if (tone === 'effort') emitGlassPress({ x: pressAt.current.pageX, y: pressAt.current.pageY, tone: 'effort' });
    onPress();
  };

  // Debug only: the glass demo's scripted finger (-hyperDemo glass) presses this capsule by its
  // title: the sink, the light and (for a workout action) the wave, without the action itself.
  const scriptedNow = useRef<Pick<ScriptedCapsule, 'press' | 'release'>>({ press: () => {}, release: () => {} });
  scriptedNow.current = {
    press: (x, y) => {
      scale.set(withSpring(sunk, spring));
      bloom.play(x, y);
      if (tone === 'effort') {
        viewRef.current?.measureInWindow((wx, wy) => emitGlassPress({ x: wx + x, y: wy + y, tone: 'effort' }));
      }
    },
    release: () => scale.set(withSpring(1, spring)),
  };
  const [scripted] = useState<ScriptedCapsule>(() => ({
    measure: () =>
      new Promise((resolve) => {
        const view = viewRef.current;
        if (!view) resolve({ x: 0, y: 0, width: 0, height: 0 });
        else view.measureInWindow((x, y, width, h) => resolve({ x, y, width, height: h }));
      }),
    press: (x, y) => scriptedNow.current.press(x, y),
    release: () => scriptedNow.current.release(),
  }));
  useScriptedCapsule(title, scripted);

  // Debug only: a scripted press of this capsule, again and again or held.
  const [finger, setFinger] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!demoOn || !demo) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      const box = sizeRef.current;
      const x = box.width * demo.at;
      const y = box.height / 2;
      setFinger({ x, y });
      if (demo.hold !== null) {
        scale.set(sunk);
        bloom.hold(x, y, demo.hold);
        return;
      }
      scale.set(withSpring(sunk, spring));
      bloom.play(x, y);
      if (tone === 'effort') {
        viewRef.current?.measureInWindow((wx, wy) => emitGlassPress({ x: wx + x, y: wy + y, tone: 'effort' }));
      }
      timers.push(
        setTimeout(() => {
          scale.set(withSpring(1, spring));
          setFinger(null);
        }, 110 * slow),
      );
    };
    timers.push(setTimeout(run, 2500));
    if (demo.hold === null) {
      const every = setInterval(run, 2600 * slow);
      return () => {
        clearInterval(every);
        timers.forEach(clearTimeout);
      };
    }
    return () => timers.forEach(clearTimeout);
    // The demo reads launch arguments once; it never restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoOn]);

  const radius = height / 2;
  const look = glassLook(primary, dark);

  return (
    <AnimatedPressable
      ref={viewRef}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onLayout={(event: LayoutChangeEvent) => {
        sizeRef.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
      }}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onPress={press}
      style={[
        {
          // The drawn height below the accessibility text sizes; at them, at
          // least that and as tall as the title needs.
          ...(large ? { minHeight: height, paddingVertical: 10 } : { height }),
          // A capsule that fills its space only needs room for its round ends,
          // so short titles fit when several share a row.
          paddingHorizontal: fill ? 12 : size === 'large' ? 26 : 20,
          borderRadius: radius,
          borderCurve: 'continuous',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: fill ? 'stretch' : 'flex-start',
          backgroundColor: glass ? 'transparent' : resting ? (glassAvailable && dark ? c.fill : c.track) : primary ? c.capsule : c.fill,
          opacity: !glass && disabled && !resting ? 0.4 : 1,
        },
        animated,
        style,
      ]}>
      {glass ? (
        <GlassView
          // Interactive glass answers touches on its own; a busy capsule's doesn't.
          key={busy ? 'busy' : 'live'}
          glassEffectStyle={look.style}
          tintColor={look.tint}
          isInteractive={!busy}
          style={[StyleSheet.absoluteFill, { borderRadius: radius, borderCurve: 'continuous' }]}
        />
      ) : null}
      {look.ring && glass ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth * 2, borderColor: look.ring },
          ]}
        />
      ) : null}
      <BloomClip radius={radius}>{bloom.layer}</BloomClip>
      {busy ? (
        <ActivityIndicator color={glass ? c.ink : primary ? c.onCapsule : c.ink} />
      ) : (
        <View pointerEvents="none" style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, large ? { flexShrink: 1 } : null]}>
          {icon}
          <BlancText
            variant="headline"
            tone={resting ? 'upcoming' : glass ? 'ink' : primary ? 'onCapsule' : 'ink'}
            size={size === 'large' ? 17 : 16}
            weight={glass && !primary ? look.quietWeight : undefined}
            numberOfLines={large ? 3 : 1}
            style={[{ lineHeight: size === 'large' ? 22 : 20 }, large ? { flexShrink: 1, textAlign: 'center' } : null]}>
            {title}
          </BlancText>
        </View>
      )}
      {demoOn ? <DemoFinger x={finger?.x ?? 0} y={finger?.y ?? 0} dark={dark} shown={finger !== null} /> : null}
    </AnimatedPressable>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type GlassLook = {
  style: 'regular' | 'clear';
  tint?: string;
  ring?: string;
  quietWeight?: '500';
};

/**
 * The main action and a quiet one, both in glass.
 * Dark: plain frost for both, near-black on the page as in the approved
 * clip (a white tint turned the main action into a grey slab); the quiet
 * one has the lighter title.
 * Light: tinting glass only greys it, so the main action is plain white
 * frost and the quiet one clear glass drawn by a hairline (clear glass in
 * dark brightens to a grey slab, so dark keeps frost for both).
 */
function glassLook(primary: boolean, dark: boolean): GlassLook {
  if (dark) {
    return primary ? { style: 'regular' } : { style: 'regular', quietWeight: '500' };
  }
  return primary ? { style: 'regular', tint: 'rgba(255,255,255,0.9)' } : { style: 'clear', ring: 'rgba(0,0,0,0.16)', quietWeight: '500' };
}
