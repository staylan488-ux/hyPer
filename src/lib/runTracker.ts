// GPS run tracker engine. Pure wall-clock reducer (like restTimer.ts): no
// hidden timers, every transition driven by explicit samples/ticks, so the
// same code runs against real geolocation, the preview simulator, and tests.
//
// Three modes:
//   free      — live rolling pace over the last PACE_WINDOW seconds
//   intervals — manual tap-splits and/or auto-splits every `autoLapM` meters;
//               each split resets the live-pace window to the new lap
//   sprints   — hands-free: a speed-threshold state machine with hysteresis
//               detects each burst as one rep; no interaction required
import type { ActivitySegmentInput, ActivitySessionInput, ActivityType } from '@/types';

export type RunMode = 'free' | 'intervals' | 'sprints';

export interface GpsSample {
  t: number; // epoch ms
  lat: number;
  lon: number;
  accuracyM: number;
  speedMps: number | null; // device-reported speed when available
}

export interface TrackerConfig {
  mode: RunMode;
  autoLapM: number | null;
  accuracyMaxM: number;
  maxSpeedMps: number;
  minStepM: number;
  // below this device-reported speed the runner is treated as stationary and
  // no distance is accrued — the primary defence against standing GPS drift
  stationarySpeedMps: number;
  // when device speed is unavailable, a step must clear this fraction of the
  // fix's accuracy to count (a 5 m step under 15 m accuracy is noise)
  driftAccuracyFactor: number;
  warmupSamples: number;
  paceWindowS: number;
  paceMinDistanceM: number;
  speedEmaAlpha: number;
  manualSplitDebounceMs: number;
  sprintStartMps: number;
  sprintEndMps: number;
  sprintStartHoldS: number;
  sprintEndHoldS: number;
  sprintMinDistanceM: number;
  sprintMinDurationS: number;
}

// exported for field tuning: thresholds are first-guess values to calibrate
// against real traces during the on-device test phase
export const TRACKER_DEFAULTS = {
  accuracyMaxM: 30,
  maxSpeedMps: 12.5,
  minStepM: 2,
  stationarySpeedMps: 0.6, // ~1.3 mph; below any real walk/jog
  driftAccuracyFactor: 0.75,
  warmupSamples: 3,
  paceWindowS: 60,
  paceMinDistanceM: 20,
  speedEmaAlpha: 0.4,
  manualSplitDebounceMs: 700,
  sprintStartMps: 5.0,
  sprintEndMps: 3.0,
  sprintStartHoldS: 2,
  sprintEndHoldS: 3,
  sprintMinDistanceM: 30,
  sprintMinDurationS: 4,
} as const;

export function defaultTrackerConfig(mode: RunMode, autoLapM: number | null = null): TrackerConfig {
  return { mode, autoLapM: mode === 'intervals' ? autoLapM : null, ...TRACKER_DEFAULTS };
}

export interface Lap {
  index: number;
  startedAtMs: number;
  endedAtMs: number;
  // paused wall-clock inside this lap; active time = ended - started - pausedMs
  pausedMs: number;
  distanceM: number;
  trigger: 'manual' | 'auto' | 'finish';
}

export function lapActiveSeconds(lap: Lap): number {
  return Math.max(0, Math.round((lap.endedAtMs - lap.startedAtMs - lap.pausedMs) / 1000));
}

export interface SprintRep {
  index: number;
  startedAtMs: number;
  endedAtMs: number;
  distanceM: number;
  avgSpeedMps: number;
  peakSpeedMps: number;
}

interface WindowPoint {
  t: number;
  distM: number;
}

export interface TrackerState {
  status: 'running' | 'finished';
  // stable per-run id: keeps segment external_ids identical across save retries
  runId: string;
  config: TrackerConfig;
  startedAtMs: number;
  // pause: while paused, samples are ignored and clocks freeze
  pausedAtMs: number | null;
  totalPausedMs: number;
  lapPausedMs: number;
  // ingestion
  lastPoint: { t: number; lat: number; lon: number } | null;
  lastAcceptedMs: number | null;
  warmupCount: number;
  speedRejectCount: number;
  emaSpeedMps: number | null;
  totalDistanceM: number;
  window: WindowPoint[];
  // laps (intervals mode)
  lapStartMs: number;
  lapStartDistM: number;
  lastManualSplitMs: number | null;
  laps: Lap[];
  // sprint machine
  sprintPhase: 'idle' | 'active';
  sprintCandidateSinceMs: number | null;
  sprintCandidateDistM: number;
  sprintStartMs: number | null;
  sprintStartDistM: number;
  sprintPeakSpeedMps: number;
  sprintEndCandidateSinceMs: number | null;
  sprintEndCandidateDistM: number;
  reps: SprintRep[];
}

export type TrackerEvent =
  | { type: 'lap_completed'; lap: Lap }
  | { type: 'sprint_started' }
  | { type: 'sprint_completed'; rep: SprintRep };

export interface AdvanceResult {
  state: TrackerState;
  events: TrackerEvent[];
}

/* ── Geometry ── */

const EARTH_RADIUS_M = 6371008.8;

export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ── Lifecycle ── */

export function createTracker(config: TrackerConfig, nowMs: number, runId?: string): TrackerState {
  return {
    status: 'running',
    runId: runId ?? `run-${nowMs.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    config,
    startedAtMs: nowMs,
    pausedAtMs: null,
    totalPausedMs: 0,
    lapPausedMs: 0,
    lastPoint: null,
    lastAcceptedMs: null,
    warmupCount: 0,
    speedRejectCount: 0,
    emaSpeedMps: null,
    totalDistanceM: 0,
    window: [],
    lapStartMs: nowMs,
    lapStartDistM: 0,
    lastManualSplitMs: null,
    laps: [],
    sprintPhase: 'idle',
    sprintCandidateSinceMs: null,
    sprintCandidateDistM: 0,
    sprintStartMs: null,
    sprintStartDistM: 0,
    sprintPeakSpeedMps: 0,
    sprintEndCandidateSinceMs: null,
    sprintEndCandidateDistM: 0,
    reps: [],
  };
}

function pruneWindow(window: WindowPoint[], nowMs: number, paceWindowS: number): WindowPoint[] {
  const cutoff = nowMs - paceWindowS * 1000;
  // keep one point before the cutoff as the pace baseline
  let firstInside = window.findIndex((p) => p.t >= cutoff);
  if (firstInside === -1) firstInside = window.length;
  const from = Math.max(0, firstInside - 1);
  const pruned = from > 0 ? window.slice(from) : window;
  return pruned.length > 600 ? pruned.slice(pruned.length - 600) : pruned;
}

/* ── Ingestion ── */

export function advanceTracker(state: TrackerState, sample: GpsSample): AdvanceResult {
  if (state.status !== 'running') return { state, events: [] };
  // paused: ignore GPS entirely so distance and clocks freeze
  if (state.pausedAtMs != null) return { state, events: [] };

  const config = state.config;
  const events: TrackerEvent[] = [];
  const next: TrackerState = { ...state };

  // accuracy gate; poor fixes also reset the warm-up requirement
  if (sample.accuracyM > config.accuracyMaxM) {
    next.warmupCount = 0;
    return { state: next, events };
  }

  // warm-up: require N consecutive good fixes before any distance counts
  if (next.warmupCount < config.warmupSamples) {
    next.warmupCount += 1;
    next.lastPoint = { t: sample.t, lat: sample.lat, lon: sample.lon };
    next.lastAcceptedMs = sample.t;
    return { state: next, events };
  }

  // no anchor yet (fresh, or just resumed from pause): this sample becomes the
  // anchor and banks no distance
  const prev = next.lastPoint;
  if (!prev) {
    next.lastPoint = { t: sample.t, lat: sample.lat, lon: sample.lon };
    next.lastAcceptedMs = sample.t;
    return { state: next, events };
  }
  if (sample.t <= prev.t) return { state: next, events };

  const stepM = haversineMeters(prev, sample);
  const dtS = (sample.t - prev.t) / 1000;
  const impliedSpeed = stepM / dtS;
  const reportedSpeed = sample.speedMps != null && sample.speedMps >= 0 ? sample.speedMps : null;

  // teleport filter: reject a lone impossible jump, but if the rejections
  // persist the position really moved — re-anchor without counting distance
  if (impliedSpeed > config.maxSpeedMps) {
    next.speedRejectCount += 1;
    if (next.speedRejectCount >= 3) {
      next.lastPoint = { t: sample.t, lat: sample.lat, lon: sample.lon };
      next.speedRejectCount = 0;
    }
    return { state: next, events };
  }
  next.speedRejectCount = 0;

  // stationary gate: the device's Doppler speed reads ~0 when standing still
  // even as the fix wanders. Re-anchor to the current point (so a later real
  // step is measured from here) but bank NO distance — this is what stops the
  // "distance climbs while standing" drift.
  if (reportedSpeed != null && reportedSpeed < config.stationarySpeedMps) {
    next.lastPoint = { t: sample.t, lat: sample.lat, lon: sample.lon };
    next.lastAcceptedMs = sample.t;
    next.emaSpeedMps =
      next.emaSpeedMps == null ? reportedSpeed : next.emaSpeedMps + config.speedEmaAlpha * (reportedSpeed - next.emaSpeedMps);
    return { state: next, events };
  }

  // jitter floor. With device speed we trust a small real step; without it,
  // require the step to clear the fix's own uncertainty so noise is dropped.
  const jitterFloor =
    reportedSpeed != null ? config.minStepM : Math.max(config.minStepM, sample.accuracyM * config.driftAccuracyFactor);
  if (stepM < jitterFloor) {
    next.lastAcceptedMs = sample.t;
    return { state: next, events };
  }

  next.lastPoint = { t: sample.t, lat: sample.lat, lon: sample.lon };
  next.lastAcceptedMs = sample.t;
  next.totalDistanceM = state.totalDistanceM + stepM;

  const observedSpeed = reportedSpeed ?? impliedSpeed;
  next.emaSpeedMps =
    next.emaSpeedMps == null
      ? observedSpeed
      : next.emaSpeedMps + config.speedEmaAlpha * (observedSpeed - next.emaSpeedMps);

  next.window = pruneWindow(
    [...state.window, { t: sample.t, distM: next.totalDistanceM }],
    sample.t,
    config.paceWindowS,
  );

  // auto-splits: interpolate the crossing time between the previous cumulative
  // point and this one so a split at 400m is timed at 400m, not at the sample
  if (config.mode === 'intervals' && config.autoLapM != null && config.autoLapM > 0) {
    const prevDist = state.totalDistanceM;
    let lapTarget = next.lapStartDistM + config.autoLapM;
    while (lapTarget <= next.totalDistanceM) {
      const ratio = (lapTarget - prevDist) / (next.totalDistanceM - prevDist);
      const crossT = ratio >= 0 && ratio <= 1 ? prev.t + ratio * (sample.t - prev.t) : sample.t;
      const lap: Lap = {
        index: next.laps.length + 1,
        startedAtMs: next.lapStartMs,
        endedAtMs: Math.round(crossT),
        pausedMs: next.lapPausedMs,
        distanceM: lapTarget - next.lapStartDistM,
        trigger: 'auto',
      };
      next.laps = [...next.laps, lap];
      next.lapStartMs = Math.round(crossT);
      next.lapStartDistM = lapTarget;
      next.lapPausedMs = 0;
      events.push({ type: 'lap_completed', lap });
      lapTarget = next.lapStartDistM + config.autoLapM;
    }
  }

  if (config.mode === 'sprints') {
    advanceSprintMachine(next, sample.t, events);
  }

  return { state: next, events };
}

// hysteresis: EMA speed must hold above start-threshold to begin a rep and
// below end-threshold to finish it, so brief GPS wobbles don't split reps
function advanceSprintMachine(next: TrackerState, tMs: number, events: TrackerEvent[]): void {
  const config = next.config;
  const speed = next.emaSpeedMps ?? 0;

  if (next.sprintPhase === 'idle') {
    if (speed >= config.sprintStartMps) {
      if (next.sprintCandidateSinceMs == null) {
        next.sprintCandidateSinceMs = tMs;
        next.sprintCandidateDistM = next.totalDistanceM;
      } else if ((tMs - next.sprintCandidateSinceMs) / 1000 >= config.sprintStartHoldS) {
        next.sprintPhase = 'active';
        next.sprintStartMs = next.sprintCandidateSinceMs;
        next.sprintStartDistM = next.sprintCandidateDistM;
        next.sprintPeakSpeedMps = speed;
        next.sprintEndCandidateSinceMs = null;
        next.sprintCandidateSinceMs = null;
        events.push({ type: 'sprint_started' });
      }
    } else {
      next.sprintCandidateSinceMs = null;
    }
    return;
  }

  // active
  next.sprintPeakSpeedMps = Math.max(next.sprintPeakSpeedMps, speed);
  if (speed <= config.sprintEndMps) {
    if (next.sprintEndCandidateSinceMs == null) {
      next.sprintEndCandidateSinceMs = tMs;
      next.sprintEndCandidateDistM = next.totalDistanceM;
    } else if ((tMs - next.sprintEndCandidateSinceMs) / 1000 >= config.sprintEndHoldS) {
      completeSprint(next, next.sprintEndCandidateSinceMs, next.sprintEndCandidateDistM, events);
    }
  } else {
    next.sprintEndCandidateSinceMs = null;
  }
}

function completeSprint(
  next: TrackerState,
  endMs: number,
  endDistM: number,
  events: TrackerEvent[],
): void {
  const startMs = next.sprintStartMs ?? endMs;
  const durationS = (endMs - startMs) / 1000;
  const distanceM = Math.max(0, endDistM - next.sprintStartDistM);
  const config = next.config;

  if (durationS >= config.sprintMinDurationS && distanceM >= config.sprintMinDistanceM) {
    const rep: SprintRep = {
      index: next.reps.length + 1,
      startedAtMs: startMs,
      endedAtMs: endMs,
      distanceM,
      avgSpeedMps: durationS > 0 ? distanceM / durationS : 0,
      peakSpeedMps: next.sprintPeakSpeedMps,
    };
    next.reps = [...next.reps, rep];
    events.push({ type: 'sprint_completed', rep });
  }

  next.sprintPhase = 'idle';
  next.sprintStartMs = null;
  next.sprintStartDistM = 0;
  next.sprintPeakSpeedMps = 0;
  next.sprintEndCandidateSinceMs = null;
  next.sprintCandidateSinceMs = null;
}

/* ── Pause / resume ── */

export function isPaused(state: TrackerState): boolean {
  return state.pausedAtMs != null;
}

export function pauseTracker(state: TrackerState, nowMs: number): TrackerState {
  if (state.status !== 'running' || state.pausedAtMs != null) return state;
  return { ...state, pausedAtMs: nowMs };
}

export function resumeTracker(state: TrackerState, nowMs: number): TrackerState {
  if (state.status !== 'running' || state.pausedAtMs == null) return state;
  const pausedDuration = Math.max(0, nowMs - state.pausedAtMs);
  return {
    ...state,
    pausedAtMs: null,
    totalPausedMs: state.totalPausedMs + pausedDuration,
    lapPausedMs: state.lapPausedMs + pausedDuration,
    // re-anchor so the pause gap (or any drift while parked) is never counted
    lastPoint: null,
    lastAcceptedMs: nowMs,
    speedRejectCount: 0,
  };
}

/* ── Manual split (intervals) ── */

export function manualSplit(state: TrackerState, tMs: number): AdvanceResult {
  if (state.status !== 'running' || state.config.mode !== 'intervals' || state.pausedAtMs != null) {
    return { state, events: [] };
  }
  if (
    state.lastManualSplitMs != null &&
    tMs - state.lastManualSplitMs < state.config.manualSplitDebounceMs
  ) {
    return { state, events: [] };
  }

  const lap: Lap = {
    index: state.laps.length + 1,
    startedAtMs: state.lapStartMs,
    endedAtMs: tMs,
    pausedMs: state.lapPausedMs,
    distanceM: state.totalDistanceM - state.lapStartDistM,
    trigger: 'manual',
  };
  const next: TrackerState = {
    ...state,
    laps: [...state.laps, lap],
    lapStartMs: tMs,
    lapStartDistM: state.totalDistanceM,
    lapPausedMs: 0,
    lastManualSplitMs: tMs,
  };
  return { state: next, events: [{ type: 'lap_completed', lap }] };
}

/* ── Selectors (all pause-aware: clocks freeze at pausedAtMs) ── */

// the reference "now" — frozen at the pause instant while paused
function clockNow(state: TrackerState, nowMs: number): number {
  return state.pausedAtMs ?? nowMs;
}

export function elapsedSeconds(state: TrackerState, nowMs: number): number {
  return Math.max(0, Math.round((clockNow(state, nowMs) - state.startedAtMs - state.totalPausedMs) / 1000));
}

export function isGpsWeak(state: TrackerState, nowMs: number): boolean {
  if (state.lastAcceptedMs == null) return true;
  return nowMs - state.lastAcceptedMs > 8000;
}

export function isWarmingUp(state: TrackerState): boolean {
  return state.warmupCount < state.config.warmupSamples;
}

const PACE_MILE_M = 1609.344;

// live pace (seconds per mile) over the trailing window, clipped to the
// current lap so an interval split restarts the readout — the whole point
// vs. Strava
export function rollingPaceSecPerMile(state: TrackerState, nowMs: number): number | null {
  const config = state.config;
  const cutoff = Math.max(nowMs - config.paceWindowS * 1000, state.lapStartMs);
  const points = state.window.filter((p) => p.t >= cutoff);
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const distM = last.distM - first.distM;
  const dtS = (last.t - first.t) / 1000;
  if (distM < config.paceMinDistanceM || dtS <= 0) return null;
  return dtS / (distM / PACE_MILE_M);
}

export function currentLapDistanceM(state: TrackerState): number {
  return state.totalDistanceM - state.lapStartDistM;
}

export function currentLapSeconds(state: TrackerState, nowMs: number): number {
  return Math.max(0, Math.round((clockNow(state, nowMs) - state.lapStartMs - state.lapPausedMs) / 1000));
}

/* ── Finish + persistence ── */

export interface FinishedRun {
  runId: string;
  mode: RunMode;
  startedAtMs: number;
  endedAtMs: number;
  totalDistanceM: number;
  elapsedS: number;
  laps: Lap[];
  reps: SprintRep[];
}

export function finishTracker(state: TrackerState, nowMs: number): FinishedRun {
  // finishing while paused freezes the end at the pause instant
  const end = clockNow(state, nowMs);
  let laps = state.laps;
  // close the open lap so its distance isn't lost (intervals mode only)
  if (state.config.mode === 'intervals') {
    const openDistance = state.totalDistanceM - state.lapStartDistM;
    if (openDistance >= 1 || laps.length === 0) {
      laps = [
        ...laps,
        {
          index: laps.length + 1,
          startedAtMs: state.lapStartMs,
          endedAtMs: end,
          pausedMs: state.lapPausedMs,
          distanceM: openDistance,
          trigger: 'finish',
        },
      ];
    }
  }

  return {
    runId: state.runId,
    mode: state.config.mode,
    startedAtMs: state.startedAtMs,
    endedAtMs: end,
    totalDistanceM: state.totalDistanceM,
    // active (moving) time: wall clock minus everything spent paused
    elapsedS: Math.max(1, Math.round((end - state.startedAtMs - state.totalPausedMs) / 1000)),
    laps,
    reps: state.reps,
  };
}

const MODE_TO_ACTIVITY: Record<RunMode, ActivityType> = {
  free: 'run',
  intervals: 'interval_run',
  sprints: 'sprint_session',
};

function localDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// stable external ids make retried saves idempotent via the segment upsert key
export function finishedRunToActivity(
  run: FinishedRun,
  runLocalId: string,
): { session: ActivitySessionInput; segments: ActivitySegmentInput[] } {
  const session: ActivitySessionInput = {
    activity_type: MODE_TO_ACTIVITY[run.mode],
    title: null,
    date: localDateKey(run.startedAtMs),
    started_at: new Date(run.startedAtMs).toISOString(),
    ended_at: new Date(run.endedAtMs).toISOString(),
    duration_seconds: run.elapsedS,
    source: 'gps',
    distance_m: run.totalDistanceM > 0 ? Math.round(run.totalDistanceM) : null,
  };

  let segments: ActivitySegmentInput[];
  if (run.mode === 'sprints') {
    segments = run.reps.map((rep, i) => ({
      source: 'gps',
      external_id: `gps:${runLocalId}:${i + 1}`,
      sport: 'running',
      started_at: new Date(rep.startedAtMs).toISOString(),
      ended_at: new Date(rep.endedAtMs).toISOString(),
      duration_seconds: Math.max(1, Math.round((rep.endedAtMs - rep.startedAtMs) / 1000)),
      distance_m: Math.round(rep.distanceM),
      raw: { peak_speed_mps: Math.round(rep.peakSpeedMps * 100) / 100, avg_speed_mps: Math.round(rep.avgSpeedMps * 100) / 100 },
    }));
  } else if (run.mode === 'intervals') {
    segments = run.laps.map((lap, i) => ({
      source: 'gps',
      external_id: `gps:${runLocalId}:${i + 1}`,
      sport: 'running',
      started_at: new Date(lap.startedAtMs).toISOString(),
      ended_at: new Date(lap.endedAtMs).toISOString(),
      duration_seconds: Math.max(1, lapActiveSeconds(lap)),
      distance_m: Math.round(lap.distanceM),
      raw: { trigger: lap.trigger },
    }));
  } else {
    segments = [
      {
        source: 'gps',
        external_id: `gps:${runLocalId}:1`,
        sport: 'running',
        started_at: session.started_at as string,
        ended_at: session.ended_at as string,
        duration_seconds: run.elapsedS,
        distance_m: session.distance_m,
        raw: null,
      },
    ];
  }

  return { session, segments };
}

/* ── Crash recovery ── */

export const RUN_TRACKER_STORAGE_KEY = 'hyper:run-tracker';
export const RUN_TRACKER_RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface TrackerSnapshot {
  version: 1;
  savedAtMs: number;
  state: TrackerState;
}

export function serializeTracker(state: TrackerState, nowMs: number): string {
  const snapshot: TrackerSnapshot = { version: 1, savedAtMs: nowMs, state };
  return JSON.stringify(snapshot);
}

export function restoreTracker(raw: string | null, nowMs: number): TrackerState | null {
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as TrackerSnapshot;
    if (snapshot.version !== 1 || !snapshot.state || snapshot.state.status !== 'running') return null;
    if (nowMs - snapshot.savedAtMs > RUN_TRACKER_RESUME_MAX_AGE_MS) return null;
    if (typeof snapshot.state.startedAtMs !== 'number' || !snapshot.state.config?.mode) return null;
    if (typeof snapshot.state.runId !== 'string') return null;
    // a crash while paused resumes un-paused (the paused span is closed out)
    const state = snapshot.state;
    if (state.pausedAtMs != null) {
      state.totalPausedMs = (state.totalPausedMs ?? 0) + Math.max(0, snapshot.savedAtMs - state.pausedAtMs);
      state.pausedAtMs = null;
    }
    state.totalPausedMs ??= 0;
    state.lapPausedMs ??= 0;
    state.lastPoint = null; // re-anchor after the gap
    return state;
  } catch {
    return null;
  }
}
