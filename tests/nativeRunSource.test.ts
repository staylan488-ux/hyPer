import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeRunControl, NativeRunSample } from '@/lib/nativeBridge';
import { createNativeRunSource } from '@/lib/nativeRunSource';
import {
  advanceRecordedSample,
  advanceTracker,
  createTracker,
  defaultTrackerConfig,
  isPaused,
  nativeResumePoint,
  pauseTracker,
  restoreTracker,
  serializeTracker,
  type GpsSample,
  type TrackerEvent,
  type TrackerState,
} from '@/lib/runTracker';
import { buildScenarioSamples } from '@/lib/gpsScenarios';

// A scripted stand-in for the HyperRun plugin. By default the drains page
// through an in-memory "durable store" the way HyperRunPlugin.swift does
// (sequence > afterSequence, fixed page size). Tests can queue one-off
// responses (including pending promises) to pin down races.
type SampleBatch = { samples: NativeRunSample[]; lastSequence: number; hasMore: boolean };
type ControlBatch = { controls: NativeRunControl[]; lastSequence: number; hasMore: boolean };
type Scripted<T> = (afterSequence: number) => T | Promise<T>;

const fake = vi.hoisted(() => {
  const state = {
    samples: [] as NativeRunSample[],
    controls: [] as NativeRunControl[],
    samplePageSize: 1_000,
    controlPageSize: 100,
    sampleScript: [] as Array<Scripted<SampleBatch>>,
    controlScript: [] as Array<Scripted<ControlBatch>>,
    listeners: new Map<string, Array<(event: unknown) => void>>(),
    removes: [] as Array<ReturnType<typeof vi.fn>>,
  };

  const NativeRun = {
    requestPermissions: vi.fn(async () => ({ location: 'whenInUse', precise: true, motionAvailable: true })),
    startRecording: vi.fn(async (options: { runId: string; resume: boolean }) => {
      // mirrors HyperRunPlugin.startRecording: a fresh start resets the store
      if (!options.resume) {
        state.samples = [];
        state.controls = [];
      }
      return { recording: true, lastSequence: state.samples.at(-1)?.sequence ?? 0 };
    }),
    stopRecording: vi.fn(async (options?: { discard?: boolean }) => {
      if (options?.discard) {
        state.samples = [];
        state.controls = [];
      }
    }),
    drainSamples: vi.fn(async ({ afterSequence }: { afterSequence: number }): Promise<SampleBatch> => {
      const scripted = state.sampleScript.shift();
      if (scripted) return scripted(afterSequence);
      const pending = state.samples.filter((sample) => sample.sequence > afterSequence);
      const page = pending.slice(0, state.samplePageSize);
      return {
        samples: page,
        lastSequence: page.at(-1)?.sequence ?? afterSequence,
        // HyperRunPlugin reports more only for a full page
        hasMore: page.length === state.samplePageSize,
      };
    }),
    drainControls: vi.fn(async ({ afterSequence }: { afterSequence: number }): Promise<ControlBatch> => {
      const scripted = state.controlScript.shift();
      if (scripted) return scripted(afterSequence);
      const pending = state.controls.filter((control) => control.sequence > afterSequence);
      const page = pending.slice(0, state.controlPageSize);
      return {
        controls: page,
        lastSequence: page.at(-1)?.sequence ?? afterSequence,
        hasMore: page.length < pending.length,
      };
    }),
    addListener: vi.fn(async (eventName: string, callback: (event: unknown) => void) => {
      const callbacks = state.listeners.get(eventName) ?? [];
      callbacks.push(callback);
      state.listeners.set(eventName, callbacks);
      const remove = vi.fn(async () => {
        const current = state.listeners.get(eventName) ?? [];
        state.listeners.set(eventName, current.filter((entry) => entry !== callback));
      });
      state.removes.push(remove);
      return { remove };
    }),
  };

  return {
    state,
    NativeRun,
    emit(eventName: string, event: unknown) {
      for (const callback of state.listeners.get(eventName) ?? []) callback(event);
    },
    listenerCount() {
      let count = 0;
      for (const callbacks of state.listeners.values()) count += callbacks.length;
      return count;
    },
    reset() {
      state.samples = [];
      state.controls = [];
      state.samplePageSize = 1_000;
      state.controlPageSize = 100;
      state.sampleScript = [];
      state.controlScript = [];
      state.listeners = new Map();
      state.removes = [];
    },
  };
});

vi.mock('@/lib/nativeBridge', () => ({ NativeRun: fake.NativeRun }));

const T0 = Date.parse('2026-07-11T14:00:00.000Z');

function nativeSample(sequence: number, timestampMs = T0 + sequence * 1_000): NativeRunSample {
  return {
    sequence,
    timestampMs,
    latitude: 37.8712 + sequence * 0.00003,
    longitude: -122.2601,
    horizontalAccuracyM: 5,
    speedMps: 3,
    speedAccuracyMps: 0.5,
    courseDegrees: null,
    courseAccuracyDegrees: null,
    altitudeM: 10,
    verticalAccuracyM: 3,
    motion: 'moving',
    reducedAccuracy: false,
    simulated: false,
  };
}

function nativeControl(sequence: number, timestampMs: number, action: NativeRunControl['action'] = 'split'): NativeRunControl {
  return { sequence, timestampMs, action };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

// every awaited bridge call resolves in a microtask; one macrotask turn lets
// the whole fire-and-forget start()/resync() chain settle
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// t = T0 + seq * 1000 by construction, so delivered timestamps map back to
// the native sequence without relying on any extra field on GpsSample
const seqOf = (sample: GpsSample) => Math.round((sample.t - T0) / 1_000);

function startSource(source: ReturnType<typeof createNativeRunSource>) {
  const delivered: GpsSample[] = [];
  const controls: NativeRunControl[] = [];
  const errors: string[] = [];
  const order: string[] = [];
  source.start(
    (sample) => { delivered.push(sample); order.push(`s${seqOf(sample)}`); },
    (message) => errors.push(message),
    (control) => { controls.push(control); order.push(`c${control.sequence}`); },
  );
  return { delivered, controls, errors, order };
}

const afterSequences = (mock: typeof fake.NativeRun.drainSamples | typeof fake.NativeRun.drainControls) =>
  mock.mock.calls.map(([options]) => options.afterSequence);

beforeEach(() => {
  fake.reset();
});

describe('createNativeRunSource recovery drain', () => {
  it('pages through a multi-page drain with a growing cursor and delivers each sample once, in time order', async () => {
    fake.state.samples = range(1, 5).map((seq) => nativeSample(seq));
    fake.state.samplePageSize = 2;

    const source = createNativeRunSource('run-a', true);
    const { delivered } = startSource(source);
    await settle();

    // first drain pages 0 -> 2 -> 4 (-> 5 with hasMore false); the
    // post-subscribe drain resumes from 5
    expect(afterSequences(fake.NativeRun.drainSamples)).toEqual([0, 2, 4, 5]);
    expect(delivered.map(seqOf)).toEqual([1, 2, 3, 4, 5]);
  });

  it('sorts a drained batch by timestamp before delivery', async () => {
    fake.state.sampleScript.push(() => ({
      samples: [nativeSample(2, T0 + 3_000), nativeSample(1, T0 + 1_000)],
      lastSequence: 2,
      hasMore: false,
    }));

    const { delivered } = startSource(createNativeRunSource('run-a', true));
    await settle();

    expect(delivered.map((sample) => sample.t)).toEqual([T0 + 1_000, T0 + 3_000]);
  });

  it('interleaves drained samples and controls by timestamp', async () => {
    fake.state.samples = [nativeSample(1), nativeSample(3)];
    fake.state.controls = [nativeControl(1, T0 + 2_000)];

    const { order } = startSource(createNativeRunSource('run-a', true));
    await settle();

    expect(order).toEqual(['s1', 'c1', 's3']);
  });

  it('dedups a live sample that a later drain returns again', async () => {
    fake.state.samples = range(1, 5).map((seq) => nativeSample(seq));
    const source = createNativeRunSource('run-a', true);
    const { delivered } = startSource(source);
    await settle();

    fake.state.samples.push(nativeSample(6));
    fake.emit('locationSample', nativeSample(6));
    source.resync();
    await settle();

    expect(delivered.map(seqOf)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('dedups a drained sample that the live listener delivers again', async () => {
    const source = createNativeRunSource('run-a', true);
    const { delivered } = startSource(source);
    await settle();

    fake.state.samples.push(nativeSample(1));
    source.resync();
    await settle();
    fake.emit('locationSample', nativeSample(1));

    expect(delivered.map(seqOf)).toEqual([1]);
  });

  it('dedups live and drained controls in both orders', async () => {
    const source = createNativeRunSource('run-a', true);
    const { controls } = startSource(source);
    await settle();

    fake.state.controls.push(nativeControl(1, T0 + 1_000));
    fake.emit('runControl', nativeControl(1, T0 + 1_000));
    source.resync();
    await settle();

    fake.state.controls.push(nativeControl(2, T0 + 2_000));
    source.resync();
    await settle();
    fake.emit('runControl', nativeControl(2, T0 + 2_000));

    expect(controls.map((control) => control.sequence)).toEqual([1, 2]);
  });

  it('delivers each sequence once when a resync drain overlaps the second start drain', async () => {
    const secondStartDrain = deferred<SampleBatch>();
    const overlapping = {
      samples: range(1, 3).map((seq) => nativeSample(seq)),
      lastSequence: 3,
      hasMore: false,
    };
    fake.state.sampleScript.push(
      () => ({ samples: [], lastSequence: 0, hasMore: false }),
      () => secondStartDrain.promise,
      () => overlapping,
    );

    const source = createNativeRunSource('run-a', true);
    const { delivered } = startSource(source);
    await settle();
    expect(fake.NativeRun.drainSamples).toHaveBeenCalledTimes(2);

    source.resync();
    await settle();
    secondStartDrain.resolve(overlapping);
    await settle();

    expect(delivered.map(seqOf)).toEqual([1, 2, 3]);
  });
});

describe('createNativeRunSource lifecycle', () => {
  it('stop() before startRecording resolves attaches no listeners and discards natively', async () => {
    fake.state.samples = range(1, 3).map((seq) => nativeSample(seq));
    const recordingStarted = deferred<{ recording: boolean; lastSequence: number }>();
    fake.NativeRun.startRecording.mockReturnValueOnce(recordingStarted.promise);

    const source = createNativeRunSource('run-a', false);
    const { delivered, errors } = startSource(source);
    await settle();
    source.stop(true);
    recordingStarted.resolve({ recording: true, lastSequence: 3 });
    await settle();

    expect(fake.NativeRun.stopRecording).toHaveBeenCalledWith({ discard: true });
    // stopRecording(discard) clears the durable file before the drain is served
    expect(delivered).toEqual([]);
    expect(errors).toEqual([]);
    expect(fake.NativeRun.addListener).not.toHaveBeenCalled();
    expect(fake.listenerCount()).toBe(0);
  });

  it('detach() removes listeners, keeps native recording, and drops later live events', async () => {
    const source = createNativeRunSource('run-a', true);
    const { delivered, controls } = startSource(source);
    await settle();
    expect(fake.listenerCount()).toBe(3);

    // capture the callbacks as the bridge would hold them before removal lands
    const liveSample = fake.state.listeners.get('locationSample')![0];
    const liveControl = fake.state.listeners.get('runControl')![0];
    source.detach();
    await settle();

    expect(fake.state.removes).toHaveLength(3);
    for (const remove of fake.state.removes) expect(remove).toHaveBeenCalledTimes(1);
    expect(fake.NativeRun.stopRecording).not.toHaveBeenCalled();
    liveSample(nativeSample(1));
    liveControl(nativeControl(1, T0 + 1_000));
    expect(delivered).toEqual([]);
    expect(controls).toEqual([]);
  });

  it.each(['denied', 'restricted'] as const)('reports a %s location permission without starting', async (location) => {
    fake.NativeRun.requestPermissions.mockResolvedValueOnce({ location, precise: false, motionAvailable: false });

    const { errors } = startSource(createNativeRunSource('run-a', false));
    await settle();

    expect(errors).toEqual(['Location permission denied. Allow Precise Location to track runs.']);
    expect(fake.NativeRun.startRecording).not.toHaveBeenCalled();
  });

  it('swallows a failed resync drain', async () => {
    const source = createNativeRunSource('run-a', true);
    const { delivered, errors } = startSource(source);
    await settle();

    fake.state.sampleScript.push(() => Promise.reject(new Error('bridge gone')));
    expect(() => source.resync()).not.toThrow();
    await settle();

    expect(delivered).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe('out-of-order delivery into the engine', () => {
  it('marks an older sample stale without losing distance', () => {
    const samples = buildScenarioSamples([{ speedMps: 3, durationS: 12 }]).map((sample) => ({
      ...sample,
      t: T0 + sample.t,
    }));
    const drive = (order: GpsSample[]) => {
      let state: TrackerState = createTracker(defaultTrackerConfig('free'), T0);
      const decisions: string[] = [];
      for (const sample of order) {
        const result = advanceTracker(state, sample);
        state = result.state;
        decisions.push(result.observation?.decision ?? 'none');
      }
      return { state, decisions };
    };

    const inOrder = drive(samples);
    // swap two mid-run samples: the newer arrives before the older one
    const swapped = [...samples];
    [swapped[7], swapped[8]] = [swapped[8], swapped[7]];
    const outOfOrder = drive(swapped);

    expect(outOfOrder.decisions[8]).toBe('stale');
    // the anchor is kept, so the next sample measures from it: the distance
    // is covered as a straight chord, not dropped
    expect(outOfOrder.state.totalDistanceM).toBeCloseTo(inOrder.state.totalDistanceM, 0);
    expect(outOfOrder.state.totalDistanceM).toBeGreaterThan(0);
  });
});

describe('resuming a native run from a snapshot', () => {
  // A 600 s run at 3 m/s recorded natively: sequence n is scenario sample n-1.
  function recordedRun(mode: 'free' | 'intervals' = 'intervals') {
    const gps = buildScenarioSamples([{ speedMps: 3, durationS: 600 }]).map((sample) => ({
      ...sample,
      t: T0 + sample.t,
    }));
    const native = gps.map((sample, index): NativeRunSample => ({
      ...nativeSample(index + 1, sample.t),
      latitude: sample.lat,
      longitude: sample.lon,
      horizontalAccuracyM: sample.accuracyM,
      speedMps: sample.speedMps,
    }));
    const config = defaultTrackerConfig(mode, mode === 'intervals' ? 400 : null);
    return { native, tracker: createTracker(config, T0, 'run-resume') };
  }

  const asGps = (sample: NativeRunSample): GpsSample => ({
    t: sample.timestampMs,
    lat: sample.latitude,
    lon: sample.longitude,
    accuracyM: sample.horizontalAccuracyM,
    speedMps: sample.speedMps,
    speedAccuracyMps: sample.speedAccuracyMps,
    motionDetected: true,
    nativeSeq: sample.sequence,
  });

  function applySamples(state: TrackerState, samples: NativeRunSample[]) {
    const events: TrackerEvent[] = [];
    let current = state;
    for (const sample of samples) {
      const result = advanceRecordedSample(current, asGps(sample));
      current = result.state;
      events.push(...result.events);
    }
    return { state: current, events };
  }

  // Resume through the real source, the way useRunTracker.resume wires it.
  async function resumeThroughSource(restored: TrackerState, native: NativeRunSample[]) {
    fake.state.samples = native;
    const { cursors, replayCutoffMs } = nativeResumePoint(restored);
    const source = createNativeRunSource(restored.runId, true, cursors);
    let current = restored;
    const events: TrackerEvent[] = [];
    source.start((sample) => {
      const result = advanceRecordedSample(current, sample, replayCutoffMs);
      current = result.state;
      events.push(...result.events);
    }, () => undefined);
    await settle();
    return { state: current, events, cursors };
  }

  const lapEvents = (events: TrackerEvent[]) => events.filter((event) => event.type === 'lap_completed').length;

  it('replays only samples after the saved cursor', async () => {
    const { native, tracker } = recordedRun();
    const uninterrupted = applySamples(tracker, native);

    const beforeCrash = applySamples(tracker, native.slice(0, 300));
    expect(beforeCrash.state.nativeSampleSeq).toBe(300);
    const restored = restoreTracker(serializeTracker(beforeCrash.state, native[299].timestampMs), native[299].timestampMs + 1)!;
    const resumed = await resumeThroughSource(restored, native);

    expect(resumed.cursors.sample).toBe(300);
    expect(afterSequences(fake.NativeRun.drainSamples)[0]).toBe(300);
    // restore re-anchors lastPoint, so at most one GPS step is not counted
    expect(uninterrupted.state.totalDistanceM - resumed.state.totalDistanceM).toBeGreaterThanOrEqual(0);
    expect(uninterrupted.state.totalDistanceM - resumed.state.totalDistanceM).toBeLessThan(3.5);
    expect(resumed.state.laps).toHaveLength(uninterrupted.state.laps.length);
    expect(lapEvents(beforeCrash.events) + lapEvents(resumed.events)).toBe(lapEvents(uninterrupted.events));
    expect(resumed.state.nativeSampleSeq).toBe(native.length);
  });

  it('falls back to the last sample time for a snapshot without cursors', async () => {
    const { native, tracker } = recordedRun();
    const uninterrupted = applySamples(tracker, native);

    const beforeCrash = applySamples(tracker, native.slice(0, 300));
    const snapshot = JSON.parse(serializeTracker(beforeCrash.state, native[299].timestampMs)) as {
      state: Partial<TrackerState>;
    };
    delete snapshot.state.nativeSampleSeq;
    delete snapshot.state.nativeControlSeq;
    const restored = restoreTracker(JSON.stringify(snapshot), native[299].timestampMs + 1)!;
    const resumed = await resumeThroughSource(restored, native);

    expect(resumed.cursors).toEqual({ sample: 0, control: 0 });
    expect(nativeResumePoint(restored).replayCutoffMs).toBe(native[299].timestampMs);
    expect(uninterrupted.state.totalDistanceM - resumed.state.totalDistanceM).toBeGreaterThanOrEqual(0);
    expect(uninterrupted.state.totalDistanceM - resumed.state.totalDistanceM).toBeLessThan(3.5);
    expect(lapEvents(beforeCrash.events) + lapEvents(resumed.events)).toBe(lapEvents(uninterrupted.events));
  });

  it('does not bank samples from a paused stretch after a crash while paused', async () => {
    const { native, tracker } = recordedRun('free');
    const running = applySamples(tracker, native.slice(0, 200));
    const pausedAt = native[199].timestampMs + 500;
    const paused = applySamples(pauseTracker(running.state, pausedAt), native.slice(200, 260));
    // paused samples still move the cursor
    expect(paused.state.nativeSampleSeq).toBe(260);
    expect(paused.state.totalDistanceM).toBe(running.state.totalDistanceM);

    const savedAt = native[259].timestampMs;
    const restored = restoreTracker(serializeTracker(paused.state, savedAt), savedAt + 1)!;
    expect(isPaused(restored)).toBe(false);
    const resumed = await resumeThroughSource(restored, native);

    // only what was recorded after the snapshot counts; the paused stretch
    // (about 180 m) must not come back once restore un-pauses the run
    expect(afterSequences(fake.NativeRun.drainSamples)[0]).toBe(260);
    const reference = applySamples(
      restoreTracker(serializeTracker(paused.state, savedAt), savedAt + 1)!,
      native.slice(260),
    );
    expect(resumed.state.totalDistanceM).toBeCloseTo(reference.state.totalDistanceM, 6);
    const replayedFromPause = applySamples(restored, native.slice(200));
    expect(replayedFromPause.state.totalDistanceM - resumed.state.totalDistanceM).toBeGreaterThan(150);
  });

  it('keeps the native sequence out of the diagnostic trace', () => {
    const { native, tracker } = recordedRun();
    const result = advanceRecordedSample(tracker, asGps(native[0]));
    expect(result.observation).toBeDefined();
    expect(result.observation).not.toHaveProperty('nativeSeq');
    expect(result.state.nativeSampleSeq).toBe(1);
  });

  it('matches advanceTracker exactly for sources without a native sequence', () => {
    const { native, tracker } = recordedRun();
    const sample = { ...asGps(native[0]), nativeSeq: undefined };
    const recorded = advanceRecordedSample(tracker, sample);
    const plain = advanceTracker(tracker, sample);
    expect(recorded.state).toEqual(plain.state);
    expect(recorded.state.nativeSampleSeq).toBeNull();
  });
});

describe('createNativeRunSource resume cursors', () => {
  it('starts both drains from the saved cursors', async () => {
    fake.state.samples = range(1, 12).map((seq) => nativeSample(seq));
    fake.state.controls = [
      nativeControl(1, T0 + 2_500, 'split'),
      nativeControl(2, T0 + 5_500, 'rest'),
      nativeControl(3, T0 + 11_500, 'split'),
    ];

    const { delivered, controls } = startSource(createNativeRunSource('run-a', true, { sample: 10, control: 2 }));
    await settle();

    expect(afterSequences(fake.NativeRun.drainSamples)[0]).toBe(10);
    expect(afterSequences(fake.NativeRun.drainControls)[0]).toBe(2);
    expect(delivered.map(seqOf)).toEqual([11, 12]);
    // split and rest applied before the snapshot are not re-applied
    expect(controls.map((control) => control.sequence)).toEqual([3]);
  });

  it('drops both cursors to 0 when the native store was reset', async () => {
    // HyperRunPlugin resolves a reset with lastSequence 0; the fresh file then
    // records three new samples and no controls before the first drain
    fake.NativeRun.startRecording.mockImplementationOnce(async () => {
      fake.state.samples = range(1, 3).map((seq) => nativeSample(seq));
      return { recording: true, lastSequence: 0 };
    });
    const onNativeReset = vi.fn();

    const { delivered } = startSource(createNativeRunSource('run-a', true, { sample: 50, control: 4 }, onNativeReset));
    await settle();

    expect(onNativeReset).toHaveBeenCalledTimes(1);
    expect(onNativeReset).toHaveBeenCalledWith({ sample: 0, control: 0 });
    expect(afterSequences(fake.NativeRun.drainSamples)[0]).toBe(0);
    expect(afterSequences(fake.NativeRun.drainControls)[0]).toBe(0);
    expect(delivered.map(seqOf)).toEqual([1, 2, 3]);
  });

  it('follows a same-file sequence that fell behind without replaying controls', async () => {
    // JS applied samples 1-50 live, but native saved only 40 (a failed write);
    // the resumed recorder numbers new samples from 41 again
    fake.state.samples = [
      ...range(1, 40).map((seq) => nativeSample(seq)),
      nativeSample(41, T0 + 60_000),
      nativeSample(42, T0 + 61_000),
    ];
    fake.state.controls = [nativeControl(1, T0 + 2_500, 'split'), nativeControl(2, T0 + 5_500, 'rest')];
    fake.NativeRun.startRecording.mockResolvedValueOnce({ recording: true, lastSequence: 40 });
    const onNativeReset = vi.fn();

    const { delivered, controls } = startSource(
      createNativeRunSource('run-a', true, { sample: 50, control: 2 }, onNativeReset),
    );
    await settle();

    expect(onNativeReset).toHaveBeenCalledWith({ sample: 40, control: 2 });
    expect(afterSequences(fake.NativeRun.drainSamples)[0]).toBe(40);
    expect(afterSequences(fake.NativeRun.drainControls)[0]).toBe(2);
    expect(delivered.map((sample) => sample.nativeSeq)).toEqual([41, 42]);
    expect(controls).toEqual([]);
  });

  it('keeps the cursors when native resumed the same file', async () => {
    fake.state.samples = range(1, 50).map((seq) => nativeSample(seq));
    const onNativeReset = vi.fn();

    startSource(createNativeRunSource('run-a', true, { sample: 50, control: 0 }, onNativeReset));
    await settle();

    expect(onNativeReset).not.toHaveBeenCalled();
    expect(afterSequences(fake.NativeRun.drainSamples)[0]).toBe(50);
  });
});

describe('createNativeRunSource drain loop termination', () => {
  it('pages a full native page and then the remainder', async () => {
    fake.state.samples = range(1, 1_005).map((seq) => nativeSample(seq));

    const { delivered } = startSource(createNativeRunSource('run-a', true));
    await settle();

    expect(afterSequences(fake.NativeRun.drainSamples).slice(0, 2)).toEqual([0, 1_000]);
    expect(delivered).toHaveLength(1_005);
    expect(new Set(delivered.map(seqOf)).size).toBe(1_005);
    const times = delivered.map((sample) => sample.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('stops draining when native keeps reporting more without advancing', async () => {
    const source = createNativeRunSource('run-a', true);
    startSource(source);
    await settle();
    fake.NativeRun.drainSamples.mockClear();

    // e.g. an older native build whose in-memory sequence ran ahead of the file
    for (let index = 0; index < 50; index += 1) {
      fake.state.sampleScript.push((afterSequence) => ({ samples: [], lastSequence: afterSequence, hasMore: true }));
    }
    source.resync();
    await settle();

    expect(fake.NativeRun.drainSamples.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('keeps paging controls while samples are idle', async () => {
    fake.state.controls = range(1, 103).map((seq) => nativeControl(seq, T0 + seq * 1_000));

    const { controls } = startSource(createNativeRunSource('run-a', true));
    await settle();

    expect(afterSequences(fake.NativeRun.drainControls).slice(0, 2)).toEqual([0, 100]);
    expect(controls.map((control) => control.sequence)).toEqual(range(1, 103));
  });
});

describe('createNativeRunSource live cursor', () => {
  it('asks a resync only for samples after those the listener delivered', async () => {
    const source = createNativeRunSource('run-a', true);
    const { delivered } = startSource(source);
    await settle();
    fake.NativeRun.drainSamples.mockClear();

    for (const seq of range(1, 40)) {
      fake.state.samples.push(nativeSample(seq));
      fake.emit('locationSample', nativeSample(seq));
    }
    source.resync();
    await settle();

    expect(afterSequences(fake.NativeRun.drainSamples)).toEqual([40]);
    expect(delivered.map(seqOf)).toEqual(range(1, 40));
  });

  it('holds the cursor at a gap so the next drain recovers the missing sample', async () => {
    const source = createNativeRunSource('run-a', true);
    const { delivered } = startSource(source);
    await settle();
    fake.NativeRun.drainSamples.mockClear();

    fake.state.samples = range(1, 4).map((seq) => nativeSample(seq));
    fake.emit('locationSample', nativeSample(1));
    fake.emit('locationSample', nativeSample(2));
    // 3 was recorded while the WebView was not listening
    fake.emit('locationSample', nativeSample(4));
    source.resync();
    await settle();

    expect(afterSequences(fake.NativeRun.drainSamples)).toEqual([2, 4]);
    expect(delivered.map(seqOf)).toEqual([1, 2, 3, 4]);

    // with the gap filled the cursor moves past 4
    source.resync();
    await settle();
    expect(afterSequences(fake.NativeRun.drainSamples)).toEqual([2, 4, 4]);
  });

  it('continues paging from the last full page and then resyncs from the end', async () => {
    fake.state.samples = range(1, 1_500).map((seq) => nativeSample(seq));
    const source = createNativeRunSource('run-a', true);
    const { delivered } = startSource(source);
    await settle();

    expect(afterSequences(fake.NativeRun.drainSamples)).toEqual([0, 1_000, 1_500]);
    expect(delivered).toHaveLength(1_500);
    expect(new Set(delivered.map(seqOf)).size).toBe(1_500);

    source.resync();
    await settle();
    expect(afterSequences(fake.NativeRun.drainSamples).at(-1)).toBe(1_500);
  });

  it('starts a fresh source (resume after a tab switch) from its own cursor', async () => {
    fake.state.samples = range(1, 5).map((seq) => nativeSample(seq));
    const first = createNativeRunSource('run-a', true);
    startSource(first);
    await settle();
    first.detach();
    fake.NativeRun.drainSamples.mockClear();

    startSource(createNativeRunSource('run-a', true));
    await settle();

    expect(afterSequences(fake.NativeRun.drainSamples)[0]).toBe(0);
  });
});

it('drains suspended GPS before applying a newer live sample', async () => {
  const samples = range(1, 201).map((seq) => {
    const angle = seq * Math.PI * 2 / 120;
    return { ...nativeSample(seq), latitude: 37.8712 + 60 * Math.sin(angle) / 111320,
      longitude: -122.2601 + 60 * Math.cos(angle) / 88000, speedMps: Math.PI };
  });
  const toGps = (sample: NativeRunSample): GpsSample => ({
    t: sample.timestampMs, lat: sample.latitude, lon: sample.longitude, accuracyM: sample.horizontalAccuracyM,
    speedMps: sample.speedMps, speedAccuracyMps: sample.speedAccuracyMps, motionDetected: true, nativeSeq: sample.sequence,
  });
  let actual = createTracker(defaultTrackerConfig('free', null), T0, 'run-a');
  let reference = actual;
  for (const sample of samples) reference = advanceRecordedSample(reference, toGps(sample)).state;
  fake.state.samples = samples.slice(0, 20);
  const source = createNativeRunSource('run-a', true);
  source.start((sample) => { actual = advanceRecordedSample(actual, sample).state; }, () => undefined);
  await settle();
  fake.state.samples = samples;
  const pending = deferred<SampleBatch>();
  fake.state.sampleScript.push(() => pending.promise);
  source.resync();
  fake.emit('locationSample', samples[200]);
  expect(actual.nativeSampleSeq).toBe(20); // no checkpoint jumps over the backlog
  pending.resolve({ samples: samples.slice(20), lastSequence: 201, hasMore: false });
  await settle();
  expect(actual.totalDistanceM).toBeCloseTo(reference.totalDistanceM, 1);
});


it('recovers a live sequence gap before visibilitychange can request a drain', async () => {
  fake.state.samples = range(1, 20).map((seq) => nativeSample(seq));
  const source = createNativeRunSource('run-a', true);
  const { delivered } = startSource(source);
  await settle();
  fake.state.samples = range(1, 100).map((seq) => nativeSample(seq));
  fake.emit('locationSample', nativeSample(100));
  expect(delivered.map(seqOf)).toEqual(range(1, 20));
  await settle();
  expect(delivered.map(seqOf)).toEqual(range(1, 100));
});

it('does not mutate a detached run when an in-flight recovery finally settles', async () => {
  fake.state.samples = range(1, 20).map((seq) => nativeSample(seq));
  const source = createNativeRunSource('run-a', true);
  const { delivered } = startSource(source);
  await settle();
  const pending = deferred<SampleBatch>();
  fake.state.sampleScript.push(() => pending.promise);
  source.resync();
  fake.emit('locationSample', nativeSample(100));
  source.detach();
  pending.resolve({ samples: range(21, 100).map((seq) => nativeSample(seq)), lastSequence: 100, hasMore: false });
  await settle();
  expect(delivered.map(seqOf)).toEqual(range(1, 20));
});

it('holds live events after a failed recovery and retries them in order', async () => {
  fake.state.samples = range(1, 20).map((seq) => nativeSample(seq));
  const source = createNativeRunSource('run-a', true);
  const { delivered } = startSource(source);
  await settle();
  fake.state.samples = range(1, 100).map((seq) => nativeSample(seq));
  fake.state.sampleScript.push(() => Promise.reject(new Error('disk read temporarily unavailable')));
  fake.emit('locationSample', nativeSample(100));
  await settle();
  expect(delivered.map(seqOf)).toEqual(range(1, 20));
  source.resync();
  await settle();
  expect(delivered.map(seqOf)).toEqual(range(1, 100));
});

it('recovers controls and samples in time order even when newer live events arrive first', async () => {
  const source = createNativeRunSource('run-a', true);
  const { order } = startSource(source);
  await settle();
  const pending = deferred<SampleBatch>();
  fake.state.sampleScript.push(() => pending.promise);
  fake.state.controls = [nativeControl(1, T0 + 2_500)];
  source.resync();
  fake.emit('locationSample', nativeSample(5));
  fake.emit('runControl', nativeControl(2, T0 + 4_500));
  pending.resolve({ samples: range(1, 4).map((seq) => nativeSample(seq)), lastSequence: 4, hasMore: false });
  await settle();
  expect(order).toEqual(['s1', 's2', 'c1', 's3', 's4', 'c2', 's5']);
});
