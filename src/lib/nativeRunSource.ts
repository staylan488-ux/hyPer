import { NativeRun, type NativeRunSample } from '@/lib/nativeBridge';
import type { GpsSample } from '@/lib/runTracker';

interface NativePositionSource {
  getNowMs: () => number;
  start: (onSample: (sample: GpsSample) => void, onError: (message: string) => void) => void;
  stop: (discard?: boolean) => void;
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
  const deliveredSequences = new Set<number>();
  const listenerHandles: Array<{ remove: () => Promise<void> }> = [];

  const cleanupListeners = async () => {
    const handles = listenerHandles.splice(0, listenerHandles.length);
    await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
  };

  return {
    getNowMs: () => Date.now(),
    start: (onSample, onError) => {
      void (async () => {
        try {
          const permission = await NativeRun.requestPermissions();
          if (permission.location === 'denied' || permission.location === 'restricted') {
            throw new Error('Location permission denied. Allow Precise Location to track runs.');
          }

          await NativeRun.startRecording({ runId, resume });

          const drain = async () => {
            while (true) {
              const batch = await NativeRun.drainSamples({ afterSequence: recoveryCursor });
              for (const sample of batch.samples) {
                if (!deliveredSequences.has(sample.sequence)) {
                  deliveredSequences.add(sample.sequence);
                  onSample(toGpsSample(sample));
                }
              }
              recoveryCursor = Math.max(recoveryCursor, batch.lastSequence);
              if (!batch.hasMore) break;
            }
          };

          // Recover anything recorded while the WebView was suspended before
          // subscribing, then drain once more to close the subscription race.
          await drain();
          if (stopped) return;

          listenerHandles.push(await NativeRun.addListener('locationSample', (sample) => {
            if (stopped || deliveredSequences.has(sample.sequence)) return;
            deliveredSequences.add(sample.sequence);
            onSample(toGpsSample(sample));
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
    stop: (discard = false) => {
      stopped = true;
      void cleanupListeners();
      void NativeRun.stopRecording({ discard }).catch(() => undefined);
    },
  };
}
