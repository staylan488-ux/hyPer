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
  currentSpeedMps,
  elapsedSeconds,
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
import { isNativeIOS, NativeRun } from '@/lib/nativeBridge';

const RUN_MODE_LABELS: Record<RunMode, string> = {
  free: 'Long run',
  intervals: 'Splits',
  sprints: 'Sprint session',
};

const MODE_OPTIONS: { value: RunMode; label: string }[] = [
  { value: 'free', label: RUN_MODE_LABELS.free },
  { value: 'intervals', label: RUN_MODE_LABELS.intervals },
];

type AutoLapChoice = '100' | '200' | '400' | '1600' | 'off' | 'custom';

const AUTO_LAP_OPTIONS: { value: AutoLapChoice; label: string }[] = [
  { value: '100', label: 'Every 100 m' },
  { value: '200', label: 'Every 200 m' },
  { value: '400', label: 'Every 400 m' },
  { value: '1600', label: 'Every 1600 m' },
  { value: 'off', label: 'Manual only' },
  { value: 'custom', label: 'Custom distance' },
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

async function exportGpsDiagnostics(
  run: NonNullable<ReturnType<typeof useRunTracker>['finishedRun']>,
): Promise<void> {
  const { trace = [], ...summary } = run;
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    summary,
    trace,
  };
  const content = JSON.stringify(payload, null, 2);
  const filename = `hyper-gps-${new Date(run.startedAtMs).toISOString().replace(/[:.]/g, '-')}.json`;
  if (isNativeIOS()) {
    await NativeRun.shareDiagnostics({ filename, content });
    return;
  }
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [customAutoLapM, setCustomAutoLapM] = useState('300');
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(preview && !appSandbox ? 'steady5k' : 'gps');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

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
    const splitDistanceM = autoLap === 'off'
      ? null
      : autoLap === 'custom'
        ? Number(customAutoLapM)
        : Number(autoLap);
    tracker.start(mode, splitDistanceM, buildSource());
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
  const effectivelyPaused = tracker.resting;
  const rollingPace = running && !effectivelyPaused ? rollingPaceSecPerMile(state, tracker.nowMs) : null;
  const averagePace = running ? averagePaceSecPerMile(state, tracker.nowMs) : null;
  // Core Location speed is filtered by the reducer's EMA and expires after a
  // callback gap. It is the most responsive trustworthy "now" pace; the
  // distance-window pace remains the fallback.
  const liveSpeedMps = running && !effectivelyPaused ? currentSpeedMps(state, tracker.nowMs) : null;
  const currentPace = liveSpeedMps != null && liveSpeedMps > 0.3 ? MILE_M / liveSpeedMps : null;
  const pace = currentPace ?? rollingPace ?? (state?.config.mode === 'free' ? averagePace : null);
  const paceLabel = effectivelyPaused ? '—' : formatRunPace(pace) ?? '—';
  const elapsedLabel = running ? formatClockDuration(elapsedSeconds(state, tracker.nowMs)) : '0:00';
  const distanceLabel = running ? formatMeters(state.totalDistanceM) : '0 m';
  const warming = running ? isWarmingUp(state) : false;
  const weak = running ? isGpsWeak(state, tracker.nowMs) : false;

  const lastLap = running && state.laps.length > 0 ? state.laps[state.laps.length - 1] : null;
  const lastRep = running && state.reps.length > 0 ? state.reps[state.reps.length - 1] : null;

  // paused: freeze the pace readout, and don't let a screen tap split
  const customAutoLapValid = autoLap !== 'custom'
    || (Number.isFinite(Number(customAutoLapM)) && Number(customAutoLapM) >= 10 && Number(customAutoLapM) <= 100_000);

  useEffect(() => {
    if (!state || state.status !== 'running' || !isNativeIOS()) return;
    void NativeRun.syncLiveActivity({
      runId: state.runId,
      mode: state.config.mode === 'intervals' ? 'intervals' : 'free',
      distanceM: state.totalDistanceM,
      elapsedS: elapsedSeconds(state, tracker.nowMs),
      livePace: paceLabel,
      averagePace: formatRunPace(averagePace) ?? '—',
      isResting: tracker.resting,
    }).catch(() => undefined);
  }, [
    averagePace,
    paceLabel,
    running,
    state,
    tracker.nowMs,
    tracker.resting,
  ]);

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
          isRest: lap.kind === 'rest',
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
                <span>{'isRest' in split && split.isRest ? '·' : split.key}</span>
                <span>{formatClockDuration(split.durationS) ?? '—'}</span>
                <span>{'isRest' in split && split.isRest ? 'rest' : formatMeters(split.distanceM)}</span>
                <span>
                  {'isRest' in split && split.isRest
                    ? '—'
                    : formatRunPace(paceSecondsPerMile(split.distanceM, split.durationS)) ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}

        {finishedRun.trace && finishedRun.trace.length > 0 && (
          <div className="mt-8 border-t border-[var(--color-border)] pt-4">
            <button
              type="button"
              className="pressable t-label-sm min-h-11 text-[var(--color-muted)]"
              onClick={() => {
                setExportError(null);
                void exportGpsDiagnostics(finishedRun).catch(() => {
                  setExportError('Could not open the export sheet. Try again.');
                });
              }}
            >
              Export private GPS diagnostics
            </button>
            <p className="t-caption mt-1">Coordinates stay on this device unless you export them.</p>
            {exportError && <p className="t-caption mt-1 text-[var(--color-accent)]">{exportError}</p>}
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
        className="fixed inset-0 z-40 h-dvh overflow-hidden flex flex-col px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-[var(--color-base)] max-w-lg mx-auto select-none overscroll-none"
      >
        <div className="flex items-baseline justify-between">
          <span className="t-label-sm">
            {RUN_MODE_LABELS[state.config.mode]}
          </span>
          <span className={`t-label-sm ${tracker.resting || warming || weak ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}>
            {tracker.resting
              ? 'resting'
              : warming
                ? 'acquiring gps'
                : weak
                  ? 'gps weak'
                  : 'gps ok'}
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
                <p className="t-label-sm">{tracker.resting ? 'Resting' : `Lap ${state.laps.length + 1}`}</p>
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

        </div>

        <div className="flex items-center gap-3">
          {state.config.mode === 'intervals' && !tracker.resting && (
            <button
              type="button"
              className="min-h-14 px-4 border border-[var(--color-border-strong)] t-label text-[var(--color-text)] shrink-0"
              onClick={() => { tapHaptic(); tracker.split(); }}
            >
              Split
            </button>
          )}
          <button
            type="button"
            className="min-h-14 px-4 border border-[var(--color-border-strong)] t-label text-[var(--color-text)] shrink-0"
            onClick={() => { tapHaptic(); tracker.toggleRest(); }}
          >
            {tracker.resting ? 'Resume' : 'Rest'}
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
    <motion.div className="fixed inset-0 z-40 h-dvh overflow-hidden px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-[var(--color-base)] max-w-lg mx-auto flex flex-col overscroll-none" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
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
          <p className="t-caption mt-2">Use the Split button anytime, or let distance trigger it.</p>
          {autoLap === 'custom' && (
            <label className="block mt-3">
              <span className="t-label-sm block mb-2">Custom metres</span>
              <input
                type="number"
                inputMode="numeric"
                min={10}
                max={100000}
                step={1}
                value={customAutoLapM}
                onChange={(event) => setCustomAutoLapM(event.target.value)}
                className="w-full min-h-12 border border-[var(--color-border-strong)] bg-transparent px-4 t-data"
                aria-invalid={!customAutoLapValid}
              />
              {!customAutoLapValid && (
                <span className="t-caption mt-1 block text-[var(--color-accent)]">Enter 10–100,000 m.</span>
              )}
            </label>
          )}
          <p className="t-caption mt-2">Automatic distances also work for hands-free sprint timing.</p>
        </div>
      )}

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

      <Button size="lg" className="w-full mt-auto" onClick={handleStart} disabled={tracker.resumable || !customAutoLapValid}>
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
