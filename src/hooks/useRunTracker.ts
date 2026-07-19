// React wiring for the run tracker engine: position source lifecycle, 1s UI
// tick, wake lock (RestTimerPill pattern), throttled crash-recovery snapshots,
// and audio cues on engine events. The `PositionSource` port is injectable so
// /preview replays scripted scenarios through identical code — including a
// simulated clock, so a 10× replay still reads as real pace and elapsed time.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RUN_TRACKER_STORAGE_KEY,
  advanceTracker,
  createTracker,
  defaultTrackerConfig,
  finishTracker,
  isPaused,
  manualSplit,
  pauseTracker,
  restoreTracker,
  restoreFinishedRun,
  resumeTracker,
  serializeFinishedRun,
  serializeTracker,
  type FinishedRun,
  type GpsSample,
  type RunMode,
  type TrackerEvent,
  type TrackerState,
} from '@/lib/runTracker';
import { playLapCue, playSprintEndCue, playSprintStartCue } from '@/lib/runTrackerCues';
import { createDeviceMotionDetector } from '@/lib/deviceMotion';

export interface PositionSource {
  // simulated sources compress delivery but report a consistent clock
  getNowMs: () => number;
  start: (onSample: (sample: GpsSample) => void, onError: (message: string) => void) => void;
  stop: () => void;
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
            motionDetected: motionDetector.isMoving(Date.now()),
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

export interface UseRunTracker {
  state: TrackerState | null;
  finishedRun: FinishedRun | null;
  nowMs: number;
  gpsError: string | null;
  resumable: boolean;
  paused: boolean;
  start: (mode: RunMode, autoLapM: number | null, source?: PositionSource) => void;
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

  const stateRef = useRef<TrackerState | null>(null);
  const sourceRef = useRef<PositionSource | null>(null);
  const lastSnapshotRef = useRef(0);

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
        // storage full/blocked — tracking continues without recovery
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
          const { state: next, events } = advanceTracker(current, sample);
          commit(next, sample.t);
          applyEvents(events);
        },
        (message) => setGpsError(message),
      );
    },
    [applyEvents, commit],
  );

  const start = useCallback(
    (mode: RunMode, autoLapM: number | null, source?: PositionSource) => {
      const activeSource = source ?? createGeolocationSource();
      const now = activeSource.getNowMs();
      const tracker = createTracker(defaultTrackerConfig(mode, autoLapM), now);
      setFinishedRun(null);
      stateRef.current = tracker;
      setState(tracker);
      setResumable(false);
      lastSnapshotRef.current = now;
      try {
        localStorage.setItem(RUN_TRACKER_STORAGE_KEY, serializeTracker(tracker, now));
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
      stateRef.current = restored;
      setState(restored);
      setResumable(false);
      attachSource(source ?? createGeolocationSource());
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

  const stopSource = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
  }, []);

  const finish = useCallback((): FinishedRun | null => {
    const current = stateRef.current;
    const source = sourceRef.current;
    if (!current) return null;

    const run = finishTracker(current, source?.getNowMs() ?? Date.now());
    stopSource();
    const finished: TrackerState = { ...current, status: 'finished' };
    stateRef.current = finished;
    setState(finished);
    setFinishedRun(run);
    setResumable(false);
    try {
      localStorage.setItem(RUN_TRACKER_STORAGE_KEY, serializeFinishedRun(run, Date.now()));
    } catch {
      // ignore
    }
    return run;
  }, [stopSource]);

  const discard = useCallback(() => {
    stopSource();
    stateRef.current = null;
    setState(null);
    setFinishedRun(null);
    setGpsError(null);
    setResumable(false);
    try {
      localStorage.removeItem(RUN_TRACKER_STORAGE_KEY);
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

  // stop the GPS watch if the page unmounts mid-run (snapshot allows resume)
  useEffect(() => stopSource, [stopSource]);

  return { state, finishedRun, nowMs, gpsError, resumable, paused: state != null && isPaused(state), start, resume, split, togglePause, finish, discard };
}
