// The shared haptic calls. The app plays them through
// native/src/platform/haptics.ts, which native/metro.config.js swaps in for
// this file (it must stay so the swap can resolve). Outside the app there is
// no haptic engine, so these do nothing.

/** A light tick for meaningful touches. */
export function tapHaptic(): void {}

/** A firmer "something finished": rest over, a run split or finish. */
export function completionHaptic(): void {}

/** Begin a scrub gesture. */
export function selectionHapticStart(): void {}

/** One detent: the scrubbed datum changed. */
export function selectionHaptic(): void {}

/** End the scrub gesture. */
export function selectionHapticEnd(): void {}

/** A celebratory success: a set that beat last workout, a target met. */
export function celebrationHaptic(): void {}
