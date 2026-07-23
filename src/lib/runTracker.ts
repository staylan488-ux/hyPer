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
  // optional sustained-motion evidence from the phone accelerometer. This is
  // deliberately only a gate; route and distance still come from GPS/speed.
  motionDetected?: boolean;
}

export type GpsSampleDecision =
  | 'paused'
  | 'auto_paused'
  | 'poor_accuracy'
  | 'warming'
  | 'anchor'
  | 'stale'
  | 'teleport'
  | 'stationary'
  | 'jitter'
  | 'accepted_position'
  | 'accepted_speed'
  | 'accepted_fused';

// Full-fidelity diagnostics stay on the device. They are intentionally not
// mapped into activity_sessions/activity_segments when the run is saved.
export interface GpsTracePoint extends GpsSample {
  decision: GpsSampleDecision;
  acceptedDistanceM: number;
  cumulativeDistanceM: number;
}

export interface GpsQualitySummary {
  sampleCount: number;
  acceptedSampleCount: number;
  rejectedSampleCount: number;
  speedCoveragePct: number;
  averageAccuracyM: number | null;
  p95AccuracyM: number | null;
  longestGapS: number;
}

export interface TrackerConfig {
  mode: RunMode;
  autoLapM: number | null;
  autoPause: boolean;
  accuracyMaxM: number;
  maxSpeedMps: number;
  minStepM: number;
  // Below this device-reported speed GPS alone is treated as stationary. Slow
  // movement may still count when sustained phone motion independently confirms
  // it, avoiding the old false-negative for indoor walking.
  stationarySpeedMps: number;
  // when device speed is unavailable, a step must clear this multiple of the
  // combined uncertainty of the previous and current fixes.
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
  stationarySpeedMps: 1.2,
  driftAccuracyFactor: 1.3,
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

export function defaultTrackerConfig(
  mode: RunMode,
  autoLapM: number | null = null,
): TrackerConfig {
  return { mode, autoLapM: mode === 'intervals' ? autoLapM : null, autoPause: false, ...TRACKER_DEFAULTS };
}

export interface Lap {
  index: number;
  startedAtMs: number;
  endedAtMs: number;
  // paused wall-clock inside this lap; active time = ended - started - pausedMs
  pausedMs: number;
  distanceM: number;
  trigger: 'manual' | 'auto' | 'finish';
  // 'rest' marks a deliberate recovery between efforts (standing or walking).
  // Rest laps still count toward elapsed time but are not paced as efforts.
  kind: 'work' | 'rest';
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
  autoPausedAtMs: number | null;
  totalAutoPausedMs: number;
  lapAutoPausedMs: number;
  stationarySinceMs: number | null;
  // ingestion
  lastPoint: { t: number; lat: number; lon: number; accuracyM?: number; speedMps?: number | null } | null;
  // false until the initial consecutive-good-fix requirement is met. The run
  // clock starts at that lock, not when the user first taps Start.
  hasGpsLock: boolean;
  lastSampleMs: number | null;
  lastAccuracyM: number | null;
  lastAcceptedMs: number | null;
  warmupCount: number;
  speedRejectCount: number;
  emaSpeedMps: number | null;
  totalDistanceM: number;
  window: WindowPoint[];
  // laps (intervals mode)
  lapStartMs: number;
  lapStartDistM: number;
  // kind of the lap currently open
  lapKind: 'work' | 'rest';
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
  observation?: GpsTracePoint;
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
    autoPausedAtMs: null,
    totalAutoPausedMs: 0,
    lapAutoPausedMs: 0,
    stationarySinceMs: null,
    lastPoint: null,
    hasGpsLock: false,
    lastSampleMs: null,
    lastAccuracyM: null,
    lastAcceptedMs: null,
    warmupCount: 0,
    speedRejectCount: 0,
    emaSpeedMps: null,
    totalDistanceM: 0,
    window: [],
    lapStartMs: nowMs,
    lapStartDistM: 0,
    lapKind: 'work',
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
  const config = state.config;
  const events: TrackerEvent[] = [];
  const trace = (
    nextState: TrackerState,
    decision: GpsSampleDecision,
    acceptedDistanceM = 0,
  ): AdvanceResult => ({
    state: nextState,
    events,
    observation: {
      ...sample,
      decision,
      acceptedDistanceM,
      cumulativeDistanceM: nextState.totalDistanceM,
    },
  });

  // Paused fixes are retained for diagnostics but cannot affect distance.
  if (state.pausedAtMs != null) return trace(state, 'paused');

  const next: TrackerState = {
    ...state,
    lastSampleMs: sample.t,
    lastAccuracyM: sample.accuracyM,
  };
  const anchor = {
    t: sample.t,
    lat: sample.lat,
    lon: sample.lon,
    accuracyM: sample.accuracyM,
    speedMps: sample.speedMps,
  };

  // accuracy gate; poor fixes also reset the warm-up requirement
  if (sample.accuracyM > config.accuracyMaxM) {
    next.warmupCount = 0;
    return trace(next, 'poor_accuracy');
  }

  // warm-up: require N consecutive good fixes before any distance counts
  if (next.warmupCount < config.warmupSamples) {
    next.warmupCount += 1;
    next.lastPoint = anchor;
    next.lastAcceptedMs = sample.t;
    if (!next.hasGpsLock && next.warmupCount >= config.warmupSamples) {
      // Do not charge GPS acquisition time to the run or its first lap.
      next.hasGpsLock = true;
      next.startedAtMs = sample.t;
      next.lapStartMs = sample.t;
      next.lastManualSplitMs = null;
      next.window = [];
    }
    return trace(next, 'warming');
  }

  // no anchor yet (fresh, or just resumed from pause): this sample becomes the
  // anchor and banks no distance
  const prev = next.lastPoint;
  if (!prev) {
    next.lastPoint = anchor;
    next.lastAcceptedMs = sample.t;
    return trace(next, 'anchor');
  }
  if (sample.t <= prev.t) return trace(next, 'stale');

  const stepM = haversineMeters(prev, sample);
  const dtS = (sample.t - prev.t) / 1000;
  const impliedSpeed = stepM / dtS;
  const reportedSpeed = sample.speedMps != null && sample.speedMps >= 0 && Number.isFinite(sample.speedMps)
    ? sample.speedMps
    : null;
  const previousSpeed = prev.speedMps != null && prev.speedMps >= 0 && Number.isFinite(prev.speedMps)
    ? prev.speedMps
    : null;
  const motionAssisted = sample.motionDetected === true;
  const slowReportedSpeed = reportedSpeed != null && reportedSpeed < config.stationarySpeedMps;

  // Core Location's speed estimate is often steadier than one-second point to
  // point displacement. Safari omits speedAccuracy, so only use it across a
  // short fresh gap and within a physically plausible running range.
  const speedEligible = reportedSpeed != null
    && reportedSpeed <= config.maxSpeedMps
    && dtS <= 5
    && (!slowReportedSpeed || motionAssisted);
  const representativeSpeed = speedEligible
    ? previousSpeed != null && previousSpeed <= config.maxSpeedMps
      ? (previousSpeed + reportedSpeed) / 2
      : reportedSpeed
    : null;
  const speedStepM = representativeSpeed != null ? representativeSpeed * dtS : null;
  const coordinatePlausible = impliedSpeed <= config.maxSpeedMps;

  // A coordinate spike may coexist with a plausible platform speed. In that
  // case, use speed for this short interval and re-anchor instead of losing the
  // distance. With no trustworthy speed, retain the conservative teleport gate.
  if (!coordinatePlausible && speedStepM == null) {
    next.speedRejectCount += 1;
    if (next.speedRejectCount >= 3) {
      next.lastPoint = anchor;
      next.speedRejectCount = 0;
    }
    return trace(next, 'teleport');
  }
  next.speedRejectCount = 0;

  // GPS position can wander by several metres at rest, while genuinely slow
  // indoor movement can report under 1.2 m/s. Only independent sustained phone
  // motion is allowed to override this low-speed drift gate.
  if (slowReportedSpeed && !motionAssisted) {
    next.lastPoint = anchor;
    next.lastAcceptedMs = sample.t;
    next.emaSpeedMps =
      next.emaSpeedMps == null ? reportedSpeed : next.emaSpeedMps + config.speedEmaAlpha * (reportedSpeed - next.emaSpeedMps);
    return trace(next, 'stationary');
  }

  // Fuse two independent estimates when they agree. Prefer speed when the
  // coordinate is frozen, noisy, or briefly spikes; prefer coordinates when
  // speed is absent. This avoids both zig-zag inflation and the old stuck-point
  // failure without inventing distance across long callback gaps.
  let acceptedStepM: number | null = null;
  let acceptedDecision: GpsSampleDecision = 'accepted_position';
  if (speedStepM != null) {
    const closeAgreement = coordinatePlausible
      && Math.abs(stepM - speedStepM) <= Math.max(0.5, speedStepM * 0.35)
      && sample.accuracyM <= 15
      && (prev.accuracyM ?? sample.accuracyM) <= 15;
    if (closeAgreement) {
      acceptedStepM = speedStepM * 0.7 + stepM * 0.3;
      acceptedDecision = 'accepted_fused';
    } else {
      acceptedStepM = speedStepM;
      acceptedDecision = 'accepted_speed';
    }
  }

  // Without a plausible speed estimate, accumulate coordinates until movement
  // clears the combined uncertainty rather than summing every GPS wobble.
  const combinedAccuracyM = Math.hypot(prev.accuracyM ?? sample.accuracyM, sample.accuracyM);
  const jitterFloor = Math.max(config.minStepM, combinedAccuracyM * config.driftAccuracyFactor);
  if (acceptedStepM == null && stepM < jitterFloor) {
    next.lastAcceptedMs = sample.t;
    return trace(next, 'jitter');
  }
  acceptedStepM ??= stepM;

  next.lastPoint = anchor;
  next.lastAcceptedMs = sample.t;
  next.totalDistanceM = state.totalDistanceM + acceptedStepM;

  const observedSpeed = representativeSpeed ?? acceptedStepM / dtS;
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
  if (
    config.mode === 'intervals'
    && next.lapKind === 'work'
    && config.autoLapM != null
    && config.autoLapM > 0
  ) {
    const prevDist = state.totalDistanceM;
    let lapTarget = next.lapStartDistM + config.autoLapM;
    while (lapTarget <= next.totalDistanceM) {
      const ratio = (lapTarget - prevDist) / (next.totalDistanceM - prevDist);
      const crossT = ratio >= 0 && ratio <= 1 ? prev.t + ratio * (sample.t - prev.t) : sample.t;
      const lap: Lap = {
        index: next.laps.length + 1,
        startedAtMs: next.lapStartMs,
        endedAtMs: Math.round(crossT),
        pausedMs: next.lapPausedMs + next.lapAutoPausedMs,
        distanceM: lapTarget - next.lapStartDistM,
        kind: next.lapKind,
        trigger: 'auto',
      };
      next.laps = [...next.laps, lap];
      next.lapStartMs = Math.round(crossT);
      next.lapStartDistM = lapTarget;
      next.lapPausedMs = 0;
      next.lapAutoPausedMs = 0;
      events.push({ type: 'lap_completed', lap });
      lapTarget = next.lapStartDistM + config.autoLapM;
    }
  }

  if (config.mode === 'sprints') {
    advanceSprintMachine(next, sample.t, events);
  }

  return trace(next, acceptedDecision, acceptedStepM);
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
  return {
    ...state,
    pausedAtMs: nowMs,
    autoPausedAtMs: null,
    stationarySinceMs: null,
  };
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
    emaSpeedMps: null,
    stationarySinceMs: null,
    // Live pace must not divide by the paused wall-clock gap.
    window: [{ t: nowMs, distM: state.totalDistanceM }],
  };
}

/* ── Manual split (intervals) ── */

export function manualSplit(state: TrackerState, tMs: number): AdvanceResult {
  if (
    state.status !== 'running'
    || state.config.mode !== 'intervals'
    || state.pausedAtMs != null
    || state.autoPausedAtMs != null
  ) {
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
    pausedMs: state.lapPausedMs + state.lapAutoPausedMs,
    distanceM: state.totalDistanceM - state.lapStartDistM,
    trigger: 'manual',
    kind: state.lapKind,
  };
  const next: TrackerState = {
    ...state,
    laps: [...state.laps, lap],
    lapStartMs: tMs,
    lapStartDistM: state.totalDistanceM,
    lapKind: 'work',
    lapPausedMs: 0,
    lapAutoPausedMs: 0,
    lastManualSplitMs: tMs,
  };
  return { state: next, events: [{ type: 'lap_completed', lap }] };
}

/**
 * Ends the current effort and opens a rest lap (or, when already resting, ends
 * the rest and opens the next effort). Rest is for intervals taken standing or
 * walking: the clock keeps running so total time stays honest, but the lap is
 * labelled so its pace is not read as an effort.
 */
export function toggleRest(state: TrackerState, tMs: number): AdvanceResult {
  if (
    state.status !== 'running'
    || state.config.mode !== 'intervals'
    || state.pausedAtMs != null
    || state.autoPausedAtMs != null
  ) {
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
    pausedMs: state.lapPausedMs + state.lapAutoPausedMs,
    distanceM: state.totalDistanceM - state.lapStartDistM,
    trigger: 'manual',
    kind: state.lapKind,
  };
  const next: TrackerState = {
    ...state,
    laps: [...state.laps, lap],
    lapStartMs: tMs,
    lapStartDistM: state.totalDistanceM,
    lapKind: state.lapKind === 'rest' ? 'work' : 'rest',
    lapPausedMs: 0,
    lapAutoPausedMs: 0,
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
  if (!state.hasGpsLock) return 0;
  const end = clockNow(state, nowMs);
  const activeAutoPauseMs = state.autoPausedAtMs != null
    ? Math.max(0, end - state.autoPausedAtMs)
    : 0;
  return Math.max(0, Math.round((
    end
    - state.startedAtMs
    - state.totalPausedMs
    - state.totalAutoPausedMs
    - activeAutoPauseMs
  ) / 1000));
}

export function isGpsWeak(state: TrackerState, nowMs: number): boolean {
  if (state.lastAcceptedMs == null) return true;
  return nowMs - state.lastAcceptedMs > 8000;
}

export function isWarmingUp(state: TrackerState): boolean {
  return !state.hasGpsLock || state.warmupCount < state.config.warmupSamples;
}

export function gpsAccuracyMeters(state: TrackerState): number | null {
  return state.lastAccuracyM != null && Number.isFinite(state.lastAccuracyM)
    ? Math.round(state.lastAccuracyM)
    : null;
}

const PACE_MILE_M = 1609.344;

// a device speed older than this no longer describes "now" (callback gap,
// backgrounding, or a stalled provider)
const CURRENT_SPEED_MAX_AGE_MS = 5_000;

// device-reported speed of the last accepted sample while it is still fresh;
// null when paused, before the first good fix, or after a delivery gap
export function currentSpeedMps(state: TrackerState, nowMs: number): number | null {
  if (isPaused(state)) return null;
  const point = state.lastPoint;
  if (!point) return null;
  const speed = state.emaSpeedMps;
  if (speed == null || speed < 0 || !Number.isFinite(speed)) return null;
  if (nowMs - point.t > CURRENT_SPEED_MAX_AGE_MS) return null;
  return speed;
}

// live pace (seconds per mile) over the trailing window, clipped to the
// current lap so an interval split restarts the readout
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

// Whole-session active average. Five metres is enough to avoid rendering pace
// from the first noisy fix while still giving short walks immediate feedback.
export function averagePaceSecPerMile(state: TrackerState, nowMs: number): number | null {
  if (state.totalDistanceM < 5) return null;
  const elapsedS = elapsedSeconds(state, nowMs);
  if (elapsedS <= 0) return null;
  return elapsedS / (state.totalDistanceM / PACE_MILE_M);
}

export function currentLapDistanceM(state: TrackerState): number {
  return state.totalDistanceM - state.lapStartDistM;
}

export function currentLapSeconds(state: TrackerState, nowMs: number): number {
  const end = clockNow(state, nowMs);
  const activeAutoPauseMs = state.autoPausedAtMs != null
    ? Math.max(0, end - Math.max(state.autoPausedAtMs, state.lapStartMs))
    : 0;
  return Math.max(0, Math.round((
    end
    - state.lapStartMs
    - state.lapPausedMs
    - state.lapAutoPausedMs
    - activeAutoPauseMs
  ) / 1000));
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
  // Local-only route diagnostics. finishedRunToActivity deliberately ignores
  // this field, so coordinates never reach Supabase through the GPS save path.
  trace?: GpsTracePoint[];
  quality?: GpsQualitySummary;
}

export function summarizeGpsTrace(trace: GpsTracePoint[]): GpsQualitySummary {
  const accuracies = trace
    .map((point) => point.accuracyM)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const accepted = trace.filter((point) => point.decision.startsWith('accepted_'));
  const rejected = trace.filter((point) => (
    point.decision === 'poor_accuracy'
    || point.decision === 'teleport'
    || point.decision === 'stale'
  ));
  const speedSamples = trace.filter((point) => point.speedMps != null && point.speedMps >= 0);
  let longestGapS = 0;
  for (let index = 1; index < trace.length; index += 1) {
    longestGapS = Math.max(longestGapS, Math.max(0, (trace[index].t - trace[index - 1].t) / 1000));
  }
  const p95Index = accuracies.length > 0 ? Math.min(accuracies.length - 1, Math.ceil(accuracies.length * 0.95) - 1) : -1;
  return {
    sampleCount: trace.length,
    acceptedSampleCount: accepted.length,
    rejectedSampleCount: rejected.length,
    speedCoveragePct: trace.length > 0 ? Math.round((speedSamples.length / trace.length) * 100) : 0,
    averageAccuracyM: accuracies.length > 0
      ? Math.round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length)
      : null,
    p95AccuracyM: p95Index >= 0 ? Math.round(accuracies[p95Index]) : null,
    longestGapS: Math.round(longestGapS * 10) / 10,
  };
}

export function finishTracker(
  state: TrackerState,
  nowMs: number,
  trace: GpsTracePoint[] = [],
): FinishedRun {
  // finishing while paused freezes the end at the pause instant
  const end = clockNow(state, nowMs);
  const activeAutoPauseMs = state.autoPausedAtMs != null
    ? Math.max(0, end - Math.max(state.autoPausedAtMs, state.lapStartMs))
    : 0;
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
          pausedMs: state.lapPausedMs + state.lapAutoPausedMs + activeAutoPauseMs,
          distanceM: openDistance,
          trigger: 'finish',
          kind: state.lapKind,
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
    elapsedS: Math.max(1, elapsedSeconds(state, end)),
    laps,
    reps: state.reps,
    trace,
    quality: summarizeGpsTrace(trace),
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
export const RUN_TRACKER_TRACE_STORAGE_KEY = 'hyper:run-tracker-trace';
export const RUN_TRACKER_RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const FINISHED_RUN_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface TrackerSnapshot {
  version: 1;
  savedAtMs: number;
  state: TrackerState;
  trace?: GpsTracePoint[];
}

interface FinishedRunSnapshot {
  version: 2;
  savedAtMs: number;
  finishedRun: FinishedRun;
}

interface TrackerTraceSnapshot {
  version: 1;
  runId: string;
  savedAtMs: number;
  trace: GpsTracePoint[];
}

const MAX_LOCAL_TRACE_POINTS = 18_000;

function boundedTrace(trace: GpsTracePoint[]): GpsTracePoint[] {
  return trace.length <= MAX_LOCAL_TRACE_POINTS
    ? trace
    : trace.slice(trace.length - MAX_LOCAL_TRACE_POINTS);
}

export function serializeTracker(
  state: TrackerState,
  nowMs: number,
  trace: GpsTracePoint[] = [],
): string {
  const snapshot: TrackerSnapshot = {
    version: 1,
    savedAtMs: nowMs,
    state,
    trace: boundedTrace(trace),
  };
  return JSON.stringify(snapshot);
}

export function serializeFinishedRun(finishedRun: FinishedRun, nowMs: number): string {
  // Preserve the unsaved run summary without risking a multi-megabyte
  // synchronous localStorage write. The full trace remains available in
  // memory for export until the page is reloaded.
  const snapshotRun: FinishedRun = { ...finishedRun, trace: undefined };
  const snapshot: FinishedRunSnapshot = { version: 2, savedAtMs: nowMs, finishedRun: snapshotRun };
  return JSON.stringify(snapshot);
}

export function serializeTrackerTrace(
  runId: string,
  nowMs: number,
  trace: GpsTracePoint[],
): string {
  const snapshot: TrackerTraceSnapshot = {
    version: 1,
    runId,
    savedAtMs: nowMs,
    trace: boundedTrace(trace),
  };
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
    state.config = {
      ...defaultTrackerConfig(state.config.mode, state.config.autoLapM),
      ...state.config,
    };
    state.hasGpsLock ??= state.warmupCount >= state.config.warmupSamples;
    state.lastSampleMs ??= state.lastAcceptedMs ?? null;
    state.lastAccuracyM ??= state.lastPoint?.accuracyM ?? null;
    // a run started before rest laps existed restores as an effort
    state.lapKind ??= 'work';
    state.laps = (state.laps ?? []).map((lap) => ({ ...lap, kind: lap.kind ?? 'work' }));
    if (state.pausedAtMs != null) {
      state.totalPausedMs = (state.totalPausedMs ?? 0) + Math.max(0, snapshot.savedAtMs - state.pausedAtMs);
      state.pausedAtMs = null;
    }
    if (state.autoPausedAtMs != null) {
      const closedAutoPauseMs = Math.max(0, snapshot.savedAtMs - state.autoPausedAtMs);
      state.totalAutoPausedMs = (state.totalAutoPausedMs ?? 0) + closedAutoPauseMs;
      state.lapAutoPausedMs = (state.lapAutoPausedMs ?? 0) + closedAutoPauseMs;
      state.autoPausedAtMs = null;
    }
    state.totalPausedMs ??= 0;
    state.lapPausedMs ??= 0;
    state.totalAutoPausedMs ??= 0;
    state.lapAutoPausedMs ??= 0;
    state.stationarySinceMs = null;
    state.lastPoint = null; // re-anchor after the gap
    return state;
  } catch {
    return null;
  }
}

export function restoreTrackerTrace(raw: string | null, expectedRunId?: string): GpsTracePoint[] {
  if (!raw) return [];
  try {
    const snapshot = JSON.parse(raw) as TrackerSnapshot & { runId?: string };
    if (snapshot.version !== 1 || !Array.isArray(snapshot.trace)) return [];
    const snapshotRunId = snapshot.runId ?? snapshot.state?.runId;
    if (expectedRunId && snapshotRunId !== expectedRunId) return [];
    return boundedTrace(snapshot.trace.filter((point) => (
      point
      && typeof point.t === 'number'
      && typeof point.lat === 'number'
      && typeof point.lon === 'number'
      && typeof point.accuracyM === 'number'
      && typeof point.decision === 'string'
      && typeof point.acceptedDistanceM === 'number'
      && typeof point.cumulativeDistanceM === 'number'
    )));
  } catch {
    return [];
  }
}

export function restoreFinishedRun(raw: string | null, nowMs: number): FinishedRun | null {
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as FinishedRunSnapshot;
    const run = snapshot.finishedRun;
    if (snapshot.version !== 2 || !run) return null;
    if (nowMs - snapshot.savedAtMs > FINISHED_RUN_RECOVERY_MAX_AGE_MS) return null;
    if (
      typeof run.runId !== 'string'
      || !['free', 'intervals', 'sprints'].includes(run.mode)
      || typeof run.startedAtMs !== 'number'
      || typeof run.endedAtMs !== 'number'
      || typeof run.totalDistanceM !== 'number'
      || typeof run.elapsedS !== 'number'
      || !Array.isArray(run.laps)
      || !Array.isArray(run.reps)
    ) return null;
    return run;
  } catch {
    return null;
  }
}
