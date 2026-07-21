import { NativeRun, type NativeRunSample } from '@/lib/nativeBridge';
import type { GpsSample } from '@/lib/runTracker';

interface NativePositionSource {
  getNowMs: () => number;
  start: (onSample: (sample: GpsSample) => void, onError: (message: string) => void) => void;
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
  let sampleHandler: ((sample: GpsSample) => void) | null = null;
  const deliveredSequences = new Set<number>();
  const listenerHandles: Array<{ remove: () => Promise<void> }> = [];

  const cleanupListeners = async () => {
    const handles = listenerHandles.splice(0, listenerHandles.length);
    await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
  };

  // Pull every persisted sample past the cursor. Called on start, after each
  // listener attach, and on visibility-resume; dedup keeps it idempotent.
  const drain = async () => {
    while (true) {
      const batch = await NativeRun.drainSamples({ afterSequence: recoveryCursor });
      for (const sample of batch.samples) {
        if (!deliveredSequences.has(sample.sequence)) {
          deliveredSequences.add(sample.sequence);
          sampleHandler?.(toGpsSample(sample));
        }
      }
      recoveryCursor = Math.max(recoveryCursor, batch.lastSequence);
      if (!batch.hasMore) break;
    }
  };

  return {
    getNowMs: () => Date.now(),
    start: (onSample, onError) => {
      sampleHandler = onSample;
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
