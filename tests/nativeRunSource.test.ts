import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeRunControl, NativeRunSample } from '@/lib/nativeBridge';
import { createNativeRunSource } from '@/lib/nativeRunSource';
import {
  advanceTracker,
  createTracker,
  defaultTrackerConfig,
  type GpsSample,
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
        hasMore: page.length < pending.length,
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
