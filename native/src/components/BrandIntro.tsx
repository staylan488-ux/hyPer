import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { markFace, wordFace } from '~/components/BrandMark';
import { introReveal, markIntroPlayed, markShown, useMarkAnchors } from '~/lib/brand';
import {
  BLOOM,
  drawnMark,
  FOLD,
  landing,
  P_DRAWN,
  P_SIZE,
  PAD,
  plausibleAnchor,
  TUCK,
  tuckDirection,
  WORD_SIZE,
  wordLayout,
  type Letter,
  type MarkAnchor,
} from '~/lib/brandGeometry';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

// The cold-launch intro. Once the first screen has mounted under the launch
// screen, the red P blooms in, "hyPer" unfolds out of it and holds, the word
// folds back into the P, and the P flies to the resting mark on that screen
// (Today's corner, or the sign-in emblem) while the app rises in under a
// lifting veil. A tap skips ahead. The root layout leaves it out under Reduce
// Motion.

const WORD = wordLayout();
const DRAWN = drawnMark();
/** The drawn P's own scale once the word is spelled out. */
const REST = 1 / BLOOM;
/** Where the word is spelled out: centred, a little above the middle. */
const ORIGIN_Y = 0.4;

const ms = {
  /** The P fades in, shrinking from its bloom. */
  bloom: 380,
  /** A beat before it settles and the letters come out. */
  breath: 140,
  /** The outer letters follow the inner ones. */
  stagger: 45,
  /** The spelled-out word holds at least this long. */
  hold: 560,
  fold: 260,
  /** The P takes off once the letters have mostly folded into it. */
  takeOff: 150,
  handOver: 180,
  veil: 520,
  reveal: 700,
  /** The first screen is known but has no resting mark yet: start without one after this long. */
  firstScreen: 600,
  /** Frames never came smoothly: start anyway. */
  startFallback: 900,
  /** Signed in, but no resting mark on screen after this long: fade out in place. */
  noAnchor: 1200,
};

/**
 * Smooth frames in a row before the P blooms. iOS removes the launch screen
 * and mounts the first screen on the main thread; an animation started during
 * that work would jump ahead unseen.
 */
const SMOOTH_FRAMES = 6;
const SMOOTH_FRAME_MS = 24;

// Duration-based springs: `duration` is the perceived length; iOS-style
// settling takes about half as long again.
const spring = {
  /** The P to its resting size, with a slight overshoot. */
  settle: { duration: 440, dampingRatio: 0.62 },
  unfold: { duration: 460, dampingRatio: 0.7 },
  centre: { duration: 520, dampingRatio: 1 },
  glideX: { duration: 640, dampingRatio: 1 },
  /** Leads the x spring, so the flight arcs up and then into the corner. */
  glideY: { duration: 540, dampingRatio: 1 },
  /** Shrinks a touch past its size and settles back as it lands. */
  glideScale: { duration: 600, dampingRatio: 0.75 },
};

/** A skipped intro moves this much faster. */
const QUICK = 0.6;

const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
const fadeIn = Easing.out(Easing.cubic);
const easeIn = Easing.bezier(0.5, 0, 0.75, 0);
const easeInOut = Easing.bezier(0.4, 0, 0.2, 1);

type BrandIntroProps = {
  /** The first screen is known (the saved session has been read). */
  ready: boolean;
  /** The intro has handed over; unmount it. */
  onDone: () => void;
};

export function BrandIntro({ ready, onDone }: BrandIntroProps) {
  const c = useBlanc();
  const { width, height } = useWindowDimensions();
  const origin = { x: width / 2, y: height * ORIGIN_Y };
  const measure = useMarkAnchors((state) => state.anchors.at(-1) ?? null);

  const [firstScreen, setFirstScreen] = useState(false);
  const [started, setStarted] = useState(false);
  const [spelled, setSpelled] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [noAnchor, setNoAnchor] = useState(false);
  const finished = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const veil = useSharedValue(1);
  const pOpacity = useSharedValue(0);
  const bloom = useSharedValue(BLOOM);
  const rise = useSharedValue(0.05 * P_SIZE);
  const h = useSharedValue(0);
  const y = useSharedValue(0);
  const e = useSharedValue(0);
  const r = useSharedValue(0);
  const fold = useSharedValue(0);
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const gs = useSharedValue(1);
  const target = useSharedValue<{ x: number; y: number } | null>(null);
  const arrived = useSharedValue(0);
  const smooth = useSharedValue(0);

  const later = (run: () => void, delay: number) => {
    timers.current.push(setTimeout(run, delay));
  };
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const finish = useEffectEvent(() => {
    if (finished.current) return;
    finished.current = true;
    markIntroPlayed();
    markShown.value = 1;
    introReveal.value = 1;
    onDone();
  });

  // Before the launch screen goes: hide the resting marks and lower the content.
  useLayoutEffect(() => {
    markShown.value = 0;
    introReveal.value = 0;
  }, []);

  // Wait for the first screen: the saved session read and, signed in or not,
  // its resting mark mounted.
  useEffect(() => {
    if (!ready || firstScreen) return;
    if (measure) {
      setFirstScreen(true);
      return;
    }
    const timer = setTimeout(() => setFirstScreen(true), ms.firstScreen);
    return () => clearTimeout(timer);
  }, [ready, measure, firstScreen]);

  const frames = useFrameCallback((frame) => {
    const gap = frame.timeSincePreviousFrame;
    if (gap === null) return;
    smooth.value = gap < SMOOTH_FRAME_MS ? smooth.value + 1 : 0;
    if (smooth.value === SMOOTH_FRAMES) scheduleOnRN(setStarted, true);
  }, false);

  // Swap the launch screen for the veil (the same chalk, so it is invisible),
  // then start once frames come smoothly.
  useEffect(() => {
    if (!firstScreen) return;
    void SplashScreen.hideAsync().catch(() => {});
    frames.setActive(true);
    const fallback = setTimeout(() => setStarted(true), ms.startFallback);
    return () => clearTimeout(fallback);
  }, [firstScreen]);

  // The P blooms, settles, and the word unfolds out of it.
  useEffect(() => {
    if (!started) return;
    frames.setActive(false);
    pOpacity.value = withTiming(1, { duration: ms.bloom + 40, easing: fadeIn });
    rise.value = withTiming(0, { duration: ms.bloom, easing: easeOut });
    bloom.value = withSequence(
      withTiming(1.72, { duration: ms.bloom, easing: easeOut }),
      withDelay(ms.breath, withSpring(1, spring.settle)),
    );
    const out = ms.bloom + ms.breath;
    y.value = withDelay(out, withSpring(1, spring.unfold));
    e.value = withDelay(out, withSpring(1, spring.unfold));
    h.value = withDelay(out + ms.stagger, withSpring(1, spring.unfold));
    r.value = withDelay(out + ms.stagger, withSpring(1, spring.unfold));
    // Centre the whole word, not just the P, as it spells out.
    gx.value = withDelay(out, withSpring(WORD.centring, spring.centre));
    later(() => setSpelled(true), out + spring.unfold.duration + ms.hold);
    // VoiceOver reads the app underneath; don't keep it waiting.
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => on && setSkipped(true))
      .catch(() => {});
  }, [started]);

  const fadeOut = useEffectEvent(() => {
    fold.value = withTiming(1, { duration: 300, easing: easeIn });
    pOpacity.value = withTiming(0, { duration: 300 });
    veil.value = withTiming(0, { duration: 420, easing: easeInOut });
    introReveal.value = withTiming(1, { duration: 600, easing: easeOut });
    markShown.value = withDelay(150, withTiming(1, { duration: 300 }));
    later(finish, 650);
  });

  const land = useEffectEvent(async (measureAnchor: () => Promise<MarkAnchor | null>, quick: boolean) => {
    // A mark that has only just mounted may not be laid out yet.
    let anchor: MarkAnchor | null = null;
    for (let attempt = 0; attempt < 4 && !anchor; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 60));
      const measured = await measureAnchor();
      anchor = measured && plausibleAnchor(measured) ? measured : null;
    }
    if (!anchor) {
      fadeOut();
      return;
    }

    const end = landing(anchor);
    const k = quick ? QUICK : 1;
    const paced = (config: { duration: number; dampingRatio: number }) => ({ ...config, duration: config.duration * k });
    const tx = end.x - origin.x;
    const ty = end.y - origin.y;

    // The letters fold back into the P, and any bloom left settles.
    fold.value = withTiming(1, { duration: ms.fold * k, easing: easeInOut });
    pOpacity.value = withTiming(1, { duration: 120 });
    rise.value = withTiming(0, { duration: 120 });
    bloom.value = withSpring(1, paced(spring.settle));
    // Then the P alone takes off, and the app comes up under the lifting veil.
    const takeOff = ms.takeOff * k;
    veil.value = withDelay(takeOff / 2, withTiming(0, { duration: ms.veil * k, easing: easeInOut }));
    introReveal.value = withDelay(takeOff / 2, withTiming(1, { duration: ms.reveal * k, easing: easeOut }));
    target.value = { x: tx, y: ty };

    const arrive = () => {
      'worklet';
      arrived.value += 1;
      if (arrived.value !== 3) return;
      // Hand over: the resting mark shows underneath and the flying one fades
      // off it. Drawn small rather than scaled down, the resting P is a touch
      // crisper, so the swap reads as the P coming into focus.
      markShown.value = 1;
      pOpacity.value = withTiming(0, { duration: ms.handOver }, () => {
        'worklet';
        scheduleOnRN(finish);
      });
    };
    gx.value = withDelay(takeOff, withSpring(tx, paced(spring.glideX), arrive));
    gy.value = withDelay(takeOff, withSpring(ty, paced(spring.glideY), arrive));
    gs.value = withDelay(takeOff, withSpring(end.scale, paced(spring.glideScale), arrive));
    // Should a spring ever be cut short, hand over anyway.
    later(finish, takeOff + spring.glideX.duration * 1.5 * k + ms.handOver + 400);
  });

  // Leave once the word has had its moment, or was tapped away.
  useEffect(() => {
    if (!started || leaving || !(spelled || skipped) || !ready) return;
    if (!measure) {
      const timer = setTimeout(() => setNoAnchor(true), ms.noAnchor);
      return () => clearTimeout(timer);
    }
    setLeaving(true);
    void land(measure, skipped);
  }, [started, leaving, spelled, skipped, ready, measure]);

  useEffect(() => {
    if (!noAnchor || leaving) return;
    setLeaving(true);
    fadeOut();
  }, [noAnchor, leaving]);

  // A soft tap as the P reaches its corner.
  useAnimatedReaction(
    () => {
      const to = target.value;
      return to !== null && Math.abs(gx.value - to.x) < 1.5 && Math.abs(gy.value - to.y) < 1.5;
    },
    (near, wasNear) => {
      if (near && !wasNear) scheduleOnRN(haptics.land);
    },
  );

  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));

  // The word's flight. Scales about the spelling point, not the screen centre.
  const flightStyle = useAnimatedStyle(() => {
    const s = gs.value;
    return {
      transform: [
        { translateX: gx.value + (origin.x - width / 2) * (1 - s) },
        { translateY: gy.value + (origin.y - height / 2) * (1 - s) },
        { scale: s },
      ],
    };
  });

  // The P's bloom, scaled about its ink centre rather than its text box.
  const pStyle = useAnimatedStyle(() => {
    const s = bloom.value * REST;
    return {
      opacity: pOpacity.value,
      transform: [
        { translateX: DRAWN.inkOffsetX * (1 - s) },
        { translateY: rise.value + DRAWN.inkOffsetY * (1 - s) },
        { scale: s },
      ],
    };
  });

  const letterStyles: Record<Letter, ReturnType<typeof useAnimatedStyle>> = {
    h: useLetterStyle(h, fold, 'h'),
    y: useLetterStyle(y, fold, 'y'),
    e: useLetterStyle(e, fold, 'e'),
    r: useLetterStyle(r, fold, 'r'),
  };

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={leaving ? 'none' : 'auto'}
      onTouchStart={() => setSkipped(true)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.ground }, veilStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, flightStyle]} pointerEvents="none">
        {WORD.letters.map(({ letter, box }) => (
          <Animated.Text
            key={letter}
            allowFontScaling={false}
            style={[
              styles.glyph,
              wordFace,
              {
                left: origin.x + box.left,
                top: origin.y + box.top,
                fontSize: WORD_SIZE,
                paddingHorizontal: PAD * WORD_SIZE,
                color: c.ink,
              },
              letterStyles[letter],
            ]}>
            {letter}
          </Animated.Text>
        ))}
        <Animated.Text
          allowFontScaling={false}
          style={[
            styles.glyph,
            markFace,
            {
              // A fixed box, so scaling about the ink centre does not hang on how iOS sizes the text.
              left: origin.x + DRAWN.left,
              top: origin.y + DRAWN.top,
              width: DRAWN.width,
              height: DRAWN.height,
              fontSize: P_DRAWN,
              paddingHorizontal: PAD * P_DRAWN,
              color: c.brand,
            },
            pStyle,
          ]}>
          P
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

/** A letter tucked toward the P (0), out in place (1), then folded back with `fold`. */
function useLetterStyle(out: SharedValue<number>, fold: SharedValue<number>, letter: Letter) {
  const direction = tuckDirection(letter);
  return useAnimatedStyle(() => ({
    opacity:
      interpolate(out.value, [0, 0.55], [0, 1], Extrapolation.CLAMP) *
      interpolate(fold.value, [0, 0.7], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateX: direction * ((1 - out.value) * TUCK + fold.value * FOLD) }],
  }));
}

const styles = StyleSheet.create({
  glyph: { position: 'absolute' },
});
