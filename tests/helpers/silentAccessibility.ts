// VoiceOver, the text size and the other accessibility settings are device
// services. A screen loaded in a test runs with them off (the standard text
// size, nothing announced) and speaks with the app's own words.
import { fieldLabel, speak, spokenClock, spokenLabel, spokenUnit } from '../../native/src/lib/spoken';

const noop = () => undefined;

export const silentAccessibility = {
  fieldLabel,
  speak,
  spokenClock,
  spokenLabel,
  spokenUnit,
  announce: noop,
  useAnnounce: noop,
  useLargeText: () => false,
  useScreenReader: () => false,
  useReduceMotion: () => false,
  useReduceMotionOverride: () => null,
  useIncreaseContrast: () => false,
  screenReaderRunning: () => false,
  reduceMotionValue: { value: false },
  LARGE_TEXT_SCALE: 1.5,
};
