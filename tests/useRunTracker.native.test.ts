import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeRunControl } from '@/lib/nativeBridge';
import type { NativeRunCursors } from '@/lib/nativeRunSource';
import { RUN_TRACKER_STORAGE_KEY, restoreTracker, type GpsSample } from '@/lib/runTracker';
import { useRunTracker } from '@/hooks/useRunTracker';

// Drive the hook's native wiring (tab switch -> resume -> reset callback)
// without a DOM. Slots keep hook identities across explicit rerenders, as in
// barcodeScanner.test.ts.
const hooks = vi.hoisted(() => {
  type Effect = { deps?: readonly unknown[]; setup: () => void | (() => void); cleanup?: () => void };
  const state = { slots: [] as unknown[], cursor: 0, pending: [] as Effect[], effects: [] as Effect[] };
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    state,
    reset() { state.slots = []; state.cursor = 0; state.pending = []; state.effects = []; },
    commit() { for (const effect of state.pending.splice(0)) { effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; } },
    unmount() { for (const effect of state.effects) { effect.cleanup?.(); effect.cleanup = undefined; } },
    useRef(value: unknown) { const index = state.cursor++; return state.slots[index] ??= { current: value }; },
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === 'function' ? value(state.slots[index]) : value; }];
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as { deps: readonly unknown[]; callback: unknown } | undefined;
      if (previous && same(previous.deps, deps)) return previous.callback;
      state.slots[index] = { deps, callback };
      return callback;
    },
    useEffect(setup: Effect['setup'], deps?: readonly unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as Effect | undefined;
      if (previous && same(previous.deps, deps)) { previous.setup = setup; return; }
      const effect = previous ?? { setup };
      effect.setup = setup;
      effect.deps = deps;
      state.slots[index] = effect;
      if (!previous) state.effects.push(effect);
      state.pending.push(effect);
    },
  };
});

type SourceCall = [string, boolean, NativeRunCursors | undefined, ((cursors: NativeRunCursors) => void) | undefined];

const native = vi.hoisted(() => {
  const sources: Array<{
    args: unknown[];
    onSample?: (sample: GpsSample) => void;
    onControl?: (control: NativeRunControl) => void;
    stop: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
  }> = [];
  const createNativeRunSource = vi.fn((...args: unknown[]) => {
    const entry: (typeof sources)[number] = { args, stop: vi.fn(), detach: vi.fn() };
    sources.push(entry);
    return {
      getNowMs: () => Date.now(),
      start: (
        onSample: (sample: GpsSample) => void,
        _onError: (message: string) => void,
        onControl?: (control: NativeRunControl) => void,
      ) => {
        entry.onSample = onSample;
        entry.onControl = onControl;
      },
      stop: entry.stop,
      resync: vi.fn(),
      detach: entry.detach,
    };
  });
  return {
    sources,
    createNativeRunSource,
    isNativeIOS: vi.fn(() => true),
    NativeRun: { stopRecording: vi.fn(async () => undefined) },
  };
});

vi.mock('react', () => ({
  useRef: hooks.useRef, useState: hooks.useState, useCallback: hooks.useCallback, useEffect: hooks.useEffect,
}));
vi.mock('@/lib/nativeBridge', () => ({ isNativeIOS: native.isNativeIOS, NativeRun: native.NativeRun }));
vi.mock('@/lib/nativeRunSource', () => ({ createNativeRunSource: native.createNativeRunSource }));
vi.mock('@/lib/keepAwake', () => ({ useKeepAwakeWhile: () => undefined }));
vi.mock('@/lib/runTrackerCues', () => ({
  playLapCue: vi.fn(), playSprintEndCue: vi.fn(), playSprintStartCue: vi.fn(),
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const T0 = Date.now();

function sample(seq: number, t = T0 + seq * 1_000): GpsSample {
  return { t, lat: 37.8712 + seq * 0.00003, lon: -122.2601, accuracyM: 5, speedMps: 3, motionDetected: true, nativeSeq: seq };
}

function mount() {
  hooks.reset();
  const render = () => {
    hooks.state.cursor = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- renders the hook against the mocked React above
    return useRunTracker();
  };
  const first = render();
  hooks.commit();
  return { first, render };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  native.sources.length = 0;
  native.isNativeIOS.mockReturnValue(true);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { setInterval: () => 0, clearInterval: () => undefined });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

afterEach(() => {
  hooks.unmount();
  vi.unstubAllGlobals();
});

describe('useRunTracker native resume wiring', () => {
  it('resumes after a tab switch from the cursors of the snapshot flushed on unmount', () => {
    const run = mount();
    run.first.start('free', null);
    const live = native.sources[0];
    for (let seq = 1; seq <= 12; seq++) live.onSample!(sample(seq));
    live.onControl!({ sequence: 1, timestampMs: T0 + 12_500, action: 'split' });
    for (let seq = 13; seq <= 14; seq++) live.onSample!(sample(seq));
    const applied = run.render().state!;
    expect(applied.totalDistanceM).toBeGreaterThan(0);

    // tab switch: listeners detach, native keeps recording
    hooks.unmount();
    expect(live.detach).toHaveBeenCalledTimes(1);
    expect(live.stop).not.toHaveBeenCalled();
    const flushed = restoreTracker(storage.getItem(RUN_TRACKER_STORAGE_KEY), Date.now())!;
    expect(flushed.nativeSampleSeq).toBe(14);
    expect(flushed.nativeControlSeq).toBe(1);
    expect(flushed.totalDistanceM).toBe(applied.totalDistanceM);

    const back = mount();
    expect(back.first.resumable).toBe(true);
    back.first.resume();
    const [runId, resume, cursors, onNativeReset] = native.sources[1].args as SourceCall;
    expect(runId).toBe(applied.runId);
    expect(resume).toBe(true);
    expect(cursors).toEqual({ sample: flushed.nativeSampleSeq, control: flushed.nativeControlSeq });
    expect(onNativeReset).toBeTypeOf('function');

    // cursors carry the resume, so no time cutoff: new samples count (the
    // first re-anchors after the restore gap)
    native.sources[1].onSample!(sample(15));
    native.sources[1].onSample!(sample(16));
    const resumed = back.render().state!;
    expect(resumed.nativeSampleSeq).toBe(16);
    expect(resumed.totalDistanceM).toBeGreaterThan(applied.totalDistanceM);
  });

  it('commits the reset cursors and filters repeated sequences by time', () => {
    const run = mount();
    run.first.start('free', null);
    const live = native.sources[0];
    for (let seq = 1; seq <= 12; seq++) live.onSample!(sample(seq));
    live.onControl!({ sequence: 2, timestampMs: T0 + 12_500, action: 'split' });
    hooks.unmount();
    const flushed = restoreTracker(storage.getItem(RUN_TRACKER_STORAGE_KEY), Date.now())!;

    const back = mount();
    back.first.resume();
    const [, , , onNativeReset] = native.sources[1].args as SourceCall;

    // same file whose sample sequence fell back to 8; controls keep theirs
    onNativeReset!({ sample: 8, control: 2 });
    let state = back.render().state!;
    expect(state.nativeSampleSeq).toBe(8);
    expect(state.nativeControlSeq).toBe(2);

    // 9 and 10 repeat already-applied times; they move the cursor, not the
    // distance
    native.sources[1].onSample!(sample(9, T0 + 10_000));
    native.sources[1].onSample!(sample(10, T0 + 11_000));
    state = back.render().state!;
    expect(state.nativeSampleSeq).toBe(10);
    expect(state.totalDistanceM).toBe(flushed.totalDistanceM);

    // a fresh file resolves with 0 and clears both cursors
    onNativeReset!({ sample: 0, control: 0 });
    state = back.render().state!;
    expect(state.nativeSampleSeq).toBe(0);
    expect(state.nativeControlSeq).toBe(0);
  });

  it('replays an older snapshot without cursors from the start behind a time cutoff', () => {
    const run = mount();
    run.first.start('free', null);
    for (let seq = 1; seq <= 12; seq++) native.sources[0].onSample!(sample(seq));
    hooks.unmount();
    const raw = JSON.parse(storage.getItem(RUN_TRACKER_STORAGE_KEY)!);
    delete raw.state.nativeSampleSeq;
    delete raw.state.nativeControlSeq;
    storage.setItem(RUN_TRACKER_STORAGE_KEY, JSON.stringify(raw));
    const distance = raw.state.totalDistanceM;

    const back = mount();
    back.first.resume();
    expect((native.sources[1].args as SourceCall)[2]).toEqual({ sample: 0, control: 0 });
    for (let seq = 1; seq <= 12; seq++) native.sources[1].onSample!(sample(seq));
    let state = back.render().state!;
    expect(state.totalDistanceM).toBe(distance);
    expect(state.nativeSampleSeq).toBe(12);
    for (let seq = 13; seq <= 14; seq++) native.sources[1].onSample!(sample(seq));
    state = back.render().state!;
    expect(state.totalDistanceM).toBeGreaterThan(distance);
  });
});
