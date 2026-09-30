import { readMotionPolicy } from '@/lib/motionPolicy';
import { startNativeMotion } from '@/lib/nativeGlassSurfaces';

/**
 * Motion-reactive light: a soft light direction that follows how the phone is
 * held, so glass and 3D objects catch it as you move — the way iOS glass
 * responds to tilt.
 *
 * Sources, best first:
 *  1. The native CoreMotion attitude stream (iOS glass surfaces bridge).
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
let lingerTimer: ReturnType<typeof setTimeout> | null = null;
let nativeActive = false;

/**
 * How long the sources outlive the last subscriber. Opening a sheet or menu
 * right after another closes then keeps the same stream, so CoreMotion is not
 * restarted over the bridge and the light keeps its resting grip.
 */
export const MOTION_LIGHT_LINGER_MS = 1800;

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

function stopSources() {
  if (lingerTimer !== null) clearTimeout(lingerTimer);
  lingerTimer = null;
  stopSource?.();
  stopSource = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

/**
 * Subscribe to the light. The first subscriber starts the sources; once the
 * last one leaves they stop after a short linger (at once under reduced
 * motion or transparency). Returns an unsubscribe function.
 */
export function subscribeMotionLight(listener: Listener): () => void {
  const policy = readMotionPolicy();
  if (policy.reducedMotion || policy.reducedTransparency || typeof document === 'undefined') return () => {};
  listeners.add(listener);
  listener(current);
  if (lingerTimer !== null) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  if (!stopSource) {
    const stopBrowser = startBrowserSource();
    // The native attitude stream (iOS) outranks browser sources once it runs.
    let stopNative: (() => void) | null = null;
    let cancelled = false;
    void startNativeMotion((light) => pushMotionLight(light)).then((stop) => {
      if (cancelled) stop?.();
      else stopNative = stop;
    });
    stopSource = () => {
      cancelled = true;
      stopBrowser();
      stopNative?.();
      if (nativeActive) pushMotionLight(null);
    };
  }
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(listener);
    if (listeners.size > 0 || !stopSource) return;
    const now = readMotionPolicy();
    if (now.reducedMotion || now.reducedTransparency) stopSources();
    else if (lingerTimer === null) lingerTimer = setTimeout(stopSources, MOTION_LIGHT_LINGER_MS);
  };
}

/** Native bridge entry point: an attitude-derived light, already in −1…1. */
export function pushMotionLight(light: MotionLight | null) {
  // Late samples after every subscriber left must not wake the light.
  if (light !== null && !stopSource) return;
  nativeActive = light !== null;
  if (light) setTarget({ x: clamp(light.x), y: clamp(light.y) });
}

/** Test seam. */
export function resetMotionLight() {
  listeners.clear();
  if (lingerTimer !== null) clearTimeout(lingerTimer);
  lingerTimer = null;
  stopSource?.();
  stopSource = null;
  if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
  frame = 0;
  target = { x: 0, y: 0 };
  current = { x: 0, y: 0 };
  nativeActive = false;
}
