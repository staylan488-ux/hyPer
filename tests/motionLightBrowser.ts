import { vi } from 'vitest';
import { resetWebGLProbe } from '../src/lib/motionPolicy';

/**
 * Minimal browser globals for the motion light: media queries whose Reduce
 * Motion setting can be flipped (and announced), a countable scroll source,
 * and animation frames that run only when flushed.
 */
export function stubMotionBrowser() {
  const settings = { reducedMotion: false };
  const scrollListeners = new Set<unknown>();
  const policyListeners = new Set<() => void>();
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') && settings.reducedMotion,
      addEventListener: (_type: string, handler: () => void) => policyListeners.add(handler),
      removeEventListener: (_type: string, handler: () => void) => policyListeners.delete(handler),
    }),
  });
  vi.stubGlobal('document', {
    addEventListener: (_type: string, handler: unknown) => scrollListeners.add(handler),
    removeEventListener: (_type: string, handler: unknown) => scrollListeners.delete(handler),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  resetWebGLProbe(false);
  return {
    settings,
    scrollListeners,
    pendingFrames: () => frames.size,
    /** Run animation frames until the light settles. */
    flushFrames() {
      for (let i = 0; i < 500 && frames.size > 0; i += 1) {
        const due = frames;
        frames = new Map();
        due.forEach((callback) => callback(0));
      }
    },
    /** Flip Reduce Motion and notify listeners, as the OS setting does. */
    setReducedMotion(value: boolean) {
      settings.reducedMotion = value;
      policyListeners.forEach((listener) => listener());
    },
  };
}
