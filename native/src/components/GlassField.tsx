// The molten-glass field behind the app: a real stable-fluids simulation (the approved
// glass6.html, ported to Metal in modules/hyper-glass-field) drawn as thin edges of light on
// true black, or soft grey lines on chalk. It drifts calmly on its own, stirs under the finger
// and with scrolling, and a warm wave rises through it from a workout press.
//
// The field never takes a touch: put <GlassField /> behind a page and spread
// `glassTouchHandlers` on the page's wrapper so the field observes the finger. A build
// without the native module (an older binary) draws nothing and every call does nothing.
import type { NativeScrollEvent, NativeSyntheticEvent, GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { glassNative, hasGlassField, HyperGlassFieldView, type HyperGlassFieldViewProps } from '../../modules/hyper-glass-field';
import { useReduceMotion } from '~/lib/accessibility';
import { onGlassPress } from '~/lib/glassPress';

export { hasGlassField };

type GlassFieldProps = {
  style?: StyleProp<ViewStyle>;
  /** Stop the field while its page is not the one on screen (a hidden tab, say). */
  paused?: boolean;
  /** Debug comparison only: a fixed look, with its own simulation. The app's fields follow the appearance by themselves. */
  appearance?: 'dark' | 'light';
  /** Debug only (comparison screen). */
  debug?: Pick<HyperGlassFieldViewProps, 'demo' | 'demoFrameMs' | 'demoDot' | 'snapshot' | 'debugStats'>;
};

/**
 * The field, filling its parent unless a style says otherwise. Decorative: hidden from VoiceOver.
 * Every field in the app shows the same simulation and starts and stops itself as it comes on
 * and off screen, so the tabs need tell it nothing.
 */
export function GlassField({ style, paused, appearance, debug }: GlassFieldProps) {
  const reduceMotion = useReduceMotion();
  if (!HyperGlassFieldView) return null;
  return (
    <HyperGlassFieldView
      style={style ?? StyleSheet.absoluteFill}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      appearance={appearance}
      reduceMotion={reduceMotion}
      paused={paused}
      {...debug}
    />
  );
}

// ---- What the app sends the field ----

let fingerId: string | null = null;

function touchOf(event: GestureResponderEvent) {
  const e = event.nativeEvent;
  const changed = e.changedTouches?.find((t) => String(t.identifier) === fingerId) ?? e.changedTouches?.[0];
  return changed ?? e;
}

/**
 * Spread on the view that holds a page (`<View {...glassTouchHandlers}>`): the field follows the
 * first finger without ever capturing it, so every control underneath works as before.
 */
export const glassTouchHandlers = {
  onTouchStart(event: GestureResponderEvent) {
    if (!glassNative || fingerId !== null) return;
    const t = touchOf(event);
    fingerId = String(t.identifier);
    glassNative.touch(0, t.pageX, t.pageY);
  },
  onTouchMove(event: GestureResponderEvent) {
    if (!glassNative || fingerId === null) return;
    const t = event.nativeEvent.touches?.find((x) => String(x.identifier) === fingerId);
    if (t) glassNative.touch(1, t.pageX, t.pageY);
  },
  onTouchEnd(event: GestureResponderEvent) {
    if (!glassNative || fingerId === null) return;
    const ended = event.nativeEvent.changedTouches?.some((x) => String(x.identifier) === fingerId) ?? true;
    if (!ended) return;
    const t = touchOf(event);
    glassNative.touch(2, t.pageX, t.pageY);
    fingerId = null;
  },
  onTouchCancel(event: GestureResponderEvent) {
    glassTouchHandlers.onTouchEnd(event);
  },
};

/** A finger at a window point: phase 0 down, 1 moved, 2 up (for scripted fingers; pages use glassTouchHandlers). */
export function glassTouch(phase: 0 | 1 | 2, pageX: number, pageY: number) {
  glassNative?.touch(phase, pageX, pageY);
}

/** The warm wave from a press at a window point (a touch's pageX / pageY). */
export function glassWave(pageX: number, pageY: number) {
  glassNative?.wave(pageX, pageY);
}

/**
 * Once, at the app's root: a workout press (Log set, Resume, Start, Finish workout) sends the
 * warm wave up through the field on screen from where the finger pressed.
 */
export function useGlassPressWave() {
  useEffect(() => onGlassPress((press) => glassWave(press.x, press.y)), []);
}

/** The page scrolled by (dx, dy) points. */
export function glassStir(dx: number, dy: number) {
  if (dx !== 0 || dy !== 0) glassNative?.stir(dx, dy);
}

/**
 * An onScroll handler that stirs the field by how far the page moved since the last event.
 * One per scroll view (it remembers that view's last offset).
 */
export function makeGlassScrollStir() {
  let last: { x: number; y: number } | null = null;
  return (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { x, y } = event.nativeEvent.contentOffset;
    if (last) glassStir(x - last.x, y - last.y);
    last = { x, y };
  };
}

/** A raw splat in the reference's units (x, y in 0…1 with y up; colour 0 for none). */
export function glassSplat(x: number, y: number, dx: number, dy: number, color: [number, number, number] = [0, 0, 0], radius = 0.0022) {
  glassNative?.splat(x, y, dx, dy, color[0], color[1], color[2], radius);
}

/** Every field: 'dark', 'light', or null to follow the app's appearance. */
export function setGlassAppearance(appearance: 'dark' | 'light' | null) {
  glassNative?.setAppearance(appearance);
}

/** Every field: force Reduce Motion on or off, or null to follow iOS. */
export function setGlassReduceMotion(on: boolean | null) {
  glassNative?.setReduceMotion(on);
}
