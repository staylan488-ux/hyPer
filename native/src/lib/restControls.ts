// Taps on the workout card's +30 s and End rest (lock screen and Dynamic
// Island), applied to the stored rest. The tap itself already changed the card
// and the "Rest over" notification (RestControlIntent.swift), by the same rule,
// so they keep up while the app sleeps; the app applies the logged taps when it
// next runs, at the moment each was made. Pure, so tests can check it.
import { extendRestTimerSession, syncRestTimerSession, type RestTimerSession } from '@/lib/restTimer';

/** A logged tap on the card's +30 s ("extend") or End rest ("end"), as
 *  modules/hyper-activity reads it from RestControlLog. */
export type RestControl = {
  sequence: number;
  action: 'extend' | 'end';
  timestampMs: number;
};

/** What +30 s adds, as the rest sheet's button does (RestControlAction.extendSeconds). */
export const REST_CONTROL_EXTEND_SECONDS = 30;

/**
 * The rest after the taps, in order. +30 s moves a running rest's end, or adds
 * to a paused one; End rest clears it. A tap leaves alone a rest that was over
 * by then, and one made before this rest began, which was meant for another.
 */
export function applyRestControls(
  session: RestTimerSession | null,
  controls: readonly RestControl[],
): RestTimerSession | null {
  let current = session;
  for (const control of [...controls].sort((a, b) => a.sequence - b.sequence)) {
    if (!current || current.status === 'completed') break;
    const at = new Date(control.timestampMs);
    if (!Number.isFinite(at.getTime()) || at.getTime() < Date.parse(current.startedAt)) continue;
    if (syncRestTimerSession(current, at).status === 'completed') continue;
    if (control.action === 'end') current = null;
    else if (control.action === 'extend') current = extendRestTimerSession(current, REST_CONTROL_EXTEND_SECONDS, at);
  }
  return current;
}
