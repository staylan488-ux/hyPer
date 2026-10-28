// What the run tracker shows, shared by the web page (pages/RunTracker.tsx)
// and the native run screen: mode names, auto-split choices, pace and
// distance wording, the live status line, the finished run's splits and the
// private GPS diagnostics export. The engine itself is lib/runTracker.ts.
import {
  MILE_M,
  formatClockDuration,
  formatDistanceMi,
  formatPace,
  paceSecondsPerMile,
} from '@/lib/activityMetrics';
import {
  averagePaceSecPerMile,
  currentLapAveragePaceSecPerMile,
  isGpsWeak,
  isPaused,
  isWarmingUp,
  lapActiveSeconds,
  type FinishedRun,
  type RunMode,
  type TrackerState,
} from '@/lib/runTracker';

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  free: 'Long run',
  intervals: 'Splits',
  sprints: 'Sprint session',
};

/** The two modes a run can start in; legacy sprint sessions only display. */
export const RUN_MODE_OPTIONS: { value: RunMode; label: string }[] = [
  { value: 'free', label: RUN_MODE_LABELS.free },
  { value: 'intervals', label: RUN_MODE_LABELS.intervals },
];

export type AutoLapChoice = '100' | '200' | '400' | '1600' | 'off' | 'custom';

export const AUTO_LAP_OPTIONS: { value: AutoLapChoice; label: string }[] = [
  { value: '100', label: 'Every 100 m' },
  { value: '200', label: 'Every 200 m' },
  { value: '400', label: 'Every 400 m' },
  { value: '1600', label: 'Every 1600 m' },
  { value: 'off', label: 'Manual only' },
  { value: 'custom', label: 'Custom distance' },
];

export const DEFAULT_AUTO_LAP: AutoLapChoice = '400';
export const DEFAULT_CUSTOM_AUTO_LAP_M = '300';
export const CUSTOM_AUTO_LAP_MIN_M = 10;
export const CUSTOM_AUTO_LAP_MAX_M = 100_000;

/** A custom auto-split must be 10–100,000 m; the preset choices always pass. */
export function isAutoLapValid(choice: AutoLapChoice, customMetres: string): boolean {
  if (choice !== 'custom') return true;
  const metres = Number(customMetres);
  return Number.isFinite(metres) && metres >= CUSTOM_AUTO_LAP_MIN_M && metres <= CUSTOM_AUTO_LAP_MAX_M;
}

/** The split distance a run starts with: null for manual splits only. */
export function autoLapDistanceM(choice: AutoLapChoice, customMetres: string): number | null {
  if (choice === 'off') return null;
  return choice === 'custom' ? Number(customMetres) : Number(choice);
}

/** "every 400 m", "every 1,250 m" or "manual splits". */
export function autoLapPhrase(choice: AutoLapChoice, customMetres: string): string {
  if (choice === 'off') return 'manual splits';
  const metres = choice === 'custom' ? Number(customMetres) : Number(choice);
  return `every ${metres.toLocaleString('en-US')} m`;
}

/**
 * Pace as "7:59 /mi". The shared formatter drops anything over 60:00 as bad
 * imported data; a short live walk can start slower, so it reads "60:00+ /mi"
 * instead of an unstable three-digit estimate.
 */
export function formatRunPace(secondsPerMile: number | null): string | null {
  if (secondsPerMile == null || !Number.isFinite(secondsPerMile) || secondsPerMile <= 0) return null;
  if (secondsPerMile > 3600) return '60:00+ /mi';
  return formatPace(secondsPerMile);
}

/** Metres for sub-mile stretches (track words: "400 m"), miles beyond. */
export function formatRunDistance(distanceM: number): string {
  if (distanceM < MILE_M) return `${Math.round(distanceM)} m`;
  return formatDistanceMi(distanceM) ?? '0.00 mi';
}

/** "195 m" → ["195", "m"]; "7:59 /mi" → ["7:59", "/mi"]; "0:58" → ["0:58", ""]. */
export function splitFigure(label: string): [string, string] {
  const space = label.lastIndexOf(' ');
  return space > 0 ? [label.slice(0, space), label.slice(space + 1)] : [label, ''];
}

/** Whether a running tracker is resting: a pause in a long run, a rest lap in splits. */
export function isRunResting(state: TrackerState): boolean {
  return state.config.mode === 'free' ? isPaused(state) : state.lapKind === 'rest';
}

/**
 * The pace a live run shows: the current split's average, else the whole
 * run's average. Instantaneous pace jitters by a minute a mile between
 * samples and is the reading GPS bias distorts most. Null while resting.
 */
export function livePaceSecPerMile(state: TrackerState, nowMs: number): number | null {
  if (isRunResting(state)) return null;
  return currentLapAveragePaceSecPerMile(state, nowMs) ?? averagePaceSecPerMile(state, nowMs);
}

export type RunStatus = 'resting' | 'acquiring' | 'weak' | 'ok';

/** The live status line, most urgent first. */
export function runStatus(state: TrackerState, nowMs: number): RunStatus {
  if (isRunResting(state)) return 'resting';
  if (isWarmingUp(state)) return 'acquiring';
  if (isGpsWeak(state, nowMs)) return 'weak';
  return 'ok';
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  resting: 'resting',
  acquiring: 'acquiring gps',
  weak: 'gps weak',
  ok: 'gps ok',
};

export interface RunSplitRow {
  key: number;
  durationS: number;
  distanceM: number;
  isRest: boolean;
}

/** A finished run's splits (laps, or a legacy sprint session's reps), rests included. */
export function finishedRunSplits(run: FinishedRun): RunSplitRow[] {
  if (run.mode === 'sprints') {
    return run.reps.map((rep) => ({
      key: rep.index,
      durationS: (rep.endedAtMs - rep.startedAtMs) / 1000,
      distanceM: rep.distanceM,
      isRest: false,
    }));
  }
  return run.laps.map((lap) => ({
    key: lap.index,
    durationS: lapActiveSeconds(lap),
    distanceM: lap.distanceM,
    isRest: lap.kind === 'rest',
  }));
}

/** A split's pace, or null for a rest or a split too short to pace. */
export function splitPaceSecPerMile(split: RunSplitRow): number | null {
  return split.isRest ? null : paceSecondsPerMile(split.distanceM, split.durationS);
}

/** The finished run's average pace. */
export function finishedRunPace(run: FinishedRun): string | null {
  return formatRunPace(paceSecondsPerMile(run.totalDistanceM, run.elapsedS));
}

/** "12:04" for a duration, or a dash. */
export function formatRunClock(seconds: number | null | undefined): string {
  return formatClockDuration(seconds) ?? '—';
}

/**
 * The private GPS diagnostics file for a finished run: its summary and route
 * trace as JSON. It stays on the device unless the person shares it.
 */
export function gpsDiagnosticsExport(run: FinishedRun, exportedAt: Date): { filename: string; content: string } {
  const { trace = [], ...summary } = run;
  const payload = {
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    summary,
    trace,
  };
  return {
    filename: `hyper-gps-${new Date(run.startedAtMs).toISOString().replace(/[:.]/g, '-')}.json`,
    content: JSON.stringify(payload, null, 2),
  };
}

/** Why a save failed, kept with the run until it is discarded. */
export function runSaveErrorMessage(error: unknown): string {
  const reason = error instanceof Error && error.message ? error.message : null;
  return reason
    ? `${reason} The run stays here until you discard it.`
    : 'Could not save the run. It stays here until you discard it.';
}
