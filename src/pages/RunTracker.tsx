// Chromeless live run tracker (/train/run). Two startable modes: a continuous
// run with live/average pace, and a split run where the whole screen is the
// split button (plus optional distance auto-splits). Legacy sprint state stays
// readable so an old interrupted or saved run is not corrupted.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button, SegmentedControl, SelectSheet } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useRunTracker, createSimulatedSource, type PositionSource } from '@/hooks/useRunTracker';
import {
  averagePaceSecPerMile,
  currentLapDistanceM,
  currentLapSeconds,
  elapsedSeconds,
  gpsAccuracyMeters,
  isGpsWeak,
  isWarmingUp,
  lapActiveSeconds,
  rollingPaceSecPerMile,
  type RunMode,
} from '@/lib/runTracker';
import {
  MILE_M,
  formatClockDuration,
  formatDistanceMi,
  formatPace,
  paceSecondsPerMile,
} from '@/lib/activityMetrics';
import { gpsScenarios } from '@/lib/gpsScenarios';
import { isAppSandboxActive, isPreviewActive } from '@/preview/flag';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';

const RUN_MODE_LABELS: Record<RunMode, string> = {
  free: 'Long run',
  intervals: 'Splits',
  sprints: 'Sprint session',
};

const MODE_OPTIONS: { value: RunMode; label: string }[] = [
  { value: 'free', label: RUN_MODE_LABELS.free },
  { value: 'intervals', label: RUN_MODE_LABELS.intervals },
];

type AutoLapChoice = 'off' | '200' | '400' | '800' | '1000';

const AUTO_LAP_OPTIONS: { value: AutoLapChoice; label: string }[] = [
  { value: 'off', label: 'Manual splits only' },
  { value: '200', label: 'Every 200 m' },
  { value: '400', label: 'Every 400 m' },
  { value: '800', label: 'Every 800 m' },
  { value: '1000', label: 'Every 1 km' },
];

type SourceChoice = 'gps' | 'steady5k' | 'intervals8x400' | 'stationary';

const SIMULATOR_TIME_SCALE = 10;

function formatRunPace(secondsPerMile: number | null): string | null {
  if (secondsPerMile == null || !Number.isFinite(secondsPerMile) || secondsPerMile <= 0) return null;
  // The shared formatter rejects over 60:00 as likely bad imported data. A
  // short live walk can legitimately start slower, so keep feedback visible
  // without presenting an unstable three-digit estimate as precise.
  if (secondsPerMile > 3600) return '60:00+ /mi';
  return formatPace(secondsPerMile);
}

// meters for sub-mile stretches (track vocabulary: "400 m"), miles beyond
function formatMeters(distanceM: number): string {
  if (distanceM < MILE_M) return `${Math.round(distanceM)} m`;
  return formatDistanceMi(distanceM) ?? '0.00 mi';
}

function exportGpsDiagnostics(run: NonNullable<ReturnType<typeof useRunTracker>['finishedRun']>): void {
  const { trace = [], ...summary } = run;
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    summary,
    trace,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hyper-gps-${new Date(run.startedAtMs).toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const HOLD_TO_FINISH_MS = 800;

function HoldToFinish({ onFinish }: { onFinish: () => void }) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    setHolding(false);
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const begin = useCallback(() => {
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      tapHaptic();
      onFinish();
    }, HOLD_TO_FINISH_MS);
  }, [onFinish]);

  useEffect(() => cancel, [cancel]);

  return (
    <button
      type="button"
      className="relative w-full min-h-14 border border-[var(--color-border-strong)] overflow-hidden select-none touch-none"
      onPointerDown={(event) => {
        event.stopPropagation();
        begin();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={(event) => event.stopPropagation()}
    >
      <motion.span
        className="absolute inset-y-0 left-0 bg-[var(--color-text)]"
        initial={false}
        animate={{ width: holding ? '100%' : '0%' }}
        transition={holding ? { duration: HOLD_TO_FINISH_MS / 1000, ease: 'linear' } : { duration: 0.15 }}
      />
      <span
        className={`relative z-10 t-label transition-colors ${
          holding ? 'text-[var(--color-base)]' : 'text-[var(--color-text)]'
        }`}
      >
        {holding ? 'Keep holding…' : 'Hold to finish'}
      </span>
    </button>
  );
}

export function RunTracker() {
  const navigate = useNavigate();
  const { saveTrackedRun } = useAppStore();
  const tracker = useRunTracker();
  const preview = isPreviewActive();
  const appSandbox = isAppSandboxActive();

  const [mode, setMode] = useState<RunMode>('free');
  const [autoLap, setAutoLap] = useState<AutoLapChoice>('400');
  const [autoPause, setAutoPause] = useState(true);
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(preview && !appSandbox ? 'steady5k' : 'gps');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sourceOptions = useMemo(() => {
    const options: { value: SourceChoice; label: string }[] = [{ value: 'gps', label: 'Real GPS' }];
    if (preview) {
      for (const scenario of gpsScenarios) {
        options.push({ value: scenario.id as SourceChoice, label: `Sim: ${scenario.label} (${SIMULATOR_TIME_SCALE}×)` });
      }
    }
    return options;
  }, [preview]);

  const buildSource = useCallback((): PositionSource | undefined => {
    if (sourceChoice === 'gps') return undefined;
    const scenario = gpsScenarios.find((s) => s.id === sourceChoice);
    if (!scenario) return undefined;
    return createSimulatedSource(scenario.build(), SIMULATOR_TIME_SCALE);
  }, [sourceChoice]);

  const handleStart = () => {
    if (tracker.resumable) return;
    setSaveError(null);
    tracker.start(mode, autoLap === 'off' ? null : Number(autoLap), autoPause, buildSource());
  };

  const handleFinish = useCallback(() => {
    tracker.finish();
  }, [tracker]);

  const handleSave = async () => {
    if (!tracker.finishedRun || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveTrackedRun(tracker.finishedRun);
      if (!saved) {
        setSaveError('Could not save the run. It stays here until you discard it.');
        return;
      }
      tracker.discard();
      navigate('/history');
    } catch (error) {
      console.error('Error saving tracked run:', error);
      setSaveError('Could not save the run. It stays here until you discard it.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardAll = () => {
    tracker.discard();
    setSaveError(null);
  };

  const state = tracker.state;
  const running = state?.status === 'running';

  /* ── live derived values ── */
  const effectivelyPaused = tracker.paused || tracker.autoPaused;
  const rollingPace = running && !effectivelyPaused ? rollingPaceSecPerMile(state, tracker.nowMs) : null;
  const averagePace = running ? averagePaceSecPerMile(state, tracker.nowMs) : null;
  const pace = rollingPace ?? (state?.config.mode === 'free' ? averagePace : null);
  const paceLabel = effectivelyPaused ? '—' : formatRunPace(pace) ?? '—';
  const elapsedLabel = running ? formatClockDuration(elapsedSeconds(state, tracker.nowMs)) : '0:00';
  const distanceLabel = running ? formatMeters(state.totalDistanceM) : '0 m';
  const warming = running ? isWarmingUp(state) : false;
  const weak = running ? isGpsWeak(state, tracker.nowMs) : false;
  const accuracyM = running ? gpsAccuracyMeters(state) : null;

  const lastLap = running && state.laps.length > 0 ? state.laps[state.laps.length - 1] : null;
  const lastRep = running && state.reps.length > 0 ? state.reps[state.reps.length - 1] : null;

  // paused: freeze the pace readout, and don't let a screen tap split
  const paused = tracker.paused;
  const screenTapSplit = running && state.config.mode === 'intervals' && !paused && !tracker.autoPaused;

  /* ── finished summary ── */
  if (tracker.finishedRun) {
    const finishedRun = tracker.finishedRun;
    const splits = finishedRun.mode === 'sprints'
      ? finishedRun.reps.map((rep) => ({
          key: rep.index,
          durationS: (rep.endedAtMs - rep.startedAtMs) / 1000,
          distanceM: rep.distanceM,
        }))
      : finishedRun.laps.map((lap) => ({
          key: lap.index,
          durationS: lapActiveSeconds(lap),
          distanceM: lap.distanceM,
        }));

    return (
      <motion.div className="min-h-dvh px-6 pt-10 pb-10 max-w-lg mx-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={springs.smooth}>
        <p className="t-label-sm">Run complete</p>
        <h1 className="t-display text-[2rem] mt-2">
          {RUN_MODE_LABELS[finishedRun.mode]}
        </h1>

        <div className="grid grid-cols-3 gap-4 mt-8">
          <div>
            <p className="t-label-sm">Time</p>
            <p className="t-data-lg mt-1">{formatClockDuration(finishedRun.elapsedS)}</p>
          </div>
          <div>
            <p className="t-label-sm">Distance</p>
            <p className="t-data-lg mt-1">{formatMeters(finishedRun.totalDistanceM)}</p>
          </div>
          <div>
            <p className="t-label-sm">Avg pace</p>
            <p className="t-data-lg mt-1">
              {formatRunPace(paceSecondsPerMile(finishedRun.totalDistanceM, finishedRun.elapsedS)) ?? '—'}
            </p>
          </div>
        </div>

        {splits.length > 1 && (
          <div className="mt-8 border-t border-[var(--color-border)] pt-3">
            <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 t-label-sm text-[9px] pb-1">
              <span>#</span>
              <span>Time</span>
              <span>Dist</span>
              <span>Pace</span>
            </div>
            {splits.map((split) => (
              <div key={split.key} className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 t-data-sm text-[11px] text-[var(--color-text-dim)] py-0.5">
                <span>{split.key}</span>
                <span>{formatClockDuration(split.durationS) ?? '—'}</span>
                <span>{formatMeters(split.distanceM)}</span>
                <span>{formatRunPace(paceSecondsPerMile(split.distanceM, split.durationS)) ?? '—'}</span>
              </div>
            ))}
          </div>
        )}

        {finishedRun.quality && (
          <div className="mt-8 border-t border-[var(--color-border)] pt-4">
            <p className="t-label-sm">GPS trace quality</p>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <p className="t-caption">Typical accuracy</p>
                <p className="t-data mt-1">
                  {finishedRun.quality.averageAccuracyM != null ? `±${finishedRun.quality.averageAccuracyM} m` : '—'}
                </p>
              </div>
              <div>
                <p className="t-caption">Speed coverage</p>
                <p className="t-data mt-1">{finishedRun.quality.speedCoveragePct}%</p>
              </div>
              <div>
                <p className="t-caption">Longest gap</p>
                <p className="t-data mt-1">{finishedRun.quality.longestGapS.toFixed(1)} s</p>
              </div>
            </div>
            {finishedRun.quality.longestGapS > 8 && (
              <p className="t-caption mt-4 text-[var(--color-accent)]">
                Safari paused location updates for {finishedRun.quality.longestGapS.toFixed(1)} seconds. Distance across that gap may be low.
              </p>
            )}
            {finishedRun.trace && finishedRun.trace.length > 0 && (
              <button
                type="button"
                className="pressable t-label-sm mt-5 min-h-11 text-[var(--color-muted)]"
                onClick={() => exportGpsDiagnostics(finishedRun)}
              >
                Export private GPS diagnostics
              </button>
            )}
            <p className="t-caption mt-1">Coordinates stay on this device unless you export them.</p>
          </div>
        )}

        {saveError && <p className="t-caption mt-6 text-[var(--color-accent)]">{saveError}</p>}

        <div className="flex gap-3 mt-10">
          <Button variant="ghost" className="flex-1" disabled={saving} onClick={handleDiscardAll}>
            Discard
          </Button>
          <Button className="flex-1" loading={saving} onClick={() => { void handleSave(); }}>
            Save
          </Button>
        </div>
      </motion.div>
    );
  }

  /* ── live tracking ── */
  if (running) {
    return (
      <div
        className="min-h-dvh flex flex-col px-6 pt-10 pb-8 max-w-lg mx-auto select-none"
        onClick={screenTapSplit ? () => { tapHaptic(); tracker.split(); } : undefined}
      >
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">
            {RUN_MODE_LABELS[state.config.mode]}
          </span>
          <span className={`t-label-sm ${paused || tracker.autoPaused ? 'text-[var(--color-accent)]' : warming || weak ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}>
            {paused
              ? 'paused'
              : tracker.autoPaused
                ? 'auto paused'
              : warming
                ? `acquiring gps${accuracyM != null ? ` · ±${accuracyM}m` : ''}`
                : weak
                  ? `gps weak${accuracyM != null ? ` · ±${accuracyM}m` : ''}`
                  : `gps ok${accuracyM != null ? ` · ±${accuracyM}m` : ''}`}
          </span>
        </div>

        {tracker.gpsError && (
          <p className="t-caption mt-3 text-[var(--color-accent)]">{tracker.gpsError}</p>
        )}

        <div className="flex-1 flex flex-col justify-center gap-8">
          <div>
            <p className="t-label-sm">{state.config.mode === 'intervals' ? 'Lap pace' : 'Pace'}</p>
            <p className="t-data-hero mt-1 [font-family:var(--font-display)] text-[3.4rem] leading-none">
              {paceLabel}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="t-label-sm">Time</p>
              <p className="t-data-lg mt-1">{elapsedLabel}</p>
            </div>
            <div>
              <p className="t-label-sm">Distance</p>
              <p className="t-data-lg mt-1">{distanceLabel}</p>
            </div>
            <div>
              <p className="t-label-sm">Avg pace</p>
              <p className="t-data-lg mt-1">{formatRunPace(averagePace) ?? '—'}</p>
            </div>
          </div>

          {state.config.mode === 'intervals' && (
            <div className="grid grid-cols-2 gap-6 border-t border-[var(--color-border)] pt-5">
              <div>
                <p className="t-label-sm">Lap {state.laps.length + 1}</p>
                <p className="t-data mt-1">
                  {formatClockDuration(currentLapSeconds(state, tracker.nowMs))} • {formatMeters(currentLapDistanceM(state))}
                </p>
              </div>
              <div>
                <p className="t-label-sm">Last split</p>
                <p className="t-data mt-1">
                  {lastLap
                    ? `${formatClockDuration((lastLap.endedAtMs - lastLap.startedAtMs) / 1000)} • ${formatMeters(lastLap.distanceM)}`
                    : '—'}
                </p>
              </div>
            </div>
          )}

          {state.config.mode === 'sprints' && (
            <div className="grid grid-cols-2 gap-6 border-t border-[var(--color-border)] pt-5">
              <div>
                <p className="t-label-sm">Sprints</p>
                <p className="t-data-lg mt-1">
                  {state.reps.length}
                  {state.sprintPhase === 'active' && <span className="text-[var(--color-accent)]"> ●</span>}
                </p>
              </div>
              <div>
                <p className="t-label-sm">Last rep</p>
                <p className="t-data mt-1">
                  {lastRep
                    ? `${formatMeters(lastRep.distanceM)} • ${lastRep.peakSpeedMps.toFixed(1)} m/s peak`
                    : '—'}
                </p>
              </div>
            </div>
          )}

          {screenTapSplit && (
            <p className="t-caption text-center text-[var(--color-muted)]">Tap anywhere to split</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="min-h-14 px-6 border border-[var(--color-border-strong)] t-label text-[var(--color-text)] shrink-0"
            onClick={(event) => { event.stopPropagation(); tapHaptic(); tracker.togglePause(); }}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <div className="flex-1">
            <HoldToFinish onFinish={handleFinish} />
          </div>
        </div>
      </div>
    );
  }

  /* ── pre-start config ── */
  return (
    <motion.div className="min-h-dvh px-6 pt-10 pb-10 max-w-lg mx-auto" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
      <p className="t-label-sm">Field tracker</p>
      <h1 className="t-display text-[2rem] mt-2">Run</h1>

      {tracker.resumable && (
        <div className="mt-6 border border-[var(--color-border-strong)] p-4">
          <p className="t-heading">Run in progress</p>
          <p className="t-caption mt-1">A tracked run was interrupted. Pick it back up?</p>
          <div className="flex gap-3 mt-4">
            <Button variant="ghost" size="sm" className="flex-1" onClick={handleDiscardAll}>
              Discard
            </Button>
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => tracker.resume()}>
              Resume
            </Button>
          </div>
        </div>
      )}

      <div className="mt-8">
        <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} />
      </div>

      {mode === 'intervals' && (
        <div className="mt-6">
          <label className="t-label-sm block mb-2">Auto-split</label>
          <SelectSheet value={autoLap} onChange={setAutoLap} options={AUTO_LAP_OPTIONS} title="Auto-split distance" />
          <p className="t-caption mt-2">Splits also happen whenever you tap the screen mid-run.</p>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-5 border-t border-[var(--color-border)] pt-5">
        <div>
          <p className="t-heading">Auto-pause</p>
          <p className="t-caption mt-1">Exclude stops from time and average pace.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoPause}
          onClick={() => setAutoPause((value) => !value)}
          className={`pressable min-h-11 min-w-[5.5rem] border px-4 t-label-sm ${
            autoPause
              ? 'border-[var(--color-text)] bg-[var(--color-text)] text-[var(--color-base)]'
              : 'border-[var(--color-border-strong)] text-[var(--color-muted)]'
          }`}
        >
          {autoPause ? 'On' : 'Off'}
        </button>
      </div>

      {preview && !appSandbox && (
        <div className="mt-6">
          <label className="t-label-sm block mb-2">Position source</label>
          <SelectSheet
            value={sourceChoice}
            onChange={setSourceChoice}
            options={sourceOptions}
            title="Position source"
          />
        </div>
      )}

      {tracker.gpsError && <p className="t-caption mt-4 text-[var(--color-accent)]">{tracker.gpsError}</p>}

      <Button size="lg" className="w-full mt-10" onClick={handleStart} disabled={tracker.resumable}>
        Start
      </Button>

      {tracker.resumable && (
        <p className="t-caption mt-3 text-center">Resume or discard the interrupted run before starting another.</p>
      )}

      <button
        type="button"
        className="pressable t-label-sm mt-6 min-h-11 w-full text-center text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
        onClick={() => navigate(-1)}
      >
        Back
      </button>
    </motion.div>
  );
}
