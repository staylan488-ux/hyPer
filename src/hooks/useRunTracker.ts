// React wiring for the run tracker engine: position source lifecycle, 1s UI
// tick, wake lock (RestTimerPill pattern), throttled crash-recovery snapshots,
// and audio cues on engine events. The `PositionSource` port is injectable so
// /preview replays scripted scenarios through identical code — including a
// simulated clock, so a 10× replay still reads as real pace and elapsed time.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RUN_TRACKER_STORAGE_KEY,
  RUN_TRACKER_TRACE_STORAGE_KEY,
  advanceTracker,
  createTracker,
  defaultTrackerConfig,
  finishTracker,
  isAutoPaused,
  isPaused,
  manualSplit,
  pauseTracker,
  restoreTracker,
  restoreFinishedRun,
  restoreTrackerTrace,
  resumeTracker,
  serializeFinishedRun,
  serializeTracker,
  serializeTrackerTrace,
  type FinishedRun,
  type GpsSample,
  type GpsTracePoint,
  type RunMode,
  type TrackerEvent,
  type TrackerState,
} from '@/lib/runTracker';
import { playLapCue, playSprintEndCue, playSprintStartCue } from '@/lib/runTrackerCues';
import { createDeviceMotionDetector } from '@/lib/deviceMotion';
import { isNativeIOS } from '@/lib/nativeBridge';
import { createNativeRunSource } from '@/lib/nativeRunSource';
import { useKeepAwakeWhile } from '@/lib/keepAwake';

export interface PositionSource {
  // simulated sources compress delivery but report a consistent clock
  getNowMs: () => number;
  start: (onSample: (sample: GpsSample) => void, onError: (message: string) => void) => void;
  stop: (discard?: boolean) => void;
  // Native only: re-deliver samples the recorder persisted while the WebView
  // was suspended (locked screen); dedup makes it idempotent.
  resync?: () => void;
  // Native only: release JS listeners but keep native recording alive (tab
  // switch mid-run), so background samples are preserved for a later resume.
  detach?: () => void;
}

export function createGeolocationSource(): PositionSource {
  let watchId: number | null = null;
  let stopped = false;
  let motionListener: ((event: DeviceMotionEvent) => void) | null = null;
  const motionDetector = createDeviceMotionDetector();

  const attachMotionListener = () => {
    if (stopped || motionListener != null) return;
    motionListener = (event) => {
      motionDetector.add(Date.now(), event.acceleration, event.accelerationIncludingGravity);
    };
    window.addEventListener('devicemotion', motionListener);
  };

  const startMotionAssist = () => {
    if (!('DeviceMotionEvent' in window)) return;
    const constructor = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    try {
      const permission = constructor.requestPermission?.();
      if (permission) {
        void permission.then((result) => {
          if (result === 'granted') attachMotionListener();
        }).catch(() => undefined);
      } else {
        attachMotionListener();
      }
    } catch {
      // Motion assist is optional. GPS tracking continues if unavailable or denied.
    }
  };

  return {
    getNowMs: () => Date.now(),
    start: (onSample, onError) => {
      stopped = false;
      if (!('geolocation' in navigator)) {
        onError('GPS is not available on this device.');
        return;
      }
      startMotionAssist();
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          onSample({
            t: position.timestamp,
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracyM: position.coords.accuracy,
            speedMps: position.coords.speed,
            motionDetected: motionDetector.hasSignal()
              ? motionDetector.isMoving(Date.now())
              : undefined,
          });
        },
        (error) => {
          onError(
            error.code === error.PERMISSION_DENIED
              ? 'Location permission denied. Allow location access to track runs.'
              : 'GPS signal lost.',
          );
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    },
    stop: () => {
      stopped = true;
      if (watchId != null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (motionListener != null) {
        window.removeEventListener('devicemotion', motionListener);
        motionListener = null;
      }
      motionDetector.reset();
    },
  };
}

function createDefaultPositionSource(runId: string, resume: boolean): PositionSource {
  return isNativeIOS()
    ? createNativeRunSource(runId, resume)
    : createGeolocationSource();
}

// replays relative-time samples at `timeScale`× while getNowMs advances at the
// same compressed rate from the real start moment
export function createSimulatedSource(samples: GpsSample[], timeScale = 10): PositionSource {
  let interval: number | null = null;
  // bases must be valid from creation: the tracker reads getNowMs() for its
  // start timestamp BEFORE the replay starts
  let baseRealMs = Date.now();
  let baseSimMs = Date.now();

  const getNowMs = () => baseSimMs + (Date.now() - baseRealMs) * timeScale;

  return {
    getNowMs,
    start: (onSample) => {
      baseRealMs = Date.now();
      baseSimMs = baseRealMs;
      let cursor = 0;
      interval = window.setInterval(() => {
        const simNow = getNowMs();
        while (cursor < samples.length && baseSimMs + samples[cursor].t <= simNow) {
          const sample = samples[cursor];
          onSample({ ...sample, t: baseSimMs + sample.t });
          cursor += 1;
        }
        if (cursor >= samples.length && interval != null) {
          window.clearInterval(interval);
          interval = null;
        }
      }, 100);
    },
    stop: () => {
      if (interval != null) {
        window.clearInterval(interval);
        interval = null;
      }
    },
  };
}

const SNAPSHOT_THROTTLE_MS = 5000;
const TRACE_SNAPSHOT_THROTTLE_MS = 30_000;
const MAX_IN_MEMORY_TRACE_POINTS = 18_000;

export interface UseRunTracker {
  state: TrackerState | null;
  finishedRun: FinishedRun | null;
  nowMs: number;
  gpsError: string | null;
  resumable: boolean;
  paused: boolean;
  autoPaused: boolean;
  start: (mode: RunMode, autoLapM: number | null, autoPause: boolean, source?: PositionSource) => void;
  resume: (source?: PositionSource) => void;
  split: () => void;
  togglePause: () => void;
  finish: () => FinishedRun | null;
  discard: () => void;
}

export function useRunTracker(): UseRunTracker {
  const [state, setState] = useState<TrackerState | null>(null);
  const [finishedRun, setFinishedRun] = useState<FinishedRun | null>(() => {
    try {
      return restoreFinishedRun(localStorage.getItem(RUN_TRACKER_STORAGE_KEY), Date.now());
    } catch {
      return null;
    }
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [resumable, setResumable] = useState(() => {
    try {
      return restoreTracker(localStorage.getItem(RUN_TRACKER_STORAGE_KEY), Date.now()) != null;
    } catch {
      return false;
    }
  });
  const [initialTrace] = useState<GpsTracePoint[]>(() => {
    try {
      const restoredState = restoreTracker(localStorage.getItem(RUN_TRACKER_STORAGE_KEY), Date.now());
      return restoredState
        ? restoreTrackerTrace(localStorage.getItem(RUN_TRACKER_TRACE_STORAGE_KEY), restoredState.runId)
        : [];
    } catch {
      return [];
    }
  });

  const stateRef = useRef<TrackerState | null>(null);
  const sourceRef = useRef<PositionSource | null>(null);
  const lastSnapshotRef = useRef(0);
  const traceRef = useRef<GpsTracePoint[]>(initialTrace);
  const lastTraceSnapshotRef = useRef(0);

  const applyEvents = useCallback((events: TrackerEvent[]) => {
    for (const event of events) {
      if (event.type === 'lap_completed') playLapCue();
      else if (event.type === 'sprint_started') playSprintStartCue();
      else if (event.type === 'sprint_completed') playSprintEndCue();
    }
  }, []);

  const commit = useCallback((next: TrackerState, sampleT?: number) => {
    stateRef.current = next;
    setState(next);

    const t = sampleT ?? sourceRef.current?.getNowMs() ?? Date.now();
    if (t - lastSnapshotRef.current >= SNAPSHOT_THROTTLE_MS) {
      lastSnapshotRef.current = t;
      try {
        localStorage.setItem(RUN_TRACKER_STORAGE_KEY, serializeTracker(next, t));
      } catch {
        // storage full/blocked — tracking continues without state recovery
      }
      if (t - lastTraceSnapshotRef.current >= TRACE_SNAPSHOT_THROTTLE_MS) {
        try {
          localStorage.setItem(
            RUN_TRACKER_TRACE_STORAGE_KEY,
            serializeTrackerTrace(next.runId, t, traceRef.current),
          );
        } catch {
          // Diagnostics are optional; never let quota pressure affect tracking.
        } finally {
          lastTraceSnapshotRef.current = t;
        }
      }
    }
  }, []);

  const attachSource = useCallback(
    (source: PositionSource) => {
      sourceRef.current = source;
      setGpsError(null);
      source.start(
        (sample) => {
          const current = stateRef.current;
          if (!current || current.status !== 'running') return;
          const { state: next, events, observation } = advanceTracker(current, sample);
          if (observation) {
            traceRef.current.push(observation);
            if (traceRef.current.length > MAX_IN_MEMORY_TRACE_POINTS) {
              traceRef.current = traceRef.current.slice(-MAX_IN_MEMORY_TRACE_POINTS);
            }
          }
          commit(next, sample.t);
          applyEvents(events);
        },
        (message) => setGpsError(message),
      );
    },
    [applyEvents, commit],
  );

  const start = useCallback(
    (mode: RunMode, autoLapM: number | null, autoPause: boolean, source?: PositionSource) => {
      const now = source?.getNowMs() ?? Date.now();
      const tracker = createTracker(defaultTrackerConfig(mode, autoLapM, autoPause), now);
      const activeSource = source ?? createDefaultPositionSource(tracker.runId, false);
      setFinishedRun(null);
      traceRef.current = [];
      stateRef.current = tracker;
      setState(tracker);
      setResumable(false);
      lastSnapshotRef.current = now;
      lastTraceSnapshotRef.current = now;
      try {
        localStorage.setItem(RUN_TRACKER_STORAGE_KEY, serializeTracker(tracker, now));
        localStorage.removeItem(RUN_TRACKER_TRACE_STORAGE_KEY);
      } catch {
        // storage full/blocked — tracking continues without recovery
      }
      attachSource(activeSource);
    },
    [attachSource],
  );

  const resume = useCallback(
    (source?: PositionSource) => {
      const restored = restoreTracker(localStorage.getItem(RUN_TRACKER_STORAGE_KEY), Date.now());
      if (!restored) {
        setResumable(false);
        return;
      }
      traceRef.current = restoreTrackerTrace(
        localStorage.getItem(RUN_TRACKER_TRACE_STORAGE_KEY),
        restored.runId,
      );
      stateRef.current = restored;
      setState(restored);
      setResumable(false);
      attachSource(source ?? createDefaultPositionSource(restored.runId, true));
    },
    [attachSource],
  );

  const split = useCallback(() => {
    const current = stateRef.current;
    const source = sourceRef.current;
    if (!current || !source) return;
    const { state: next, events } = manualSplit(current, source.getNowMs());
    commit(next);
    applyEvents(events);
  }, [applyEvents, commit]);

  const togglePause = useCallback(() => {
    const current = stateRef.current;
    const source = sourceRef.current;
    if (!current || current.status !== 'running') return;
    const t = source?.getNowMs() ?? Date.now();
    commit(isPaused(current) ? resumeTracker(current, t) : pauseTracker(current, t));
  }, [commit]);

  const stopSource = useCallback((discard = false) => {
    sourceRef.current?.stop(discard);
    sourceRef.current = null;
  }, []);

  const finish = useCallback((): FinishedRun | null => {
    const current = stateRef.current;
    const source = sourceRef.current;
    if (!current) return null;

    const run = finishTracker(current, source?.getNowMs() ?? Date.now(), [...traceRef.current]);
    stopSource(false);
    const finished: TrackerState = { ...current, status: 'finished' };
    stateRef.current = finished;
    setState(finished);
    setFinishedRun(run);
    setResumable(false);
    try {
      localStorage.setItem(RUN_TRACKER_STORAGE_KEY, serializeFinishedRun(run, Date.now()));
      localStorage.removeItem(RUN_TRACKER_TRACE_STORAGE_KEY);
    } catch {
      // ignore
    }
    return run;
  }, [stopSource]);

  const discard = useCallback(() => {
    stopSource(true);
    stateRef.current = null;
    traceRef.current = [];
    setState(null);
    setFinishedRun(null);
    setGpsError(null);
    setResumable(false);
    try {
      localStorage.removeItem(RUN_TRACKER_STORAGE_KEY);
      localStorage.removeItem(RUN_TRACKER_TRACE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [stopSource]);

  // 1s UI tick driven by the source clock (compressed in simulation).
  // depends on the boolean, NOT the state object — state changes on every GPS
  // sample and would reset the interval before it ever fires
  const isRunning = state?.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => {
      setNowMs(sourceRef.current?.getNowMs() ?? Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  // Native iOS: the Capacitor KeepAwake engine (navigator.wakeLock is
  // unreliable in the WKWebView, so the web effect below does not cover runs).
  useKeepAwakeWhile(isRunning);

  // keep the screen awake while tracking (RestTimerPill pattern: re-acquire on
  // visibility return; fails quietly under Low Power Mode)
  useEffect(() => {
    if (!isRunning || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (!cancelled && document.visibilityState === 'visible') {
          sentinel = await navigator.wakeLock.request('screen');
        }
      } catch {
        // denied — tracking still works while the app is foregrounded
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [isRunning]);

  // Native: re-drain samples the recorder persisted while the WebView was
  // suspended (locked screen mid-run), which live listeners never received.
  useEffect(() => {
    if (!isRunning) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') sourceRef.current?.resync?.();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isRunning]);

  // On unmount: if a run is still active (e.g. navigating to another tab), keep
  // native recording alive in the background and only detach JS listeners — a
  // resume re-drains the durable file. Finish/discard stop recording explicitly.
  useEffect(() => {
    return () => {
      const current = stateRef.current;
      const source = sourceRef.current;
      if (source?.detach && current && current.status !== 'finished') {
        source.detach();
        sourceRef.current = null;
      } else {
        stopSource();
      }
    };
  }, [stopSource]);

  return {
    state,
    finishedRun,
    nowMs,
    gpsError,
    resumable,
    paused: state != null && isPaused(state),
    autoPaused: state != null && isAutoPaused(state),
    start,
    resume,
    split,
    togglePause,
    finish,
    discard,
  };
}
