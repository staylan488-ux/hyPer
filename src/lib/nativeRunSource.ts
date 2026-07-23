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
    motionDetected: sample.motion === 'unknown' ? undefined : sample.motion === 'moving',
  };
}

export function createNativeRunSource(runId: string, resume: boolean): NativePositionSource {
  let stopped = false;
  let recoveryCursor = 0;
  let controlCursor = 0;
  let sampleHandler: ((sample: GpsSample) => void) | null = null;
  let controlHandler: ((control: NativeRunControl) => void) | null = null;
  const deliveredSequences = new Set<number>();
  const deliveredControls = new Set<number>();
  const listenerHandles: Array<{ remove: () => Promise<void> }> = [];

  const cleanupListeners = async () => {
    const handles = listenerHandles.splice(0, listenerHandles.length);
    await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
  };

  // Pull every persisted sample past the cursor. Called on start, after each
  // listener attach, and on visibility-resume; dedup keeps it idempotent.
  const drain = async () => {
    const pendingEvents: Array<
      | { kind: 'sample'; timestampMs: number; sample: NativeRunSample }
      | { kind: 'control'; timestampMs: number; control: NativeRunControl }
    > = [];
    while (true) {
      const [sampleBatch, controlBatch] = await Promise.all([
        NativeRun.drainSamples({ afterSequence: recoveryCursor }),
        NativeRun.drainControls({ afterSequence: controlCursor }),
      ]);
      pendingEvents.push(
        ...sampleBatch.samples.map((sample) => ({ kind: 'sample' as const, timestampMs: sample.timestampMs, sample })),
        ...controlBatch.controls.map((control) => ({ kind: 'control' as const, timestampMs: control.timestampMs, control })),
      );
      recoveryCursor = Math.max(recoveryCursor, sampleBatch.lastSequence);
      controlCursor = Math.max(controlCursor, controlBatch.lastSequence);
      if (!sampleBatch.hasMore && !controlBatch.hasMore) break;
    }

    pendingEvents.sort((a, b) => a.timestampMs - b.timestampMs);
    for (const event of pendingEvents) {
      if (event.kind === 'sample' && !deliveredSequences.has(event.sample.sequence)) {
        deliveredSequences.add(event.sample.sequence);
        sampleHandler?.(toGpsSample(event.sample));
      } else if (event.kind === 'control' && !deliveredControls.has(event.control.sequence)) {
        deliveredControls.add(event.control.sequence);
        controlHandler?.(event.control);
      }
    }
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

          await NativeRun.startRecording({ runId, resume });

          // Recover anything recorded while the WebView was suspended before
          // subscribing, then drain once more to close the subscription race.
          await drain();
          if (stopped) return;

          listenerHandles.push(await NativeRun.addListener('locationSample', (sample) => {
            if (stopped || deliveredSequences.has(sample.sequence)) return;
            deliveredSequences.add(sample.sequence);
            sampleHandler?.(toGpsSample(sample));
          }));
          listenerHandles.push(await NativeRun.addListener('locationError', (event) => {
            if (!stopped) onError(event.message);
          }));
          listenerHandles.push(await NativeRun.addListener('runControl', (control) => {
            if (stopped || deliveredControls.has(control.sequence)) return;
            deliveredControls.add(control.sequence);
            controlHandler?.(control);
          }));
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
      stopped = true;
      void cleanupListeners();
      void NativeRun.stopRecording({ discard }).catch(() => undefined);
    },
  };
}
