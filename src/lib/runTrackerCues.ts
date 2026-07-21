// Audio + haptic cues for the run tracker, in the playRestTimerSound style.
// Distinct pitch contours so laps and sprint boundaries are tellable apart
// with the phone stowed: lap = double blip, sprint start = rising, sprint
// end = falling. Haptics route through the shared module so the Capacitor
// engine fires on native iOS (navigator.vibrate is a no-op there); audio
// through the speaker/earbuds is the primary channel.

import { completionHaptic } from '@/lib/haptics';

type ToneStep = { frequency: number; atS: number; durationS: number };

function playTones(steps: ToneStep[]): void {
  if (typeof window === 'undefined') return;

  const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextCtor = window.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioContextCtor) return;

  try {
    const context = new AudioContextCtor();
    const totalS = Math.max(...steps.map((s) => s.atS + s.durationS));

    for (const step of steps) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + step.atS;

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(step.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + step.durationS);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + step.durationS);
    }

    window.setTimeout(() => {
      void context.close().catch(() => {});
    }, (totalS + 0.3) * 1000);
  } catch {
    // audio unavailable — cues are best-effort
  }
}

export function playLapCue(): void {
  playTones([
    { frequency: 880, atS: 0, durationS: 0.18 },
    { frequency: 880, atS: 0.24, durationS: 0.18 },
  ]);
  completionHaptic();
}

export function playSprintStartCue(): void {
  playTones([
    { frequency: 660, atS: 0, durationS: 0.14 },
    { frequency: 990, atS: 0.16, durationS: 0.22 },
  ]);
  completionHaptic();
}

export function playSprintEndCue(): void {
  playTones([
    { frequency: 990, atS: 0, durationS: 0.14 },
    { frequency: 660, atS: 0.16, durationS: 0.22 },
  ]);
  completionHaptic();
}
