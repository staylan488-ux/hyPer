import { describe, expect, it } from 'vitest';

import {
  createRestTimerSession,
  getRestTimerRemainingSeconds,
  pauseRestTimerSession,
  type RestTimerSession,
} from '@/lib/restTimer';

import { applyRestControls, type RestControl } from '../native/src/lib/restControls';

// The workout card's +30 s and End rest change the card and the "Rest over"
// notification while the app sleeps; the app then applies the logged taps to
// its stored rest, each at the moment it was made.

const start = new Date('2026-10-30T10:00:00.000Z');
const at = (seconds: number) => start.getTime() + seconds * 1000;
const tap = (sequence: number, action: RestControl['action'], seconds: number): RestControl => ({
  sequence,
  action,
  timestampMs: at(seconds),
});
const rest = (seconds = 90): RestTimerSession =>
  createRestTimerSession('workout-1', seconds, start, { exerciseId: 'bench', nextUpLabel: 'Bench press · set 3' });

describe('applyRestControls', () => {
  it('moves a running rest 30 seconds later and grows its length', () => {
    const next = applyRestControls(rest(), [tap(1, 'extend', 20)]);

    expect(next?.status).toBe('running');
    expect(next?.endsAt).toBe(new Date(at(120)).toISOString());
    expect(next?.durationSeconds).toBe(120);
    expect(next?.nextUpLabel).toBe('Bench press · set 3');
  });

  it('adds a minute for two quick taps, in order', () => {
    const next = applyRestControls(rest(), [tap(2, 'extend', 21), tap(1, 'extend', 20)]);

    expect(next?.endsAt).toBe(new Date(at(150)).toISOString());
  });

  it('keeps a rest going past its first end when +30 s came before it', () => {
    // Tapped 80 s in, applied when the app wakes 100 s in.
    const next = applyRestControls(rest(), [tap(1, 'extend', 80)]);

    expect(next && getRestTimerRemainingSeconds(next, new Date(at(100)))).toBe(20);
  });

  it('adds to a paused rest', () => {
    const paused = pauseRestTimerSession(rest(), new Date(at(30)));
    const next = applyRestControls(paused, [tap(1, 'extend', 40)]);

    expect(next?.status).toBe('paused');
    expect(next?.remainingSeconds).toBe(90);
  });

  it('ends a running or paused rest', () => {
    expect(applyRestControls(rest(), [tap(1, 'end', 10)])).toBeNull();
    expect(applyRestControls(pauseRestTimerSession(rest(), new Date(at(30))), [tap(1, 'end', 40)])).toBeNull();
  });

  it('ignores taps after End rest', () => {
    expect(applyRestControls(rest(), [tap(1, 'end', 10), tap(2, 'extend', 11)])).toBeNull();
  });

  it('leaves alone a rest that was over when tapped', () => {
    const session = rest();

    expect(applyRestControls(session, [tap(1, 'extend', 95)])).toBe(session);
    expect(applyRestControls(session, [tap(1, 'end', 95)])).toBe(session);
  });

  it('leaves alone a rest that began after the tap', () => {
    const session = rest();

    expect(applyRestControls(session, [tap(1, 'end', -5)])).toBe(session);
  });

  it('does nothing without a rest or taps', () => {
    const session = rest();

    expect(applyRestControls(null, [tap(1, 'extend', 10)])).toBeNull();
    expect(applyRestControls(session, [])).toBe(session);
  });
});
