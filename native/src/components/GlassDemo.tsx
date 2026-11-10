// Debug builds only (`-hyperDemo glass`): a scripted finger for recording the molten glass in the
// simulator, which has no way to touch the app from a script. On Today it drags through the page,
// scrolls down and back and taps Resume; on Train it drags once more and taps Log set (the set is
// logged through the store, as the app's own dev `logSet` action does, and the press lights the
// capsule and sends the warm wave as a real press does). A dot shows where the finger is.
// Release builds never run any of this.
import { router, useIsFocused } from 'expo-router';
import { useEffect, type ComponentRef, type RefObject } from 'react';
import { Settings, StyleSheet, useColorScheme, type ScrollView } from 'react-native';
import Animated, { makeMutable, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { initialWindowMetrics } from 'react-native-safe-area-context';

import { useAppStore } from '@/stores/appStore';
import { openTrain } from '~/lib/openTrain';
import { startRest, stopRest } from '~/lib/rest';

import { glassTouch } from './GlassField';

const DEMO_NAME = (() => {
  if (!__DEV__) return null;
  try {
    const name = Settings.get('hyperDemo');
    return name === 'glass' || name === 'glass-push' ? name : null;
  } catch {
    return null;
  }
})();
const DEMO = DEMO_NAME !== null;

/** The glass demo is running (debug builds, `-hyperDemo glass`). */
export const glassDemoOn = DEMO;

type Point = { x: number; y: number };

// ---- What the script reaches in the app ----

type ScrollTarget = RefObject<ComponentRef<typeof ScrollView> | null>;
let scrollTarget: ScrollTarget | null = null;

/** TabScroll: the page on screen is the one the demo scrolls. */
export function useDemoScrollTarget(ref: ScrollTarget) {
  // The demo is fixed for the life of the process, so the hook order never changes; without
  // it a page takes no interest in focus and is not rendered again on every tab change.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const focused = DEMO ? useIsFocused() : false;
  useEffect(() => {
    if (!DEMO || !focused) return;
    scrollTarget = ref;
    return () => {
      if (scrollTarget === ref) scrollTarget = null;
    };
  }, [ref, focused]);
}

/** What a capsule offers the scripted finger: where it is, and its press without its action. */
export type ScriptedCapsule = {
  /** The capsule's frame in window points (width 0 when it is not on screen). */
  measure(): Promise<{ x: number; y: number; width: number; height: number }>;
  /** Sink and light up from (x, y) inside the capsule; a workout action also sends the wave. */
  press(x: number, y: number): void;
  release(): void;
};

const capsules = new Map<string, Set<ScriptedCapsule>>();

/** Capsule: offers itself to the scripted finger under its title (debug demo only). */
export function useScriptedCapsule(title: string, capsule: ScriptedCapsule) {
  useEffect(() => {
    if (!DEMO) return;
    const set = capsules.get(title) ?? new Set();
    capsules.set(title, set);
    set.add(capsule);
    return () => {
      set.delete(capsule);
    };
  }, [title, capsule]);
}

async function findCapsule(title: string) {
  for (const capsule of capsules.get(title) ?? []) {
    const box = await capsule.measure();
    if (box.width > 0 && box.y > 0 && box.y < 900) return { capsule, box };
  }
  return null;
}

async function logNextSet() {
  const workout = useAppStore.getState().currentWorkout;
  const next = workout?.sets.find((set) => !set.completed);
  if (!next) return;
  await useAppStore.getState().logSet(next.id, next.weight ?? 0, next.reps ?? 0, next.rpe ?? undefined);
  startRest(next.exercise_id);
}

// ---- The finger ----

const fx = makeMutable(-100);
const fy = makeMutable(-100);
const shown = makeMutable(0);
const pressed = makeMutable(0);
let started = false;

// A tab page at rest sits under the status bar and the large title (TabScroll's measure).
const REST_Y = -((initialWindowMetrics?.insets.top ?? 62) + 106);

/** The script, in ms from when the app is up (Today, with a live workout). */
const START = 1500;

export function GlassDemo() {
  const dark = useColorScheme() !== 'light';
  useEffect(() => {
    if (!DEMO || started) return;
    started = true;
    // A rest left running by an earlier take would show its bar before Log set.
    stopRest();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, START + ms));
    const show = (p: Point) => {
      fx.value = p.x;
      fy.value = p.y;
      shown.value = withTiming(1, { duration: 120 });
    };
    const hide = () => {
      shown.value = withTiming(0, { duration: 220 });
    };
    const drag = (start: number, from: Point, to: Point, duration: number) => {
      at(start - 150, () => show(from));
      at(start, () => {
        pressed.value = withTiming(1, { duration: 80 });
        glassTouch(0, from.x, from.y);
      });
      const steps = Math.round(duration / 16);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const x = from.x + (to.x - from.x) * e + 34 * Math.sin(e * Math.PI * 2);
        const y = from.y + (to.y - from.y) * e;
        at(start + i * 16, () => {
          fx.value = x;
          fy.value = y;
          glassTouch(1, x, y);
        });
      }
      at(start + duration + 20, () => {
        glassTouch(2, to.x, to.y);
        pressed.value = withTiming(0, { duration: 90 });
        hide();
      });
    };
    // A finger on the page that scrolls it (the stir comes from the scroll itself, as in the app).
    const scroll = (start: number, y: number, from: Point, to: Point) => {
      at(start - 150, () => show(from));
      at(start, () => {
        pressed.value = withTiming(1, { duration: 80 });
        fx.value = withTiming(to.x, { duration: 380 });
        fy.value = withTiming(to.y, { duration: 380 });
        scrollTarget?.current?.scrollTo({ y, animated: true });
      });
      at(start + 400, () => {
        pressed.value = withTiming(0, { duration: 90 });
        hide();
      });
    };
    const tap = (start: number, title: string, then: () => void) => {
      let found: Awaited<ReturnType<typeof findCapsule>> = null;
      at(start - 260, () => {
        void findCapsule(title).then((hit) => {
          found = hit;
          if (hit) show({ x: hit.box.x + hit.box.width * 0.5, y: hit.box.y + hit.box.height / 2 });
        });
      });
      at(start, () => {
        if (!found) return;
        pressed.value = withTiming(1, { duration: 60 });
        found.capsule.press(found.box.width * 0.5, found.box.height / 2);
      });
      at(start + 120, () => {
        pressed.value = withTiming(0, { duration: 90 });
        found?.capsule.release();
        if (found) then();
      });
      at(start + 420, hide);
    };
    if (DEMO_NAME === 'glass-push') {
      // Pages over the glass: a push and a pop, to check that two pages never show at once.
      at(1500, () => router.push('/today/progress' as never));
      at(4500, () => router.back());
      return () => timers.forEach(clearTimeout);
    }
    // Today: settled glass, a slow drag up through the page, a scroll down and back, Resume.
    drag(1000, { x: 300, y: 690 }, { x: 110, y: 400 }, 1400);
    scroll(3300, REST_Y + 480, { x: 220, y: 640 }, { x: 220, y: 300 });
    scroll(4900, REST_Y, { x: 220, y: 300 }, { x: 220, y: 640 });
    tap(6600, 'Resume', () => openTrain());
    // Train: a drag across the page, then Log set: the warm wave, and the rest begins.
    drag(8600, { x: 90, y: 760 }, { x: 320, y: 560 }, 1200);
    tap(10800, 'Log set', () => void logNextSet());
    return () => timers.forEach(clearTimeout);
  }, []);

  const dot = useAnimatedStyle(() => ({
    opacity: shown.value * (0.6 + 0.4 * pressed.value),
    transform: [{ translateX: fx.value - 22 }, { translateY: fy.value - 22 }, { scale: 1 - 0.15 * pressed.value }],
  }));
  if (!DEMO) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.dot,
        dark ? styles.dark : styles.light,
        dot,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { position: 'absolute', left: 0, top: 0, width: 44, height: 44, borderRadius: 22, borderWidth: 1 },
  dark: { backgroundColor: 'rgba(255, 255, 255, 0.30)', borderColor: 'rgba(255, 255, 255, 0.55)' },
  light: { backgroundColor: 'rgba(0, 0, 0, 0.18)', borderColor: 'rgba(0, 0, 0, 0.30)' },
});
