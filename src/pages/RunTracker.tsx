// Chromeless live run tracker (/train/run). Two startable modes: a continuous
// run with live/average pace, and a split run where the whole screen is the
// split button (plus optional distance auto-splits). Legacy sprint state stays
// readable so an old interrupted or saved run is not corrupted.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button, SegmentedControl, SelectSheet } from '@/components/shared';
import { LapPaceChart } from '@/components/shared/charts';
import { useAppStore } from '@/stores/appStore';
import { useRunTracker, createSimulatedSource, type PositionSource } from '@/hooks/useRunTracker';
import {
  averagePaceSecPerMile,
  currentLapAveragePaceSecPerMile,
  currentLapDistanceM,
  currentLapSeconds,
  elapsedSeconds,
  isGpsWeak,
  isWarmingUp,
  lapActiveSeconds,
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
      className={`relative material-inset rounded-[var(--radius-capsule)] w-full min-h-20 overflow-hidden select-none touch-none transition-transform duration-75 active:scale-[0.96] ${holding ? 'liquid-metal' : 'metal-static'}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        begin();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="relative block px-3 t-label text-[12px]! leading-snug text-[var(--color-text)]">
        {holding ? 'Keep holding…' : 'Hold to finish'}
      </span>
      {/* The fill is polished metal sweeping across; its own copy of the label
          stays aligned with the one beneath, so the words read on both. */}
      <motion.span
        aria-hidden
        className="absolute inset-0 z-[1] flex items-center justify-center bg-[var(--button-primary-bg)] rail-metal"
        initial={false}
        animate={{ clipPath: holding ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)' }}
        transition={holding ? { duration: HOLD_TO_FINISH_MS / 1000, ease: 'linear' } : { duration: 0.15 }}
      >
        <span className="block px-3 t-label text-[12px]! leading-snug text-[var(--color-base)]">
          {holding ? 'Keep holding…' : 'Hold to finish'}
        </span>
      </motion.span>
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
      // Surface WHY. A bare "could not save" on a phone leaves the run stuck
      // with nothing to act on and no console to read.
      console.error('Error saving tracked run:', error);
      const reason = error instanceof Error && error.message ? error.message : null;
      setSaveError(reason
        ? `${reason} The run stays here until you discard it.`
        : 'Could not save the run. It stays here until you discard it.');
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
  const averagePace = running ? averagePaceSecPerMile(state, tracker.nowMs) : null;
  const lapAveragePace = running && !effectivelyPaused
    ? currentLapAveragePaceSecPerMile(state, tracker.nowMs)
    : null;
  // Both modes show the average pace for the CURRENT SPLIT. Instantaneous pace
  // jitters by a minute per mile between samples, which is unreadable at a
  // glance and, per the track calibration, is the reading most distorted by the
  // speed-dependent GPS bias. Until the first split has enough distance to mean
  // anything, fall back to the whole-run average rather than showing nothing.
  const pace = lapAveragePace ?? averagePace;
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
      <motion.div className="min-h-dvh px-6 pt-10 pb-10 max-w-lg mx-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={springs.settle}>
        <p className="t-label">Run complete</p>
        <h1 className="t-title mt-3">
          {RUN_MODE_LABELS[finishedRun.mode]}
        </h1>

        <section className="platter mt-6">
          <p className="t-label">Distance</p>
          <p className="t-data-hero mt-2">{formatMeters(finishedRun.totalDistanceM)}</p>
          <div className="grid grid-cols-2 mt-5 pt-4 shadow-[inset_0_1px_0_var(--platter-divider)]">
            <div>
              <p className="t-label-sm">Time</p>
              <p className="t-data-lg text-[18px]! mt-1">{formatClockDuration(finishedRun.elapsedS)}</p>
            </div>
            <div className="pl-5 shadow-[inset_1px_0_0_var(--platter-divider)]">
              <p className="t-label-sm">Avg pace</p>
              <p className="t-data-lg text-[18px]! mt-1">
                {formatRunPace(paceSecondsPerMile(finishedRun.totalDistanceM, finishedRun.elapsedS)) ?? '—'}
              </p>
            </div>
          </div>
        </section>

        {splits.length > 1 && (
          <section className="platter mt-4">
            <p className="t-label mb-4">Splits</p>
            <LapPaceChart
              className="mb-5"
              laps={splits}
              formatPace={formatRunPace}
              formatDistance={(meters) => (meters == null ? null : formatMeters(meters))}
              formatDuration={formatClockDuration}
            />
            <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 t-label-sm pb-2">
              <span>#</span>
              <span>Time</span>
              <span>Dist</span>
              <span>Pace</span>
            </div>
            {splits.map((split) => (
              <div key={split.key} className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 t-data-sm text-[var(--color-text-dim)] py-1.5 border-t border-[var(--color-border-soft)]">
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
          </section>
        )}

        {finishedRun.trace && finishedRun.trace.length > 0 && (
          <div className="mt-5 px-1">
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

        {saveError && <p className="t-caption mt-6 px-1 text-[var(--color-accent)]">{saveError}</p>}

        <div className="flex gap-3 mt-8">
          <Button variant="ghost" size="lg" className="flex-1" disabled={saving} onClick={handleDiscardAll}>
            Discard
          </Button>
          <Button size="lg" metal className="flex-[2]" loading={saving} onClick={() => { void handleSave(); }}>
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
        className="fixed inset-0 z-40 h-dvh overflow-hidden flex flex-col pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] max-w-lg mx-auto select-none overscroll-none"
        style={{ background: 'var(--material-ambient, none), var(--material-foundation, var(--color-base))' }}
      >
        <div className="flex items-center justify-between">
          <span className="t-label">
            {RUN_MODE_LABELS[state.config.mode]}
          </span>
          <span className={`t-label-sm inline-flex items-center gap-2 ${tracker.resting || warming || weak ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}>
            <span aria-hidden className="w-[5px] h-[5px] rounded-full bg-current" />
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

        <div className="flex-1 flex flex-col justify-center gap-4">
          <div className="px-1 pb-4">
            <p className="t-label">{state.config.mode === 'intervals' ? 'Lap pace' : 'Pace'}</p>
            <p className="t-data-hero text-[clamp(44px,16vw,68px)]! leading-none! mt-3">
              {paceLabel}
            </p>
          </div>

          <div className="platter grid grid-cols-3 px-0! py-4!">
            <div className="px-5">
              <p className="t-label-sm">Time</p>
              <p className="t-data-lg text-[20px]! mt-1.5">{elapsedLabel}</p>
            </div>
            <div className="px-4 shadow-[inset_1px_0_0_var(--platter-divider)]">
              <p className="t-label-sm">Distance</p>
              <p className="t-data-lg text-[20px]! mt-1.5">{distanceLabel}</p>
            </div>
            <div className="px-4 shadow-[inset_1px_0_0_var(--platter-divider)]">
              <p className="t-label-sm">Avg pace</p>
              <p className="t-data-lg text-[20px]! mt-1.5">{formatRunPace(averagePace) ?? '—'}</p>
            </div>
          </div>

          {state.config.mode === 'intervals' && (
            <div className="platter grid grid-cols-2 gap-6">
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
            <div className="platter grid grid-cols-2 gap-6">
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

        {/* Large tactile controls share one foreground material while the
            pace and session records stay directly on the foundation. */}
        <div className="material-toolbar glass-edge flex items-stretch gap-2.5 rounded-[var(--radius-capsule)]! p-2.5 -mx-3">
          {state.config.mode === 'intervals' && !tracker.resting && (
            <button
              type="button"
              className="material-button-secondary relative z-[1] rounded-[var(--radius-capsule)] min-h-20 min-w-0 flex-1 px-3 t-label text-[12px]! text-[var(--color-text)] shrink-0 transition-transform duration-75 active:scale-[0.96]"
              onClick={() => { tapHaptic(); tracker.split(); }}
            >
              Split
            </button>
          )}
          <button
            type="button"
            className="material-button-secondary relative z-[1] rounded-[var(--radius-capsule)] min-h-20 min-w-0 flex-1 px-3 t-label text-[12px]! text-[var(--color-text)] shrink-0 transition-transform duration-75 active:scale-[0.96]"
            onClick={() => { tapHaptic(); tracker.toggleRest(); }}
          >
            {tracker.resting ? 'Resume' : 'Rest'}
          </button>
          <div className="relative z-[1] flex-[1.35] min-w-0">
            <HoldToFinish onFinish={handleFinish} />
          </div>
        </div>
      </div>
    );
  }

  /* ── pre-start config ── */
  return (
    <motion.div className="fixed inset-0 z-40 h-dvh overflow-y-auto pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] max-w-lg mx-auto flex flex-col overscroll-none" style={{ background: 'var(--material-ambient, none), var(--material-foundation, var(--color-base))' }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={springs.settle}>
      <p className="t-label">Field tracker</p>
      <h1 className="t-title mt-3">Run</h1>

      {tracker.resumable && (
        <div className="platter mt-6">
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

      <div className="mt-7">
        <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} />
      </div>

      {mode === 'intervals' && (
        <div className="platter mt-4">
          <label className="t-label block mb-3">Auto-split</label>
          <SelectSheet value={autoLap} onChange={setAutoLap} options={AUTO_LAP_OPTIONS} title="Auto-split distance" />
          <p className="t-caption mt-2">Use the Split button anytime, or let distance trigger it.</p>
          {autoLap === 'custom' && (
            <label className="block mt-3">
              <span className="t-label block mb-2">Custom metres</span>
              <input
                type="number"
                inputMode="numeric"
                min={10}
                max={100000}
                step={1}
                value={customAutoLapM}
                onChange={(event) => setCustomAutoLapM(event.target.value)}
                className="material-inset rounded-[var(--radius-control)] w-full min-h-12 px-4 t-data text-[16px]!"
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
        <div className="platter mt-4">
          <label className="t-label block mb-3">Position source</label>
          <SelectSheet
            value={sourceChoice}
            onChange={setSourceChoice}
            options={sourceOptions}
            title="Position source"
          />
        </div>
      )}

      {tracker.gpsError && <p className="t-caption mt-4 px-1 text-[var(--color-accent)]">{tracker.gpsError}</p>}

      <div className="flex-1 min-h-8 flex flex-col items-center justify-center py-6">
        <Button
          size="lg"
          metal
          className="rounded-full! w-[168px] h-[168px] text-[13px]! tracking-[0.24em]! shrink-0"
          onClick={handleStart}
          disabled={tracker.resumable || !customAutoLapValid}
        >
          Start
        </Button>
        <p className="t-caption mt-5 text-center">
          {tracker.resumable
            ? 'Resume or discard the interrupted run before starting another.'
            : `${RUN_MODE_LABELS[mode]} · ${sourceChoice === 'gps' ? 'GPS' : 'Simulated GPS'}`}
        </p>
      </div>

      <button
        type="button"
        className="pressable t-label-sm min-h-11 w-full text-center text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
        onClick={() => navigate(-1)}
      >
        Back
      </button>
    </motion.div>
  );
}
