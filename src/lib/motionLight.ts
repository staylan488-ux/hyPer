import { readMotionPolicy } from '@/lib/motionPolicy';

/**
 * Motion-reactive light: a soft light direction that follows how the phone is
 * held, so glass and 3D objects catch it as you move — the way iOS glass
 * responds to tilt.
 *
 * Sources, best first:
 *  1. A native attitude stream (`pushMotionLight`, fed by the iOS bridge).
 *  2. `deviceorientation`, where the browser offers it without a permission
 *     prompt (never prompts).
 *  3. The page's scroll position, as a gentle stand-in.
 *
 * x/y are in −1…1 (x: right, y: toward the viewer's top). Off entirely under
 * reduced motion or reduced transparency.
 */
export interface MotionLight {
  x: number;
  y: number;
}

type Listener = (light: MotionLight) => void;

const listeners = new Set<Listener>();
let target: MotionLight = { x: 0, y: 0 };
let current: MotionLight = { x: 0, y: 0 };
let frame = 0;
let stopSource: (() => void) | null = null;
let nativeActive = false;

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** Map device orientation angles to a light offset, relative to a resting grip. */
export function lightFromOrientation(beta: number, gamma: number, restingBeta: number): MotionLight {
  return { x: clamp(gamma / 28), y: clamp((restingBeta - beta) / 28) };
}

/** Scroll stand-in: the light drifts slowly as the page moves. */
export function lightFromScroll(scrollTop: number): MotionLight {
  return { x: Math.sin(scrollTop / 900) * 0.35, y: Math.sin(scrollTop / 520) * 0.5 };
}

function tick() {
  frame = 0;
  const next = {
    x: current.x + (target.x - current.x) * 0.18,
    y: current.y + (target.y - current.y) * 0.18,
  };
  const settled = Math.abs(next.x - target.x) < 0.002 && Math.abs(next.y - target.y) < 0.002;
  current = settled ? { ...target } : next;
  listeners.forEach((listener) => listener(current));
  if (!settled) frame = requestAnimationFrame(tick);
}

function setTarget(next: MotionLight) {
  if (Math.abs(next.x - target.x) < 0.004 && Math.abs(next.y - target.y) < 0.004) return;
  target = next;
  if (!frame && typeof requestAnimationFrame !== 'undefined') frame = requestAnimationFrame(tick);
}

function startBrowserSource(): () => void {
  const Orientation = typeof window !== 'undefined'
    ? (window as Window & { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent
    : undefined;
  const orientationFree = Orientation !== undefined && typeof Orientation.requestPermission !== 'function';
  let restingBeta: number | null = null;
  let sawOrientation = false;

  const onOrientation = (event: DeviceOrientationEvent) => {
    if (nativeActive || event.beta == null || event.gamma == null) return;
    sawOrientation = true;
    restingBeta ??= event.beta;
    // Let the resting grip drift so the light recentres over time.
    restingBeta += (event.beta - restingBeta) * 0.01;
    setTarget(lightFromOrientation(event.beta, event.gamma, restingBeta));
  };

  const viewport = () => document.querySelector<HTMLElement>('[data-app-scroll-viewport]');
  const onScroll = () => {
    if (nativeActive || sawOrientation) return;
    setTarget(lightFromScroll(viewport()?.scrollTop ?? 0));
  };

  if (orientationFree) window.addEventListener('deviceorientation', onOrientation);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    if (orientationFree) window.removeEventListener('deviceorientation', onOrientation);
    document.removeEventListener('scroll', onScroll, { capture: true });
  };
}

/**
 * Subscribe to the light. The first subscriber starts the sources; the last
 * one to leave stops them. Returns an unsubscribe function.
 */
export function subscribeMotionLight(listener: Listener): () => void {
  const policy = readMotionPolicy();
  if (policy.reducedMotion || policy.reducedTransparency || typeof document === 'undefined') return () => {};
  listeners.add(listener);
  listener(current);
  if (!stopSource) stopSource = startBrowserSource();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopSource?.();
      stopSource = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/** Native bridge entry point: an attitude-derived light, already in −1…1. */
export function pushMotionLight(light: MotionLight | null) {
  nativeActive = light !== null;
  if (light) setTarget({ x: clamp(light.x), y: clamp(light.y) });
}

/** Test seam. */
export function resetMotionLight() {
  listeners.clear();
  stopSource?.();
  stopSource = null;
  target = { x: 0, y: 0 };
  current = { x: 0, y: 0 };
  nativeActive = false;
}
