// Replaces ../src/lib/runTrackerCues.ts (see metro.config.js): the same lap
// and sprint tones, played natively (modules/hyper-run) so they mix over music
// and sound with the screen locked, plus the shared completion haptic.
import { completionHaptic } from '@/lib/haptics';

import { HyperRun, type RunCue } from '../../modules/hyper-run';

function cue(kind: RunCue): void {
  void HyperRun.playCue(kind).catch(() => {});
  completionHaptic();
}

export function playLapCue(): void {
  cue('lap');
}

export function playSprintStartCue(): void {
  cue('sprintStart');
}

export function playSprintEndCue(): void {
  cue('sprintEnd');
}
