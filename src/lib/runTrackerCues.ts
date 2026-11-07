// The run tracker's lap and sprint cues. The app plays them through
// native/src/platform/runTrackerCues.ts (tones from modules/hyper-run plus a
// haptic), which native/metro.config.js swaps in for this file (it must stay so
// the swap can resolve). Outside the app these are silent.

/** End of a lap or interval. */
export function playLapCue(): void {}

/** A sprint starts. */
export function playSprintStartCue(): void {}

/** A sprint ends. */
export function playSprintEndCue(): void {}
