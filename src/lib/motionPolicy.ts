import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * One motion policy for the whole app. Components ask what they may do rather
 * than reading media queries themselves:
 *
 * - `reducedMotion`: skip decorative motion entirely (no slow-motion stand-in).
 *   Particles, camera moves, draw-ins and moving light are off; data appears
 *   in its final state.
 * - `reducedTransparency`: moving light and specular highlights are off, and
 *   the materials layer already drops blur (see materials.css).
 * - `rich`: the device can afford WebGL scenes and particle layers.
 *
 * MotionConfig reducedMotion="user" (main.tsx) still covers motion/react
 * transforms; this policy covers everything motion/react does not own.
 */
export interface MotionPolicy {
  reducedMotion: boolean;
  reducedTransparency: boolean;
  rich: boolean;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce), (prefers-contrast: more)';

function media(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(query);
}

let webglProbe: boolean | null = null;

/** Cached WebGL capability probe; the probe context is released immediately. */
export function supportsWebGL(): boolean {
  if (webglProbe !== null) return webglProbe;
  if (typeof document === 'undefined') return (webglProbe = false);
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    webglProbe = gl != null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

/** Test seam: forget the cached probe. */
export function resetWebGLProbe(value: boolean | null = null) {
  webglProbe = value;
}

function isConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return true;
  const cores = navigator.hardwareConcurrency;
  return typeof cores === 'number' && cores > 0 && cores <= 2;
}

export function readMotionPolicy(): MotionPolicy {
  const reducedMotion = media(REDUCED_MOTION)?.matches ?? false;
  const reducedTransparency = media(REDUCED_TRANSPARENCY)?.matches ?? false;
  return {
    reducedMotion,
    reducedTransparency,
    rich: !reducedMotion && !isConstrainedDevice() && supportsWebGL(),
  };
}

let cached: MotionPolicy | null = null;
let cachedKey = '';

function snapshot(): MotionPolicy {
  const next = readMotionPolicy();
  const key = `${next.reducedMotion}|${next.reducedTransparency}|${next.rich}`;
  if (!cached || key !== cachedKey) {
    cached = next;
    cachedKey = key;
  }
  return cached;
}

const SERVER_POLICY: MotionPolicy = { reducedMotion: false, reducedTransparency: false, rich: false };

/** Calls `onChange` when Reduce Motion or Reduce Transparency changes. */
export function onMotionPolicyChange(onChange: () => void) {
  const lists = [media(REDUCED_MOTION), media(REDUCED_TRANSPARENCY)].filter(
    (list): list is MediaQueryList => list !== null,
  );
  lists.forEach((list) => list.addEventListener('change', onChange));
  return () => lists.forEach((list) => list.removeEventListener('change', onChange));
}

export function useMotionPolicy(): MotionPolicy {
  return useSyncExternalStore(onMotionPolicyChange, snapshot, () => SERVER_POLICY);
}

// ═══════════════════════════════════
// ONCE-PER-SESSION REVEALS
// ═══════════════════════════════════

// Data draw-ins (rails filling, charts drawing) play the first time a metric
// is shown in this app session, not on every tab visit. Memory lives with the
// JS session, so a relaunch plays them again.
const revealed = new Set<string>();

export function hasRevealed(key: string): boolean {
  return revealed.has(key);
}

export function markRevealed(key: string) {
  revealed.add(key);
}

/**
 * True when this mount is the first showing of `key` in the session. The
 * check is pure during render (StrictMode-safe); the key is claimed after
 * commit, so a remount on the next tab visit renders settled.
 */
export function useFirstReveal(key: string | undefined): boolean {
  // Reduced motion shows data in its final state.
  const [first] = useState(() => key !== undefined && !revealed.has(key) && !readMotionPolicy().reducedMotion);
  useEffect(() => {
    if (key) revealed.add(key);
  }, [key]);
  return first;
}

/** Test seam. */
export function resetReveals() {
  revealed.clear();
}
