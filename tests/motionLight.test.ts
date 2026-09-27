import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lightFromOrientation,
  lightFromScroll,
  resetMotionLight,
  subscribeMotionLight,
} from '../src/lib/motionLight';
import { resetWebGLProbe } from '../src/lib/motionPolicy';

vi.mock('../src/lib/nativeGlassSurfaces', () => ({ startNativeMotion: async () => null }));

/** Minimal browser globals whose Reduce Motion setting can be flipped. */
function stubBrowser() {
  const settings = { reducedMotion: false };
  const scrollListeners = new Set<unknown>();
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') && settings.reducedMotion,
    }),
  });
  vi.stubGlobal('document', {
    addEventListener: (_type: string, handler: unknown) => scrollListeners.add(handler),
    removeEventListener: (_type: string, handler: unknown) => scrollListeners.delete(handler),
  });
  resetWebGLProbe(false);
  return { settings, scrollListeners };
}

describe('motion light', () => {
  it('centres on the resting grip and follows tilt', () => {
    expect(lightFromOrientation(50, 0, 50)).toEqual({ x: 0, y: 0 });
    const tiltedRight = lightFromOrientation(50, 14, 50);
    expect(tiltedRight.x).toBeCloseTo(0.5);
    const tippedBack = lightFromOrientation(36, 0, 50);
    expect(tippedBack.y).toBeCloseTo(0.5);
  });

  it('clamps extreme angles', () => {
    expect(lightFromOrientation(0, 90, 60)).toEqual({ x: 1, y: 1 });
    expect(lightFromOrientation(120, -90, 60)).toEqual({ x: -1, y: -1 });
  });

  it('drifts gently with scroll and stays in range', () => {
    expect(lightFromScroll(0)).toEqual({ x: 0, y: 0 });
    for (const top of [100, 800, 5000]) {
      const light = lightFromScroll(top);
      expect(Math.abs(light.x)).toBeLessThanOrEqual(0.35);
      expect(Math.abs(light.y)).toBeLessThanOrEqual(0.5);
    }
  });

  it('does nothing outside a browser', () => {
    const received: unknown[] = [];
    const stop = subscribeMotionLight((light) => received.push(light));
    stop();
    expect(received).toEqual([]);
  });

  describe('with browser globals', () => {
    afterEach(() => {
      resetMotionLight();
      resetWebGLProbe();
      vi.unstubAllGlobals();
    });

    it('registers nothing while Reduce Motion is on', () => {
      const { settings, scrollListeners } = stubBrowser();
      settings.reducedMotion = true;
      const received: unknown[] = [];
      const stop = subscribeMotionLight((light) => received.push(light));
      expect(received).toEqual([]);
      expect(scrollListeners.size).toBe(0);
      stop();
    });

    it('stops and restarts its sources as Reduce Motion is toggled mid-session', () => {
      const { settings, scrollListeners } = stubBrowser();
      const listener = vi.fn();

      // What useAmbientLight does: subscribe, and resubscribe on a policy change.
      let stop = subscribeMotionLight(listener);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(scrollListeners.size).toBe(1);

      settings.reducedMotion = true;
      stop();
      stop = subscribeMotionLight(listener);
      expect(scrollListeners.size).toBe(0);
      expect(listener).toHaveBeenCalledTimes(1);

      settings.reducedMotion = false;
      stop();
      stop = subscribeMotionLight(listener);
      expect(scrollListeners.size).toBe(1);
      expect(listener).toHaveBeenCalledTimes(2);
      stop();
      expect(scrollListeners.size).toBe(0);
    });
  });
});
