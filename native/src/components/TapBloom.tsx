import { useCallback, useMemo } from 'react';
import { Settings, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// Light that blooms from the fingertip inside a glass button, so nobody ever
// wonders whether a tap registered. The numbers are the approved clip's
// (modules/hyper-glass-field/reference/glass6.html): the light rises over 140 ms, then drains
// away with a 260 ms time constant, while its edge grows from the fingertip
// across the button in 500 ms. The clip drew a 402 pt phone 270 px wide, so
// its 20 → 280 px reach is 30 → 417 pt here; an ellipse 0.9 as tall as wide.
//
// Effort presses (Log set, Resume, Start, Finish workout) bloom warm, the
// same light the glass field's wave carries; every other button blooms a
// neutral light. Reduce Motion: no growing light, a short even fade.

export type BloomTone = 'effort' | 'neutral';

const RISE = 140;
const DECAY = 260;
const GROW = 500;
const REACH_START = 30;
const REACH = 417;
const ASPECT = 0.9;
/** Where the light is all but gone (e^-5.5 ≈ 0.4 %). */
const END = RISE + DECAY * 5.5;

const FADE_IN = 90;
const FADE_OUT = 240;
const FADE_PEAK = 0.75;
const FADE_END = FADE_IN + FADE_OUT;

/** A touch that turned into a scroll: the light goes out quickly instead of playing on. */
const CANCEL = 120;

type Look = { image: string };

// The clip added the light to the glass in dark (screen) and stained it in
// light (multiply). Blend modes do not reach through Liquid Glass (a view
// over it is composited normally), so these are the same colours worked out
// as plain see-through light over the glass's own grey: the dark effort
// centre is screen((255,140,80) at .85) over the glass, the light one is
// multiply(250,170,130) into it, and so on out to the rim.
function looks(tone: BloomTone, dark: boolean): Look {
  if (dark) {
    return tone === 'effort'
      ? { image: 'radial-gradient(circle closest-side, rgba(255,158,108,0.85) 0%, rgba(255,143,106,0.35) 50%, rgba(255,143,106,0) 100%)' }
      : { image: 'radial-gradient(circle closest-side, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0) 100%)' };
  }
  return tone === 'effort'
    ? { image: 'radial-gradient(circle closest-side, rgba(228,138,95,0.72) 0%, rgba(228,140,95,0.5) 45%, rgba(228,140,95,0) 100%)' }
    : { image: 'radial-gradient(circle closest-side, rgba(0,0,0,0.14) 0%, rgba(0,0,0,0.08) 45%, rgba(0,0,0,0) 100%)' };
}

export type TapBloom = {
  /** The light, to sit between a button's glass and its label, clipped to the button. */
  layer: React.ReactNode;
  /** Starts the light at a point in the button's own coordinates. */
  play: (x: number, y: number) => void;
  /** The press was cancelled (the touch scrolled): the light goes out fast. */
  cancel: () => void;
  /** Debug only: holds the light as it is `age` ms after a press. */
  hold: (x: number, y: number, age: number) => void;
};

/**
 * The light for one button. `slow` stretches time (debug recordings only).
 */
export function useTapBloom({
  tone,
  dark,
  reduceMotion,
  slow = 1,
}: {
  tone: BloomTone;
  dark: boolean;
  reduceMotion: boolean;
  slow?: number;
}): TapBloom {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  // Milliseconds since the press, and a multiplier that a cancel drains.
  const age = useSharedValue(-1);
  const left = useSharedValue(1);

  const look = looks(tone, dark);

  const style = useAnimatedStyle(() => {
    const t = age.get();
    if (t < 0) return { opacity: 0, transform: [{ translateX: x.get() - REACH }, { translateY: y.get() - REACH }, { scale: 0 }] };
    let opacity: number;
    let scale: number;
    if (reduceMotion) {
      opacity = (t < FADE_IN ? t / FADE_IN : Math.max(0, 1 - (t - FADE_IN) / FADE_OUT)) * FADE_PEAK;
      scale = 1;
    } else {
      opacity = t < RISE ? t / RISE : Math.exp(-(t - RISE) / DECAY);
      scale = (REACH_START + Math.min(1, t / GROW) * (REACH - REACH_START)) / REACH;
    }
    return {
      opacity: opacity * left.get(),
      transform: [{ translateX: x.get() - REACH }, { translateY: y.get() - REACH }, { scaleX: scale }, { scaleY: scale * ASPECT }],
    };
  });

  const play = useCallback(
    (px: number, py: number) => {
      const end = reduceMotion ? FADE_END : END;
      cancelAnimation(age);
      cancelAnimation(left);
      x.set(px);
      y.set(py);
      left.set(1);
      age.set(0);
      age.set(withTiming(end, { duration: end * slow, easing: Easing.linear, reduceMotion: ReduceMotion.Never }));
    },
    [age, left, reduceMotion, slow, x, y],
  );

  const cancel = useCallback(() => {
    left.set(withTiming(0, { duration: CANCEL * slow, reduceMotion: ReduceMotion.Never }));
  }, [left, slow]);

  const hold = useCallback(
    (px: number, py: number, at: number) => {
      cancelAnimation(age);
      cancelAnimation(left);
      x.set(px);
      y.set(py);
      left.set(1);
      age.set(at);
    },
    [age, left, x, y],
  );

  const layer = useMemo(
    () => (
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            width: REACH * 2,
            height: REACH * 2,
            backgroundImage: look.image,
          },
          style,
        ]}
      />
    ),
    [look.image, style],
  );

  return { layer, play, cancel, hold };
}

/** Clips a bloom to its button's shape. */
export function BloomClip({ radius, children }: { radius: number; children: React.ReactNode }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden' }]}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Debug builds only: a scripted press, for screenshots and recordings of the
// pressed state (the simulator cannot be tapped by a script).
//
//   -hyperPress "Log set"     presses the capsule with that title again and again
//   -hyperPressSlow 4         plays the press 4 times slower
//   -hyperPressHold 220       holds it pressed, the light as it is 220 ms in
//   -hyperPressAt 0.3         the fingertip's place across the capsule (0–1, default 0.42)

export type PressDemo = { title: string; slow: number; hold: number | null; at: number };

let demo: PressDemo | null | undefined;

export function readPressDemo(): PressDemo | null {
  if (!__DEV__) return null;
  if (demo !== undefined) return demo;
  try {
    const title = Settings.get('hyperPress');
    const slow = Number(Settings.get('hyperPressSlow'));
    const hold = Number(Settings.get('hyperPressHold'));
    const at = Number(Settings.get('hyperPressAt'));
    demo =
      typeof title === 'string' && title
        ? {
            title,
            slow: Number.isFinite(slow) && slow >= 1 ? slow : 1,
            hold: Number.isFinite(hold) && hold > 0 ? hold : null,
            at: Number.isFinite(at) && at > 0 && at < 1 ? at : 0.42,
          }
        : null;
  } catch {
    demo = null;
  }
  return demo;
}

/** The scripted finger, drawn as the earlier recordings drew it: a 44 pt dot. */
export function DemoFinger({ x, y, dark, shown }: { x: number; y: number; dark: boolean; shown: boolean }) {
  if (!shown) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - 22,
        top: y - 22,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: dark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.18)',
        borderWidth: 1,
        borderColor: dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.30)',
      }}
    />
  );
}
