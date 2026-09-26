import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasRevealed, markRevealed, readMotionPolicy, resetReveals, resetWebGLProbe } from '../src/lib/motionPolicy';

function stubMedia(matches: Record<string, boolean>) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: Object.entries(matches).some(([needle, value]) => value && query.includes(needle)),
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebGLProbe();
  resetReveals();
});

describe('motion policy', () => {
  it('allows rich motion when nothing is reduced and WebGL exists', () => {
    stubMedia({});
    resetWebGLProbe(true);
    expect(readMotionPolicy()).toEqual({ reducedMotion: false, reducedTransparency: false, rich: true });
  });

  it('turns rich scenes off under reduced motion', () => {
    stubMedia({ 'prefers-reduced-motion': true });
    resetWebGLProbe(true);
    expect(readMotionPolicy()).toMatchObject({ reducedMotion: true, rich: false });
  });

  it('treats increased contrast like reduced transparency', () => {
    stubMedia({ 'prefers-contrast': true });
    resetWebGLProbe(true);
    expect(readMotionPolicy().reducedTransparency).toBe(true);
  });

  it('falls back to 2D without WebGL', () => {
    stubMedia({});
    resetWebGLProbe(false);
    expect(readMotionPolicy().rich).toBe(false);
  });

  it('is inert outside a browser', () => {
    resetWebGLProbe(false);
    expect(readMotionPolicy()).toEqual({ reducedMotion: false, reducedTransparency: false, rich: false });
  });
});

describe('session reveals', () => {
  it('remembers a metric once revealed', () => {
    expect(hasRevealed('fuel-energy')).toBe(false);
    markRevealed('fuel-energy');
    expect(hasRevealed('fuel-energy')).toBe(true);
    expect(hasRevealed('fuel-macro-Protein')).toBe(false);
  });
});
