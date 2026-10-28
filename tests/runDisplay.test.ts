import { describe, expect, it } from 'vitest';

import {
  autoLapDistanceM,
  autoLapPhrase,
  finishedRunPace,
  finishedRunSplits,
  formatRunDistance,
  formatRunPace,
  gpsDiagnosticsExport,
  isAutoLapValid,
  isRunResting,
  livePaceSecPerMile,
  runSaveErrorMessage,
  runStatus,
  splitFigure,
} from '@/lib/runDisplay';
import { createTracker, defaultTrackerConfig, pauseTracker, type FinishedRun } from '@/lib/runTracker';

// The run tracker's wording and choices, shared by the web page and the native run screen.

describe('run display', () => {
  it('formats pace, with slow live paces capped instead of hidden', () => {
    expect(formatRunPace(479)).toBe('7:59 /mi');
    expect(formatRunPace(3_601)).toBe('60:00+ /mi');
    expect(formatRunPace(null)).toBeNull();
    expect(formatRunPace(0)).toBeNull();
    expect(formatRunPace(Number.NaN)).toBeNull();
  });

  it('reads distances in metres under a mile and miles beyond', () => {
    expect(formatRunDistance(0)).toBe('0 m');
    expect(formatRunDistance(399.6)).toBe('400 m');
    expect(formatRunDistance(1609.344)).toBe('1.00 mi');
    expect(formatRunDistance(5_000)).toBe('3.11 mi');
  });

  it('splits a label into figure and unit', () => {
    expect(splitFigure('195 m')).toEqual(['195', 'm']);
    expect(splitFigure('7:59 /mi')).toEqual(['7:59', '/mi']);
    expect(splitFigure('0:58')).toEqual(['0:58', '']);
  });

  it('checks and phrases auto-split choices', () => {
    expect(isAutoLapValid('400', '')).toBe(true);
    expect(isAutoLapValid('custom', '9')).toBe(false);
    expect(isAutoLapValid('custom', '10')).toBe(true);
    expect(isAutoLapValid('custom', '100001')).toBe(false);
    expect(isAutoLapValid('custom', 'abc')).toBe(false);
    expect(autoLapDistanceM('off', '300')).toBeNull();
    expect(autoLapDistanceM('custom', '1250')).toBe(1250);
    expect(autoLapDistanceM('1600', '300')).toBe(1600);
    expect(autoLapPhrase('off', '300')).toBe('manual splits');
    expect(autoLapPhrase('custom', '1250')).toBe('every 1,250 m');
    expect(autoLapPhrase('400', '300')).toBe('every 400 m');
  });

  it('reads a long run paused as resting, with no live pace', () => {
    const start = Date.parse('2026-10-27T07:00:00Z');
    const running = createTracker(defaultTrackerConfig('free', null), start, 'run-1');
    expect(isRunResting(running)).toBe(false);
    expect(runStatus(running, start + 1_000)).toBe('acquiring');
    const paused = pauseTracker(running, start + 5_000);
    expect(isRunResting(paused)).toBe(true);
    expect(runStatus(paused, start + 6_000)).toBe('resting');
    expect(livePaceSecPerMile(paused, start + 6_000)).toBeNull();
  });

  it('lists a finished run’s splits with rests, and its pace', () => {
    const run: FinishedRun = {
      runId: 'run-1',
      mode: 'intervals',
      startedAtMs: Date.parse('2026-10-27T07:00:00.000Z'),
      endedAtMs: Date.parse('2026-10-27T07:05:00.000Z'),
      totalDistanceM: 800,
      elapsedS: 300,
      laps: [
        { index: 1, startedAtMs: 0, endedAtMs: 90_000, pausedMs: 0, distanceM: 400, trigger: 'auto', kind: 'work' },
        { index: 2, startedAtMs: 90_000, endedAtMs: 150_000, pausedMs: 0, distanceM: 20, trigger: 'manual', kind: 'rest' },
        { index: 3, startedAtMs: 150_000, endedAtMs: 240_000, pausedMs: 0, distanceM: 380, trigger: 'finish', kind: 'work' },
      ],
      reps: [],
      trace: [{ t: 1, lat: 1, lon: 2, accuracyM: 5, decision: 'accepted' } as never],
    };
    expect(finishedRunSplits(run)).toEqual([
      { key: 1, durationS: 90, distanceM: 400, isRest: false },
      { key: 2, durationS: 60, distanceM: 20, isRest: true },
      { key: 3, durationS: 90, distanceM: 380, isRest: false },
    ]);
    expect(finishedRunPace(run)).toBe('10:04 /mi');

    const exported = gpsDiagnosticsExport(run, new Date('2026-10-27T08:00:00.000Z'));
    expect(exported.filename).toBe('hyper-gps-2026-10-27T07-00-00-000Z.json');
    const payload = JSON.parse(exported.content);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.exportedAt).toBe('2026-10-27T08:00:00.000Z');
    expect(payload.trace).toHaveLength(1);
    expect(payload.summary.trace).toBeUndefined();
    expect(payload.summary.runId).toBe('run-1');
  });

  it('keeps the run when a save fails, saying why', () => {
    expect(runSaveErrorMessage(new Error('Network down.'))).toBe('Network down. The run stays here until you discard it.');
    expect(runSaveErrorMessage('nope')).toBe('Could not save the run. It stays here until you discard it.');
  });
});
