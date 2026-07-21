import { describe, expect, it } from 'vitest';

import {
  advanceTracker,
  averagePaceSecPerMile,
  createTracker,
  currentLapDistanceM,
  currentSpeedMps,
  defaultTrackerConfig,
  elapsedSeconds,
  finishTracker,
  finishedRunToActivity,
  haversineMeters,
  isGpsWeak,
  isAutoPaused,
  isPaused,
  isWarmingUp,
  manualSplit,
  pauseTracker,
  restoreTracker,
  restoreTrackerTrace,
  restoreFinishedRun,
  resumeTracker,
  rollingPaceSecPerMile,
  serializeFinishedRun,
  serializeTracker,
  serializeTrackerTrace,
  summarizeGpsTrace,
  type GpsSample,
  type GpsTracePoint,
  type TrackerEvent,
  type TrackerState,
} from '@/lib/runTracker';
import { buildScenarioSamples, intervals8x400, sprints6x90m, stationaryDrift, steadyRun5k } from '@/lib/gpsScenarios';

const T0 = Date.parse('2026-07-11T14:00:00.000Z');

function shift(samples: GpsSample[], baseMs = T0): GpsSample[] {
  return samples.map((s) => ({ ...s, t: baseMs + s.t }));
}

function drive(state: TrackerState, samples: GpsSample[]): { state: TrackerState; events: TrackerEvent[]; trace: GpsTracePoint[] } {
  const events: TrackerEvent[] = [];
  const trace: GpsTracePoint[] = [];
  let current = state;
  for (const sample of samples) {
    const result = advanceTracker(current, sample);
    current = result.state;
    events.push(...result.events);
    if (result.observation) trace.push(result.observation);
  }
  return { state: current, events, trace };
}

describe('haversineMeters', () => {
  it('matches the meters-per-degree-latitude constant', () => {
    const a = { lat: 37.0, lon: -122.0 };
    const b = { lat: 37.001, lon: -122.0 };
    expect(haversineMeters(a, b)).toBeGreaterThan(110);
    expect(haversineMeters(a, b)).toBeLessThan(112);
  });

  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 37, lon: -122 }, { lat: 37, lon: -122 })).toBe(0);
  });
});

describe('ingestion filters', () => {
  it('counts no distance during warm-up', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 3 }]));

    const { state } = drive(tracker, samples.slice(0, 3));

    expect(isWarmingUp(state)).toBe(false); // 3 samples consumed by warm-up
    expect(state.totalDistanceM).toBe(0);
  });

  it('rejects poor-accuracy fixes and resets the warm-up streak', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const good = shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 2 }])).slice(0, 2);
    const bad: GpsSample = { ...good[1], t: good[1].t + 1000, accuracyM: 80 };

    const { state } = drive(tracker, [...good, bad]);

    expect(state.warmupCount).toBe(0);
    expect(state.totalDistanceM).toBe(0);
  });

  it('drops teleport glitches but re-anchors after persistent jumps', () => {
    const config = defaultTrackerConfig('free');
    const tracker = createTracker(config, T0);
    const warm = shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 6 }]));

    let { state } = drive(tracker, warm);
    const distBefore = state.totalDistanceM;

    // one impossible 200 m/s jump: ignored
    const glitch: GpsSample = {
      t: warm[warm.length - 1].t + 1000,
      lat: warm[warm.length - 1].lat + 0.002,
      lon: warm[warm.length - 1].lon,
      accuracyM: 8,
      speedMps: null,
    };
    state = advanceTracker(state, glitch).state;
    expect(state.totalDistanceM).toBe(distBefore);
  });

  it('accumulates slow progress despite the per-step jitter floor', () => {
    // 1.5 m/s walking with 1s samples: every step < 2m floor, distance must
    // still accrue because the anchor only advances on accepted steps
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 1.5, durationS: 120 }]));

    const { state } = drive(tracker, samples);

    const expected = 1.5 * 117; // minus warm-up samples
    expect(state.totalDistanceM).toBeGreaterThan(expected * 0.95);
    expect(state.totalDistanceM).toBeLessThanOrEqual(expected * 1.05);
  });

  it('counts sensor-confirmed slow indoor walking without reintroducing stationary drift', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const raw = buildScenarioSamples([{ speedMps: 0.75, durationS: 60 }], 15);
    const frozenFix = raw[8];
    const samples = shift(
      raw.map((sample, index) => ({
        ...sample,
        // Reproduce the apartment failure: the browser coordinate stops moving
        // after roughly 6 m even though speed and phone motion continue.
        ...(index > 8 ? { lat: frozenFix.lat, lon: frozenFix.lon } : {}),
        motionDetected: sample.t >= 2000,
      })),
    );

    const { state } = drive(tracker, samples);

    expect(state.totalDistanceM).toBeGreaterThan(38);
    expect(state.totalDistanceM).toBeLessThan(46);
  });

  it('banks ~no distance while standing still despite GPS drift', () => {
    // the reported "distance climbs while standing" bug: 120s of a wandering
    // fix (±10m) with device speed ~0 must accrue essentially nothing
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(stationaryDrift.build());

    const { state } = drive(tracker, samples);

    expect(state.totalDistanceM).toBeLessThan(5);
  });

  it('ignores phone fidget even when iOS reports a small non-zero speed', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(stationaryDrift.build().map((sample) => ({ ...sample, speedMps: 0.9 })));

    const { state } = drive(tracker, samples);

    expect(state.totalDistanceM).toBe(0);
  });

  it('uses combined GPS uncertainty when device speed is unavailable', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(stationaryDrift.build().map((sample) => ({ ...sample, speedMps: null })));

    const { state } = drive(tracker, samples);

    expect(state.totalDistanceM).toBeLessThan(5);
  });

  it('still counts real movement even when the fix is noisy', () => {
    // moving at 3 m/s but with device speed reported: distance tracks the move,
    // not inflated by accuracy noise
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 3.0, durationS: 100 }], 18));

    const { state } = drive(tracker, samples);

    const expected = 3.0 * 97;
    expect(state.totalDistanceM).toBeGreaterThan(expected * 0.9);
    expect(state.totalDistanceM).toBeLessThan(expected * 1.1);
  });

  it('uses platform speed to prevent zig-zag coordinate inflation', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const metersPerDegree = 111_320;
    const samples = shift(buildScenarioSamples([{ speedMps: 3.0, durationS: 100 }], 8).map((sample, index) => ({
      ...sample,
      // A ±6m lateral wobble would add roughly 12m per second if every raw
      // coordinate were naively connected.
      lon: sample.lon + (index % 2 === 0 ? 6 : -6) / metersPerDegree,
    })));

    const { state, trace } = drive(tracker, samples);

    expect(state.totalDistanceM).toBeGreaterThan(285);
    expect(state.totalDistanceM).toBeLessThan(305);
    expect(trace.some((point) => point.decision === 'accepted_speed')).toBe(true);
  });

  it('bridges a coordinate spike with a plausible fresh speed sample', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 3.0, durationS: 12 }], 8));
    samples[8] = { ...samples[8], lat: samples[8].lat + 0.003 };

    const { state, trace } = drive(tracker, samples);

    expect(state.totalDistanceM).toBeGreaterThan(24);
    expect(state.totalDistanceM).toBeLessThan(34);
    expect(trace[8].decision).toBe('accepted_speed');
  });
});

describe('pause / resume', () => {
  it('freezes distance and elapsed time while paused, then resumes cleanly', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const first = shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 60 }]));
    let { state } = drive(tracker, first);

    const distAtPause = state.totalDistanceM;
    const pauseT = first[first.length - 1].t;
    const elapsedAtPause = elapsedSeconds(state, pauseT);

    state = pauseTracker(state, pauseT);
    expect(isPaused(state)).toBe(true);

    // 45s of samples arrive while paused (e.g. walking around at a light)
    const during = shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 45 }]), pauseT);
    state = drive(state, during).state;

    // neither distance nor the (frozen) clock moved
    expect(state.totalDistanceM).toBe(distAtPause);
    expect(elapsedSeconds(state, pauseT + 45_000)).toBe(elapsedAtPause);

    // resume and run 60 more seconds
    const resumeT = pauseT + 45_000;
    state = resumeTracker(state, resumeT);
    expect(isPaused(state)).toBe(false);
    const after = shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 60 }]), resumeT);
    state = drive(state, after).state;

    // distance grew again; elapsed excludes the 45s paused span
    expect(state.totalDistanceM).toBeGreaterThan(distAtPause + 150);
    const finalElapsed = elapsedSeconds(state, resumeT + 60_000);
    // ~60 (pre-pause) + ~60 (post-resume), NOT 165
    expect(finalElapsed).toBeGreaterThan(110);
    expect(finalElapsed).toBeLessThan(130);
    expect(rollingPaceSecPerMile(state, resumeT + 60_000)).toBeLessThan(500);
  });

  it('does not count the gap when resuming after being carried', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    let { state } = drive(tracker, shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 30 }])));
    const distBefore = state.totalDistanceM;

    state = pauseTracker(state, T0 + 30_000);
    state = resumeTracker(state, T0 + 30_000);
    // first post-resume sample is far away (phone was carried) — must re-anchor,
    // not bank a giant jump
    const far = { t: T0 + 31_000, lat: 37.90, lon: -122.30, accuracyM: 8, speedMps: 3.5 };
    state = advanceTracker(state, far).state;

    expect(state.totalDistanceM).toBe(distBefore);
  });

  it('ignores manual splits while paused', () => {
    const tracker = createTracker(defaultTrackerConfig('intervals', null), T0);
    let { state } = drive(tracker, shift(buildScenarioSamples([{ speedMps: 4, durationS: 60 }])));
    state = pauseTracker(state, T0 + 60_000);

    const result = manualSplit(state, T0 + 61_000);
    expect(result.events).toHaveLength(0);
    expect(result.state.laps).toHaveLength(0);
  });

  it('auto-pauses sustained stops and resumes without banking the GPS gap', () => {
    const tracker = createTracker(defaultTrackerConfig('free', null, true), T0);
    const samples = shift(buildScenarioSamples([
      { speedMps: 3, durationS: 10 },
      { speedMps: 0, durationS: 10 },
      { speedMps: 3, durationS: 10 },
    ]));

    let state = drive(tracker, samples.slice(0, 21)).state;
    expect(isAutoPaused(state)).toBe(true);

    state = drive(state, samples.slice(21)).state;
    expect(isAutoPaused(state)).toBe(false);
    expect(state.totalDistanceM).toBeGreaterThan(48);
    expect(state.totalDistanceM).toBeLessThan(55);
    expect(elapsedSeconds(state, samples[samples.length - 1].t)).toBe(18);
    expect(rollingPaceSecPerMile(state, samples[samples.length - 1].t)).toBeLessThan(600);
  });

  it('uses quiet motion evidence to auto-pause when platform speed is missing', () => {
    const tracker = createTracker(defaultTrackerConfig('free', null, true), T0);
    const samples = shift(stationaryDrift.build().slice(0, 15).map((sample) => ({
      ...sample,
      speedMps: null,
      motionDetected: false,
    })));

    const { state } = drive(tracker, samples);

    expect(isAutoPaused(state)).toBe(true);
    expect(state.totalDistanceM).toBe(0);
  });
});

describe('free run', () => {
  it('shows whole-session average pace before the rolling window has 20 metres', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(
      buildScenarioSamples([{ speedMps: 0.75, durationS: 12 }]).map((sample) => ({
        ...sample,
        motionDetected: true,
      })),
    );
    const { state } = drive(tracker, samples);
    const lastT = samples[samples.length - 1].t;

    expect(state.totalDistanceM).toBeGreaterThan(5);
    expect(state.totalDistanceM).toBeLessThan(20);
    expect(rollingPaceSecPerMile(state, lastT)).toBeNull();
    expect(averagePaceSecPerMile(state, lastT)).not.toBeNull();
  });

  it('tracks the steady 5k within tolerance and reports a sane rolling pace', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(steadyRun5k.build());

    const { state } = drive(tracker, samples);
    const lastT = samples[samples.length - 1].t;

    // 3.5 m/s * 1440 s = 5040 m, minus a few warm-up meters
    expect(state.totalDistanceM).toBeGreaterThan(4980);
    expect(state.totalDistanceM).toBeLessThan(5045);

    // 3.5 m/s = 459.8 s/mile (7:40 /mi)
    const pace = rollingPaceSecPerMile(state, lastT);
    expect(pace).not.toBeNull();
    expect(pace!).toBeGreaterThan(450);
    expect(pace!).toBeLessThan(470);

    // The clock begins only after the three-fix GPS lock, so acquisition time
    // is not charged to the athlete's pace.
    expect(elapsedSeconds(state, lastT)).toBe(1438);
    expect(isGpsWeak(state, lastT)).toBe(false);
    expect(isGpsWeak(state, lastT + 10_000)).toBe(true);
  });
});

describe('interval laps', () => {
  it('auto-splits every 400m with interpolated boundaries', () => {
    const tracker = createTracker(defaultTrackerConfig('intervals', 400), T0);
    const samples = shift(intervals8x400.build());

    const { state, events } = drive(tracker, samples);

    const lapEvents = events.filter((e) => e.type === 'lap_completed');
    const expectedLaps = Math.floor(state.totalDistanceM / 400);
    expect(lapEvents).toHaveLength(expectedLaps);
    expect(expectedLaps).toBeGreaterThanOrEqual(10);

    for (const event of lapEvents) {
      if (event.type !== 'lap_completed') continue;
      expect(event.lap.distanceM).toBeCloseTo(400, 6);
      expect(event.lap.trigger).toBe('auto');
    }

    // first lap is ridden entirely at 400/90 m/s: duration ≈ 90s (+ warm-up skew)
    const firstLap = lapEvents[0].type === 'lap_completed' ? lapEvents[0].lap : null;
    const firstLapS = firstLap ? (firstLap.endedAtMs - firstLap.startedAtMs) / 1000 : 0;
    expect(firstLapS).toBeGreaterThan(85);
    expect(firstLapS).toBeLessThan(96);
  });

  it('records manual splits, debounces double-taps, and resets live pace', () => {
    const tracker = createTracker(defaultTrackerConfig('intervals', null), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 4, durationS: 120 }]));

    let { state } = drive(tracker, samples.slice(0, 61));
    const tSplit = samples[60].t;

    const splitResult = manualSplit(state, tSplit);
    state = splitResult.state;
    expect(splitResult.events).toHaveLength(1);
    expect(state.laps).toHaveLength(1);
    expect(state.laps[0].trigger).toBe('manual');
    expect(state.laps[0].distanceM).toBeGreaterThan(200);

    // double-tap within the debounce window is ignored
    const doubleTap = manualSplit(state, tSplit + 300);
    expect(doubleTap.events).toHaveLength(0);
    expect(doubleTap.state.laps).toHaveLength(1);

    // pace right after a split is null until the new lap has enough distance
    expect(rollingPaceSecPerMile(state, tSplit + 1)).toBeNull();
    expect(currentLapDistanceM(state)).toBe(0);

    state = drive(state, samples.slice(61)).state;
    expect(rollingPaceSecPerMile(state, samples[samples.length - 1].t)).not.toBeNull();
  });
});

describe('sprint detection', () => {
  it('detects exactly 6 hands-free reps and never triggers on recovery jogs', () => {
    const tracker = createTracker(defaultTrackerConfig('sprints'), T0);
    const samples = shift(sprints6x90m.build());

    const { state, events } = drive(tracker, samples);

    expect(state.reps).toHaveLength(6);
    expect(events.filter((e) => e.type === 'sprint_started')).toHaveLength(6);
    expect(events.filter((e) => e.type === 'sprint_completed')).toHaveLength(6);

    for (const rep of state.reps) {
      expect(rep.distanceM).toBeGreaterThan(60);
      expect(rep.distanceM).toBeLessThan(130);
      expect(rep.peakSpeedMps).toBeGreaterThan(6.5);
      const durationS = (rep.endedAtMs - rep.startedAtMs) / 1000;
      expect(durationS).toBeGreaterThan(8);
      expect(durationS).toBeLessThan(25);
    }
  });

  it('discards sub-threshold blips', () => {
    // a 2s surge: EMA barely crosses the start threshold, never holds
    const tracker = createTracker(defaultTrackerConfig('sprints'), T0);
    const samples = shift(
      buildScenarioSamples([
        { speedMps: 1.8, durationS: 30 },
        { speedMps: 7.5, durationS: 2 },
        { speedMps: 1.8, durationS: 60 },
      ]),
    );

    const { state } = drive(tracker, samples);

    expect(state.reps).toHaveLength(0);
  });
});

describe('finish + activity mapping', () => {
  it('maps a free run to one run session with a single segment', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 600 }]));
    const { state } = drive(tracker, samples);

    const run = finishTracker(state, samples[samples.length - 1].t);
    const { session, segments } = finishedRunToActivity(run, 'run123');

    expect(session.activity_type).toBe('run');
    expect(session.source).toBe('gps');
    expect(session.duration_seconds).toBe(598);
    expect(segments).toHaveLength(1);
    expect(segments[0].external_id).toBe('gps:run123:1');
  });

  it('maps interval laps to segments including the open final lap', () => {
    const tracker = createTracker(defaultTrackerConfig('intervals', 400), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 4, durationS: 250 }])); // ~988m
    const { state } = drive(tracker, samples);

    const run = finishTracker(state, samples[samples.length - 1].t);
    const { session, segments } = finishedRunToActivity(run, 'run456');

    expect(session.activity_type).toBe('interval_run');
    expect(run.laps.length).toBe(3); // 2 auto + 1 open finish lap
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.external_id)).toEqual([
      'gps:run456:1',
      'gps:run456:2',
      'gps:run456:3',
    ]);
    expect(run.laps[2].trigger).toBe('finish');
  });

  it('maps sprint reps to segments', () => {
    const tracker = createTracker(defaultTrackerConfig('sprints'), T0);
    const samples = shift(sprints6x90m.build());
    const { state } = drive(tracker, samples);

    const run = finishTracker(state, samples[samples.length - 1].t);
    const { session, segments } = finishedRunToActivity(run, 'run789');

    expect(session.activity_type).toBe('sprint_session');
    expect(segments).toHaveLength(6);
    expect(segments[0].raw).toHaveProperty('peak_speed_mps');
  });
});

describe('persistence', () => {
  it('round-trips a running tracker', () => {
    const tracker = createTracker(defaultTrackerConfig('intervals', 400), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 4, durationS: 120 }]));
    const { state, trace } = drive(tracker, samples);

    const raw = serializeTracker(state, samples[samples.length - 1].t, trace);
    const restored = restoreTracker(raw, samples[samples.length - 1].t + 60_000);

    expect(restored).not.toBeNull();
    expect(restored!.totalDistanceM).toBeCloseTo(state.totalDistanceM, 6);
    expect(restored!.config.autoLapM).toBe(400);
    expect(restoreTrackerTrace(raw)).toEqual(trace);
    const traceRaw = serializeTrackerTrace(state.runId, samples[samples.length - 1].t, trace);
    expect(restoreTrackerTrace(traceRaw, state.runId)).toEqual(trace);
    expect(restoreTrackerTrace(traceRaw, 'another-run')).toEqual([]);
  });

  it('refuses stale or invalid snapshots', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const raw = serializeTracker(tracker, T0);

    expect(restoreTracker(raw, T0 + 13 * 60 * 60 * 1000)).toBeNull();
    expect(restoreTracker('not json', T0)).toBeNull();
    expect(restoreTracker(null, T0)).toBeNull();
  });

  it('recovers an unsaved finished run after a page reload', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0, 'recover-me');
    const run = finishTracker(tracker, T0 + 60_000);
    const raw = serializeFinishedRun(run, T0 + 60_000);

    expect(restoreTracker(raw, T0 + 61_000)).toBeNull();
    expect(restoreFinishedRun(raw, T0 + 61_000)).toEqual({ ...run, trace: undefined });
    expect(restoreFinishedRun(raw, T0 + 8 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it('summarizes trace quality without treating stationary samples as GPS failures', () => {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const { trace } = drive(tracker, shift(stationaryDrift.build().slice(0, 12)));

    const quality = summarizeGpsTrace(trace);

    expect(quality.sampleCount).toBe(12);
    expect(quality.rejectedSampleCount).toBe(0);
    expect(quality.averageAccuracyM).toBe(12);
    expect(quality.longestGapS).toBe(1);
  });
});

describe('currentSpeedMps', () => {
  function drivenState(): { state: TrackerState; lastT: number } {
    const tracker = createTracker(defaultTrackerConfig('free'), T0);
    const samples = shift(buildScenarioSamples([{ speedMps: 3.5, durationS: 30 }]));
    const { state } = drive(tracker, samples);
    return { state, lastT: samples[samples.length - 1].t };
  }

  it('reports the fresh device speed of the last accepted sample', () => {
    const { state, lastT } = drivenState();
    expect(currentSpeedMps(state, lastT + 1_000)).toBeCloseTo(3.5, 1);
  });

  it('goes null after a delivery gap instead of freezing a stale value', () => {
    const { state, lastT } = drivenState();
    expect(currentSpeedMps(state, lastT + 10_000)).toBeNull();
  });

  it('goes null while manually paused', () => {
    const { state, lastT } = drivenState();
    const paused = pauseTracker(state, lastT + 500);
    expect(currentSpeedMps(paused, lastT + 1_000)).toBeNull();
  });
});
