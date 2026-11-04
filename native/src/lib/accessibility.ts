// What iOS's accessibility settings ask of the app, followed while it runs:
// Reduce Motion, Increase Contrast, VoiceOver and the text size, and how the
// app speaks to VoiceOver (announcements; the words are in ./spoken).
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AccessibilityInfo, useWindowDimensions } from 'react-native';
import { makeMutable } from 'react-native-reanimated';

import { speak } from './spoken';

export { fieldLabel, speak, spokenClock, spokenLabel, spokenUnit } from './spoken';

type Settings = {
  /** Reduce Motion: nothing slides, rolls or springs; fades stay. */
  reduceMotion: boolean;
  /** Reduce Motion was turned on or off since launch (Reanimated read it once, at launch). */
  reduceMotionChanged: boolean;
  /** Increase Contrast ("darker system colors"): Blanc's contrast palettes. */
  increaseContrast: boolean;
  /** VoiceOver is running. */
  screenReader: boolean;
};

let settings: Settings = { reduceMotion: false, reduceMotionChanged: false, increaseContrast: false, screenReader: false };
const listeners = new Set<() => void>();

/** Reduce Motion for worklets: layout animations decide on the UI thread. */
export const reduceMotionValue = makeMutable(false);

function update(patch: Partial<Settings>) {
  const next = { ...settings, ...patch };
  if (
    next.reduceMotion === settings.reduceMotion &&
    next.reduceMotionChanged === settings.reduceMotionChanged &&
    next.increaseContrast === settings.increaseContrast &&
    next.screenReader === settings.screenReader
  ) {
    return;
  }
  settings = next;
  reduceMotionValue.value = next.reduceMotion;
  listeners.forEach((listener) => listener());
}

// Read once at launch, then follow every change. The reads answer before the
// first screen draws in practice (the launch screen is still up).
void AccessibilityInfo.isReduceMotionEnabled().then((on) => update({ reduceMotion: on })).catch(() => {});
void AccessibilityInfo.isDarkerSystemColorsEnabled().then((on) => update({ increaseContrast: on })).catch(() => {});
void AccessibilityInfo.isScreenReaderEnabled().then((on) => update({ screenReader: on })).catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => update({ reduceMotion: on, reduceMotionChanged: true }));
AccessibilityInfo.addEventListener('darkerSystemColorsChanged', (on) => update({ increaseContrast: on }));
AccessibilityInfo.addEventListener('screenReaderChanged', (on) => update({ screenReader: on }));

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSyncExternalStore(subscribe, () => settings[key]);
}

/** Reduce Motion is on: skip movement (slides, rolls, springs); a fade may stay. */
export const useReduceMotion = () => useSetting('reduceMotion');

/** Reduce Motion as it is now, once it differs from what Reanimated read at launch (null until then). */
export function useReduceMotionOverride(): boolean | null {
  const changed = useSetting('reduceMotionChanged');
  const on = useSetting('reduceMotion');
  return changed ? on : null;
}

/** Increase Contrast is on: Blanc draws with its contrast palettes. */
export const useIncreaseContrast = () => useSetting('increaseContrast');

/** VoiceOver is running. */
export const useScreenReader = () => useSetting('screenReader');

/** VoiceOver is running, for code outside React (a timer's length, say). */
export const screenReaderRunning = () => settings.screenReader;

/**
 * React Native's text multiplier at iOS's first accessibility size (AX1 is
 * 1.786; the largest standard size, xxxLarge, is 1.353).
 */
export const LARGE_TEXT_SCALE = 1.5;

/**
 * The text size is one of iOS's accessibility sizes (Larger Accessibility
 * Sizes, AX1 to AX5). Layouts then stack what sat side by side and let text
 * wrap instead of cutting it short, as iOS's own lists do. Below these sizes
 * nothing changes.
 */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;
}

/**
 * Speaks a message over whatever VoiceOver is reading, after it: a save that
 * failed, a set logged, a rest that ended. Nothing happens without VoiceOver.
 */
export function announce(message: string | null | undefined) {
  if (!message) return;
  AccessibilityInfo.announceForAccessibilityWithOptions(speak(message), { queue: true });
}

/**
 * Announces a status line when it appears or changes, as React Native's
 * `accessibilityLiveRegion` does on Android only. Nothing when it clears.
 */
export function useAnnounce(message: string | null | undefined | false) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    const now = message || null;
    if (now && now !== last.current) announce(now);
    last.current = now;
  }, [message]);
}
