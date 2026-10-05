import { describe, expect, it } from 'vitest';
import {
  createTracker, defaultTrackerConfig, legacyNativeControlCursor, pauseTracker,
  restoreTracker, resumeTracker, serializeTracker,
} from '@/lib/runTracker';

const T0 = Date.parse('2026-10-01T12:00:00Z');
const rest = (sequence: number, seconds: number) => ({ sequence, timestampMs: T0 + seconds * 1000, action: 'rest' });

function legacySnapshot(state: ReturnType<typeof createTracker>, savedAt = T0 + 30_000) {
  const raw = JSON.parse(serializeTracker(state, savedAt));
  delete raw.state.nativeSampleSeq;
  delete raw.state.nativeControlSeq;
  return restoreTracker(JSON.stringify(raw), savedAt + 1)!;
}

describe('legacy native control migration', () => {
  it('recognizes an accounted Rest/Resume pair without counting its pause twice', () => {
    const initial = createTracker(defaultTrackerConfig('free', null), T0, 'legacy');
    const prior = resumeTracker(pauseTracker(initial, T0 + 12_500), T0 + 14_500);
    const restored = legacySnapshot(prior);
    const controls = [rest(1, 12.5), rest(2, 14.5), rest(3, 35)];
    const cursor = legacyNativeControlCursor(restored.legacyNativeControls!, controls);
    expect(cursor).toBe(2);
    expect(legacyNativeControlCursor(restored.legacyNativeControls!, [...controls, ...controls])).toBe(2);
    expect(restored.totalPausedMs).toBe(2000);
    // A later lock-screen Rest remains available to recovery.
    expect(controls.filter((control) => control.sequence > cursor)).toEqual([rest(3, 35)]);
  });

  it('uses the recorded interval boundary, preserving controls after the snapshot', () => {
    const initial = createTracker(defaultTrackerConfig('intervals', null), T0, 'legacy');
    initial.lastManualSplitMs = T0 + 10_000;
    const restored = legacySnapshot(initial);
    expect(legacyNativeControlCursor(restored.legacyNativeControls!, [rest(1, 10), rest(2, 35)])).toBe(1);
  });

  it('does not suppress a delayed control merely because it predates a wall-clock flush', () => {
    const initial = createTracker(defaultTrackerConfig('free', null), T0, 'legacy');
    const restored = legacySnapshot(initial);
    expect(legacyNativeControlCursor(restored.legacyNativeControls!, [rest(1, 20)])).toBe(0);
    expect(legacyNativeControlCursor(restored.legacyNativeControls!, [
      { sequence: 1, timestampMs: T0 + 20_000, action: 'finish' },
    ])).toBe(0);
  });

  it('recognizes an exact open pause before restore closes its duration', () => {
    const initial = createTracker(defaultTrackerConfig('free', null), T0, 'legacy');
    const restored = legacySnapshot(pauseTracker(initial, T0 + 10_000));
    expect(legacyNativeControlCursor(restored.legacyNativeControls!, [rest(1, 10), rest(2, 35)])).toBe(1);
  });

  it('never assumes a newer snapshot without applied controls is a legacy snapshot', () => {
    const initial = createTracker(defaultTrackerConfig('free', null), T0, 'current');
    const restored = restoreTracker(serializeTracker(initial, T0), T0 + 1)!;
    expect(restored.legacyNativeControls).toBeUndefined();
  });

  it('preserves native pause state so a recovered Resume closes the actual pause', () => {
    const initial = createTracker(defaultTrackerConfig('free', null), T0, 'native');
    const paused = pauseTracker(initial, T0 + 10_000);
    const restored = restoreTracker(serializeTracker(paused, T0 + 20_000), T0 + 40_000, { preservePause: true })!;
    expect(restored.pausedAtMs).toBe(T0 + 10_000);
    const resumed = resumeTracker(restored, T0 + 35_000);
    expect(resumed.pausedAtMs).toBeNull();
    expect(resumed.totalPausedMs).toBe(25_000);
  });
});
