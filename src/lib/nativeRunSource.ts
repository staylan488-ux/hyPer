import { NativeRun, type NativeRunControl, type NativeRunSample } from '@/lib/nativeBridge';
import type { GpsSample } from '@/lib/runTracker';

interface NativePositionSource {
  getNowMs: () => number;
  start: (
    onSample: (sample: GpsSample) => void,
    onError: (message: string) => void,
    onControl?: (control: NativeRunControl) => void,
  ) => void;
  stop: (discard?: boolean) => void;
  resync: () => void;
  detach: () => void;
}

function toGpsSample(sample: NativeRunSample): GpsSample {
  return {
    t: sample.timestampMs,
    lat: sample.latitude,
    lon: sample.longitude,
    accuracyM: sample.horizontalAccuracyM,
    speedMps: sample.speedMps,
    speedAccuracyMps: sample.speedAccuracyMps,
    motionDetected: sample.motion === 'unknown' ? undefined : sample.motion === 'moving',
    nativeSeq: sample.sequence,
  };
}

export interface NativeRunCursors {
  sample: number;
  control: number;
}

// `cursors` are the last sample/control sequences the resumed state already
// applied. `onNativeReset` fires with the cursors the source continues from
// when the recorder's sequence is behind them: a fresh file (both back to 0),
// or the same file with a sample sequence that fell back after a failed write
// (sample cursor only; controls are numbered separately and kept).
export function createNativeRunSource(
  runId: string,
  resume: boolean,
  cursors?: NativeRunCursors,
  onNativeReset?: (cursors: NativeRunCursors) => void,
  recoverLegacyControls?: (controls: NativeRunControl[]) => number,
): NativePositionSource {
  let stopped = false;
  let recoveryCursor = Math.max(0, cursors?.sample ?? 0);
  let controlCursor = Math.max(0, cursors?.control ?? 0);
  let sampleHandler: ((sample: GpsSample) => void) | null = null;
  let controlHandler: ((control: NativeRunControl) => void) | null = null;
  const deliveredSequences = new Set<number>();
  const deliveredControls = new Set<number>();
  const listenerHandles: Array<{ remove: () => Promise<void> }> = [];

  type PendingEvent =
    | { kind: 'sample'; timestampMs: number; sample: NativeRunSample }
    | { kind: 'control'; timestampMs: number; control: NativeRunControl };
  const buffered: PendingEvent[] = [];
  let drainPromise: Promise<void> | null = null;
  let drainAgain = false;
  let attaching = true;
  let stopDiscard: boolean | undefined;
  let recoveredLegacyControls = false;

  const cleanupListeners = async () => {
    const handles = listenerHandles.splice(0, listenerHandles.length);
    await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
  };

  const deliver = (event: PendingEvent) => {
    if (stopped) return;
    if (event.kind === 'sample') {
      if (deliveredSequences.has(event.sample.sequence)) return;
      deliveredSequences.add(event.sample.sequence);
      sampleHandler?.(toGpsSample(event.sample));
    } else {
      if (deliveredControls.has(event.control.sequence)) return;
      deliveredControls.add(event.control.sequence);
      controlHandler?.(event.control);
    }
  };

  // One recovery at a time. Live events join the recovery buffer instead of
  // advancing the engine past the older durable route. Cursors move only once
  // the complete, chronologically merged batch has actually been applied.
  const drain = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (drainPromise) {
      drainAgain = true;
      return drainPromise;
    }
    drainPromise = (async () => {
      const pending: PendingEvent[] = [];
      let sampleCursor = recoveryCursor;
      let nextControlCursor = controlCursor;
      try {
        do {
          drainAgain = false;
          while (!stopped) {
            const previousSampleCursor = sampleCursor;
            const previousControlCursor = nextControlCursor;
            const [sampleBatch, controlBatch] = await Promise.all([
              NativeRun.drainSamples({ afterSequence: sampleCursor }),
              NativeRun.drainControls({ afterSequence: nextControlCursor }),
            ]);
            if (stopped) return;
            pending.push(
              ...sampleBatch.samples.map((sample) => ({ kind: 'sample' as const, timestampMs: sample.timestampMs, sample })),
              ...controlBatch.controls.map((control) => ({ kind: 'control' as const, timestampMs: control.timestampMs, control })),
            );
            sampleCursor = Math.max(sampleCursor, sampleBatch.lastSequence);
            nextControlCursor = Math.max(nextControlCursor, controlBatch.lastSequence);
            // A live event can arrive after the native read took its snapshot.
            // Read once more if it reveals an unscanned gap, including missing
            // controls. Failed appends cannot keep this loop spinning.
            const liveGap = buffered.some((event) => event.kind === 'sample'
              ? event.sample.sequence > sampleCursor + 1
              : event.control.sequence > nextControlCursor + 1);
            if (!sampleBatch.hasMore && !controlBatch.hasMore && !liveGap) break;
            if (sampleCursor === previousSampleCursor && nextControlCursor === previousControlCursor) break;
          }
        } while (drainAgain && !stopped);
        if (stopped) return;
        pending.push(...buffered.splice(0));
        pending.sort((a, b) => a.timestampMs - b.timestampMs);
        if (!recoveredLegacyControls && recoverLegacyControls) {
          controlCursor = Math.max(controlCursor, recoverLegacyControls(
            pending.flatMap((event) => event.kind === 'control' ? [event.control] : []),
          ));
          recoveredLegacyControls = true;
        }
        for (const event of pending) {
          if (event.kind === 'control' && event.control.sequence <= controlCursor) continue;
          deliver(event);
        }
        if (stopped) return;
        recoveryCursor = sampleCursor;
        controlCursor = Math.max(controlCursor, nextControlCursor);
        // Include live events just beyond the durable read, but never cross an
        // unexamined sequence gap just because a newer live event arrived.
        while (deliveredSequences.has(recoveryCursor + 1)) recoveryCursor += 1;
        while (deliveredControls.has(controlCursor + 1)) controlCursor += 1;
      } catch (error) {
        // Do not lose earlier pages when a later read fails. The unchanged
        // applied cursors also ensure a fresh source can recover the same data.
        buffered.push(...pending);
        throw error;
      }
    })().finally(() => { drainPromise = null; });
    return drainPromise;
  };

  const receive = (event: PendingEvent) => {
    if (stopped) return;
    const isSample = event.kind === 'sample';
    const sequence = isSample ? event.sample.sequence : event.control.sequence;
    const cursor = isSample ? recoveryCursor : controlCursor;
    if (sequence <= cursor) return;
    if (attaching || drainPromise || buffered.length > 0 || !isSample || sequence !== cursor + 1) {
      buffered.push(event);
      if (!attaching && !drainPromise) void drain().catch(() => undefined);
      return;
    }
    deliver(event);
    recoveryCursor = sequence;
  };

  return {
    getNowMs: () => Date.now(),
    start: (onSample, onError, onControl) => {
      sampleHandler = onSample;
      controlHandler = onControl ?? null;
      void (async () => {
        try {
          const permission = await NativeRun.requestPermissions();
          if (permission.location === 'denied' || permission.location === 'restricted') {
            throw new Error('Location permission denied. Allow Precise Location to track runs.');
          }

          if (stopped) return;
          const recording = await NativeRun.startRecording({ runId, resume });
          if (stopped) {
            if (stopDiscard !== undefined) await NativeRun.stopRecording({ discard: stopDiscard });
            return;
          }
          if (recording.lastSequence < recoveryCursor) {
            if (recording.lastSequence === 0) {
              // The native store was reset (new file, sequences from 1).
              // Keeping the saved cursors would silently drop every new sample.
              recoveryCursor = 0;
              controlCursor = 0;
            } else {
              // Same file, but its saved sequence is behind samples JS already
              // applied live (a write failed or the app died before saving
              // it). New samples reuse those numbers, so follow the recorder;
              // the caller filters the repeats by time. Controls keep their
              // own sequence, so replaying them would repeat splits and rests.
              recoveryCursor = recording.lastSequence;
            }
            if (!stopped) onNativeReset?.({ sample: recoveryCursor, control: controlCursor });
          }

          // Recover anything recorded while the WebView was suspended before
          // subscribing, then drain once more to close the subscription race.
          await drain();
          if (stopped) return;

          const addListener = async (promise: Promise<{ remove: () => Promise<void> }>) => {
            const handle = await promise;
            if (stopped) await handle.remove();
            else listenerHandles.push(handle);
          };
          await addListener(NativeRun.addListener('locationSample', (sample) => {
            receive({ kind: 'sample', timestampMs: sample.timestampMs, sample });
          }));
          await addListener(NativeRun.addListener('locationError', (event) => {
            if (!stopped) onError(event.message);
          }));
          await addListener(NativeRun.addListener('runControl', (control) => {
            receive({ kind: 'control', timestampMs: control.timestampMs, control });
          }));
          attaching = false;
          await drain();
        } catch (error) {
          if (!stopped) {
            onError(error instanceof Error ? error.message : 'Native GPS tracking failed.');
          }
        }
      })();
    },
    resync: () => {
      // WebView resumed (e.g. screen unlocked) — pull samples the recorder
      // persisted while JS was suspended, which live listeners never received.
      if (stopped) return;
      void drain().catch(() => undefined);
    },
    detach: () => {
      // Release JS listeners but leave native recording running, so a tab
      // switch mid-run keeps recording in the background. A fresh source on
      // resume re-drains the durable file. Recording is only truly stopped on
      // finish/discard (stop).
      stopped = true;
      void cleanupListeners();
    },
    stop: (discard = false) => {
      stopDiscard = discard;
      stopped = true;
      void cleanupListeners();
      void NativeRun.stopRecording({ discard }).catch(() => undefined);
    },
  };
}
