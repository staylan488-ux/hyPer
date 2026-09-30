import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOTION_LIGHT_LINGER_MS, pushMotionLight, resetMotionLight } from '../src/lib/motionLight';
import { registerLitSurface, resetLitSurfaces } from '../src/lib/litSurfaces';
import { resetWebGLProbe } from '../src/lib/motionPolicy';
import { stubMotionBrowser } from './motionLightBrowser';

vi.mock('../src/lib/nativeGlassSurfaces', () => ({ startNativeMotion: async () => null }));

/** Just enough of an element for inline custom properties. */
function surface() {
  const values = new Map<string, string>();
  const style = {
    setProperty: vi.fn((name: string, value: string) => values.set(name, value)),
    removeProperty: vi.fn((name: string) => values.delete(name)),
  };
  return { element: { style } as unknown as HTMLElement, values, style };
}

describe('lit surfaces', () => {
  afterEach(() => {
    resetLitSurfaces();
    resetMotionLight();
    resetWebGLProbe();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('lights a surface as soon as it is registered, and only registered ones', () => {
    vi.useFakeTimers();
    const { flushFrames } = stubMotionBrowser();
    const lit = surface();
    const other = surface(); // an unregistered .material-glass

    const release = registerLitSurface(lit.element);
    expect(Object.fromEntries(lit.values)).toEqual({ '--light-x': '0.000', '--light-y': '0.000', '--light-on': '1' });

    pushMotionLight({ x: 0.5, y: -0.25 });
    flushFrames();
    expect(lit.values.get('--light-x')).toBe('0.500');
    expect(lit.values.get('--light-y')).toBe('-0.250');
    expect(other.style.setProperty).not.toHaveBeenCalled();
    // --light-on is set once, not every frame.
    expect(lit.style.setProperty.mock.calls.filter(([name]) => name === '--light-on')).toHaveLength(1);
    release();
  });

  it('gives a surface that opens later the current light straight away', () => {
    vi.useFakeTimers();
    const { flushFrames } = stubMotionBrowser();
    const first = surface();
    const releaseFirst = registerLitSurface(first.element);
    pushMotionLight({ x: 0.3, y: 0.6 });
    flushFrames();

    const sheet = surface();
    const releaseSheet = registerLitSurface(sheet.element);
    expect(sheet.values.get('--light-x')).toBe('0.300');
    expect(sheet.values.get('--light-y')).toBe('0.600');
    expect(sheet.values.get('--light-on')).toBe('1');
    releaseSheet();
    releaseFirst();
  });

  it('runs the sources only while something is lit, with a short linger', () => {
    vi.useFakeTimers();
    const { scrollListeners } = stubMotionBrowser();
    expect(scrollListeners.size).toBe(0);

    const menu = registerLitSurface(surface().element);
    const sheet = registerLitSurface(surface().element);
    expect(scrollListeners.size).toBe(1);
    menu();
    menu(); // releasing twice is harmless
    vi.advanceTimersByTime(MOTION_LIGHT_LINGER_MS * 2);
    expect(scrollListeners.size).toBe(1);

    sheet();
    expect(scrollListeners.size).toBe(1);
    // A quick reopen inside the linger keeps the same stream.
    const reopened = registerLitSurface(surface().element);
    vi.advanceTimersByTime(MOTION_LIGHT_LINGER_MS * 2);
    expect(scrollListeners.size).toBe(1);

    reopened();
    vi.advanceTimersByTime(MOTION_LIGHT_LINGER_MS);
    expect(scrollListeners.size).toBe(0);
  });

  it('leaves surfaces unlit under Reduce Motion', () => {
    const { settings, scrollListeners } = stubMotionBrowser();
    settings.reducedMotion = true;
    const lit = surface();
    const release = registerLitSurface(lit.element);
    expect(lit.values.has('--light-on')).toBe(false);
    expect(lit.style.setProperty).not.toHaveBeenCalled();
    expect(scrollListeners.size).toBe(0);
    release();
  });

  it('follows Reduce Motion changes while a surface stays open', () => {
    const { setReducedMotion, scrollListeners } = stubMotionBrowser();
    const lit = surface();
    const release = registerLitSurface(lit.element);
    expect(lit.values.get('--light-on')).toBe('1');

    setReducedMotion(true);
    expect(lit.values.has('--light-on')).toBe(false);
    expect(scrollListeners.size).toBe(0);

    setReducedMotion(false);
    expect(lit.values.get('--light-on')).toBe('1');
    expect(scrollListeners.size).toBe(1);
    release();
  });
});
