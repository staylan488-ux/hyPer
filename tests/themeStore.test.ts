import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

let dark: boolean;
let saved: string | null;
let listeners: Set<() => void>;
let cleanup: (() => void) | undefined;
let classes: Set<string>;

beforeEach(() => {
  vi.resetModules();
  dark = false;
  saved = null;
  listeners = new Set();
  classes = new Set();
  const media = {
    get matches() { return dark; },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal('window', {
    localStorage: {
      getItem: () => saved,
      setItem: (_: string, value: string) => { saved = value; },
    },
    matchMedia: (query: string) => query.includes('color-scheme') ? media : { matches: true },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    documentElement: {
      classList: {
        add: (value: string) => classes.add(value),
        remove: (...values: string[]) => values.forEach(value => classes.delete(value)),
      },
      style: {},
    },
    querySelector: () => ({ setAttribute: vi.fn() }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

async function start() {
  const { useThemeStore } = await import('../src/stores/themeStore');
  cleanup = useThemeStore.getState().initializeTheme();
  return useThemeStore;
}

describe('system appearance', () => {
  it.each([false, true])('defaults to the phone appearance (dark=%s)', async (isDark) => {
    dark = isDark;
    const store = await start();
    expect(store.getState().preference).toBe('system');
    expect(store.getState().theme).toBe(isDark ? 'dark' : 'light');
    expect(classes.has(store.getState().theme)).toBe(true);
  });

  it.each(['light', 'dark'] as const)('preserves an existing %s choice despite system changes', async choice => {
    saved = choice;
    const store = await start();
    dark = !dark;
    listeners.forEach(cb => cb());
    expect(store.getState().preference).toBe(choice);
    expect(store.getState().theme).toBe(choice);
  });

  it('follows live changes, persists system, and lets a fixed choice opt out', async () => {
    saved = 'light';
    const store = await start();
    store.getState().setTheme('system');
    expect(saved).toBe('system');
    dark = true;
    listeners.forEach(cb => cb());
    expect(store.getState().theme).toBe('dark');
    expect(classes.has('dark')).toBe(true);
    store.getState().setTheme('light');
    listeners.forEach(cb => cb());
    expect(store.getState().theme).toBe('light');
    expect(saved).toBe('light');
    cleanup?.();
    expect(listeners.size).toBe(0);
  });

  it('restores system preference after relaunch', async () => {
    saved = 'system';
    dark = true;
    expect((await start()).getState().theme).toBe('dark');
  });

  it.each([null, 'system', 'dark', 'light'])('uses the same theme before React starts for %s', async choice => {
    saved = choice;
    dark = true;
    const html = readFileSync('index.html', 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    runInNewContext(script, { window, document, localStorage: window.localStorage });
    const before = [...classes];
    const store = await start();
    expect(before).toEqual([store.getState().theme]);
  });
});
