// Replaces ../src/lib/haptics.ts (see metro.config.js): the shared calls,
// played on iOS's haptic engine through this app's haptics.
import { haptics } from '~/lib/haptics';

/** A light tick for meaningful touches. */
export function tapHaptic(): void {
  haptics.tap();
}

/** "Something finished": rest over, workout complete. */
export function completionHaptic(): void {
  haptics.success();
}

/** Start of a scrub. expo-haptics prepares its generator on every call. */
export function selectionHapticStart(): void {}

/** One detent while scrubbing a chart or picker. */
export function selectionHaptic(): void {
  haptics.select();
}

/** End of a scrub. */
export function selectionHapticEnd(): void {}

/** A set that beat last time, a target met. */
export function celebrationHaptic(): void {
  haptics.success();
}
