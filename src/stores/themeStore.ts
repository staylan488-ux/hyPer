import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export type ThemeMode = 'dark' | 'light';
export type ThemePreference = ThemeMode | 'system';

const STORAGE_KEY = 'hyper-theme';
const TRANSITION_CLASS = 'theme-transition-active';

const THEME_COLOR_BY_MODE: Record<ThemeMode, string> = {
  dark: '#000000',
  light: '#F5F5F0',
};

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function prefersReducedMotion() {
  if (!isBrowser()) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function resolveInitialPreference(): ThemePreference {
  if (!isBrowser()) return 'system';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch { /* Keep appearance usable when storage is unavailable. */ }
  return 'system';
}

function resolveTheme(preference: ThemePreference): ThemeMode {
  if (preference !== 'system') return preference;
  return isBrowser() && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark' : 'light';
}

function applyThemeClass(theme: ThemeMode) {
  if (!isBrowser()) return;

  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(theme);
  root.style.colorScheme = theme;

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  themeMeta?.setAttribute('content', THEME_COLOR_BY_MODE[theme]);

  // Native: clock/battery glyphs follow the surface — ink text on Paper,
  // paper text on Ink. (Capacitor's Style.Dark = light glyphs.)
  if (Capacitor.isNativePlatform()) {
    void StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
  }
}

function applyTransitionFlourish() {
  if (!isBrowser() || prefersReducedMotion()) return;

  const root = document.documentElement;
  root.classList.add(TRANSITION_CLASS);

  window.setTimeout(() => {
    root.classList.remove(TRANSITION_CLASS);
  }, 560);
}

interface ThemeState {
  theme: ThemeMode;
  preference: ThemePreference;
  initialized: boolean;
  initializeTheme: () => (() => void) | undefined;
  setTheme: (preference: ThemePreference) => void;
  toggleTheme: () => void;
}

const initialPreference = resolveInitialPreference();

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: initialPreference,
  theme: resolveTheme(initialPreference),
  initialized: false,
  initializeTheme: () => {
    const theme = resolveTheme(get().preference);
    applyThemeClass(theme);
    set({ theme, initialized: true });
    if (!isBrowser()) return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => {
      if (get().preference !== 'system') return;
      const nextTheme = resolveTheme('system');
      if (nextTheme === get().theme) return;
      applyThemeClass(nextTheme);
      set({ theme: nextTheme });
    };
    media.addEventListener('change', syncSystemTheme);
    // Recheck when returning from the phone's Settings app.
    document.addEventListener('visibilitychange', syncSystemTheme);
    window.addEventListener('pageshow', syncSystemTheme);
    return () => {
      media.removeEventListener('change', syncSystemTheme);
      document.removeEventListener('visibilitychange', syncSystemTheme);
      window.removeEventListener('pageshow', syncSystemTheme);
    };
  },
  setTheme: (preference) => {
    const theme = resolveTheme(preference);
    if (isBrowser()) {
      if (theme !== get().theme) applyTransitionFlourish();
      applyThemeClass(theme);
      try {
        window.localStorage.setItem(STORAGE_KEY, preference);
      } catch { /* The choice still applies for this session. */ }
    }
    set({ preference, theme, initialized: true });
  },
  toggleTheme: () => {
    const nextTheme: ThemeMode = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(nextTheme);
  },
}));
