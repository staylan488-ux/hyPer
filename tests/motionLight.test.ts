import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOTION_LIGHT_LINGER_MS,
  lightFromOrientation,
  lightFromScroll,
  pushMotionLight,
  resetMotionLight,
  subscribeMotionLight,
} from '../src/lib/motionLight';
import { resetWebGLProbe } from '../src/lib/motionPolicy';
import { stubMotionBrowser } from './motionLightBrowser';

vi.mock('../src/lib/nativeGlassSurfaces', () => ({ startNativeMotion: async () => null }));

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
      vi.useRealTimers();
    });

    it('registers nothing while Reduce Motion is on', () => {
      const { settings, scrollListeners } = stubMotionBrowser();
      settings.reducedMotion = true;
      const received: unknown[] = [];
      const stop = subscribeMotionLight((light) => received.push(light));
      expect(received).toEqual([]);
      expect(scrollListeners.size).toBe(0);
      stop();
    });

    it('stops and restarts its sources as Reduce Motion is toggled mid-session', () => {
      vi.useFakeTimers();
      const { settings, scrollListeners } = stubMotionBrowser();
      const listener = vi.fn();

      // What a lit surface does: subscribe, and resubscribe on a policy change.
      let stop = subscribeMotionLight(listener);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(scrollListeners.size).toBe(1);

      // Turning Reduce Motion on stops the sources at once, without the linger.
      settings.reducedMotion = true;
      stop();
      expect(scrollListeners.size).toBe(0);
      stop = subscribeMotionLight(listener);
      expect(scrollListeners.size).toBe(0);
      expect(listener).toHaveBeenCalledTimes(1);

      settings.reducedMotion = false;
      stop();
      stop = subscribeMotionLight(listener);
      expect(scrollListeners.size).toBe(1);
      expect(listener).toHaveBeenCalledTimes(2);
      stop();
      vi.advanceTimersByTime(MOTION_LIGHT_LINGER_MS);
      expect(scrollListeners.size).toBe(0);
    });

    it('starts its sources with the first subscriber', () => {
      vi.useFakeTimers();
      const { scrollListeners } = stubMotionBrowser();
      expect(scrollListeners.size).toBe(0);
      const first = subscribeMotionLight(() => {});
      const second = subscribeMotionLight(() => {});
      expect(scrollListeners.size).toBe(1);
      first();
      vi.advanceTimersByTime(MOTION_LIGHT_LINGER_MS * 2);
      // Another subscriber is still listening.
      expect(scrollListeners.size).toBe(1);
      second();
    });

    it('keeps its sources through a quick unsubscribe and resubscribe', () => {
      vi.useFakeTimers();
      const { scrollListeners, flushFrames } = stubMotionBrowser();
      const listener = vi.fn();
      const stop = subscribeMotionLight(listener);
      const startedWith = [...scrollListeners][0];
      stop();
      vi.advanceTimersByTime(MOTION_LIGHT_LINGER_MS - 100);
      expect(scrollListeners.size).toBe(1);

      // A sheet opening right after a menu closes reuses the same stream.
      const again = subscribeMotionLight(listener);
      vi.advanceTimersByTime(MOTION_LIGHT_LINGER_MS * 2);
      expect(scrollListeners.size).toBe(1);
      expect([...scrollListeners][0]).toBe(startedWith);

      // Samples still move the light while it lingers or is reused.
      pushMotionLight({ x: 0.5, y: -0.5 });
      flushFrames();
      expect(listener).toHaveBeenLastCalledWith({ x: 0.5, y: -0.5 });
      again();
    });

    it('stops its sources after the linger once the last listener leaves', () => {
      vi.useFakeTimers();
      const { scrollListeners, pendingFrames, flushFrames } = stubMotionBrowser();
      const listener = vi.fn();
      const stop = subscribeMotionLight(listener);
      stop();
      stop(); // a second call is harmless
      expect(scrollListeners.size).toBe(1);

      // A sample during the linger still reaches the light, but no listener.
      pushMotionLight({ x: 0.4, y: 0.2 });
      expect(pendingFrames()).toBe(1);
      flushFrames();
      expect(listener).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(MOTION_LIGHT_LINGER_MS);
      expect(scrollListeners.size).toBe(0);

      // A late native sample after the stop does not wake the loop.
      pushMotionLight({ x: -0.6, y: 0.6 });
      expect(pendingFrames()).toBe(0);
    });

    it('eases each subscriber toward a new sample', () => {
      vi.useFakeTimers();
      const { flushFrames } = stubMotionBrowser();
      const received: { x: number; y: number }[] = [];
      const stop = subscribeMotionLight((light) => received.push(light));
      pushMotionLight({ x: 0.5, y: -0.25 });
      flushFrames();
      expect(received.length).toBeGreaterThan(2);
      expect(received.at(-1)).toEqual({ x: 0.5, y: -0.25 });
      stop();
    });
  });
});
