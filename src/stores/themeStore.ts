import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'hyper-theme';
const TRANSITION_CLASS = 'theme-transition-active';

const THEME_COLOR_BY_MODE: Record<ThemeMode, string> = {
  dark: '#1A1A1A',
  light: '#F7F6F3',
};

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function prefersReducedMotion() {
  if (!isBrowser()) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function resolveInitialTheme(): ThemeMode {
  if (!isBrowser()) return 'dark';

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeClass(theme: ThemeMode) {
  if (!isBrowser()) return;

  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  root.classList.add(theme);
  root.style.colorScheme = theme;

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  themeMeta?.setAttribute('content', THEME_COLOR_BY_MODE[theme]);
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
  initialized: boolean;
  initializeTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: resolveInitialTheme(),
  initialized: false,
  initializeTheme: () => {
    const theme = get().theme;
    applyThemeClass(theme);
    set({ initialized: true });
  },
  setTheme: (theme) => {
    if (!isBrowser()) {
      set({ theme });
      return;
    }

    applyTransitionFlourish();
    applyThemeClass(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
    set({ theme, initialized: true });
  },
  toggleTheme: () => {
    const nextTheme: ThemeMode = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(nextTheme);
  },
}));
