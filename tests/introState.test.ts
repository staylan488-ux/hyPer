import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('brand intro session eligibility', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('does not consume eligibility during repeated render reads', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    const state = await import('@/components/intro/introState');
    expect(state.shouldPlayIntro('dashboard')).toBe(true);
    expect(state.shouldPlayIntro('dashboard')).toBe(true);
    expect(values.size).toBe(0);
    state.markIntroPlayed('dashboard');
    expect(state.shouldPlayIntro('dashboard')).toBe(false);
    expect(state.shouldPlayIntro('login')).toBe(true);

    // Reloading the module simulates a page reload within the same browser tab.
    vi.resetModules();
    const reloaded = await import('@/components/intro/introState');
    expect(reloaded.shouldPlayIntro('dashboard')).toBe(false);
  });

  it('uses its memory guard when accessing session storage throws', async () => {
    vi.stubGlobal('window', Object.defineProperty({}, 'sessionStorage', {
      get() { throw new Error('Storage access denied'); },
    }));
    const state = await import('@/components/intro/introState');
    expect(state.shouldPlayIntro('login')).toBe(true);
    expect(() => state.markIntroPlayed('login')).not.toThrow();
    expect(state.shouldPlayIntro('login')).toBe(false);
    expect(state.shouldPlayIntro('dashboard')).toBe(true);
  });

  it('does not require a browser during server-side reads', async () => {
    vi.stubGlobal('window', undefined);
    const state = await import('@/components/intro/introState');
    expect(state.shouldPlayIntro('dashboard')).toBe(false);
  });
});
