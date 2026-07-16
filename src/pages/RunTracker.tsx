// Chromeless live run tracker (/train/run). Three modes: free run with live
// rolling pace, intervals where the WHOLE screen is the split button (plus
// optional auto-splits by distance), and hands-free sprint detection. The
// bottom nav hides itself on this route; finishing requires an 800ms hold so
// a sweaty mid-run tap can't end the workout.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Button, SegmentedControl, SelectSheet } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useRunTracker, createSimulatedSource, type PositionSource } from '@/hooks/useRunTracker';
import {
  currentLapDistanceM,
  currentLapSeconds,
  elapsedSeconds,
  isGpsWeak,
  isWarmingUp,
  lapActiveSeconds,
  rollingPaceSecPerMile,
  type FinishedRun,
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

const MODE_OPTIONS: { value: RunMode; label: string }[] = [
  { value: 'free', label: 'Free run' },
  { value: 'intervals', label: 'Intervals' },
  { value: 'sprints', label: 'Sprints' },
];

type AutoLapChoice = 'off' | '200' | '400' | '800' | '1000';

const AUTO_LAP_OPTIONS: { value: AutoLapChoice; label: string }[] = [
  { value: 'off', label: 'Manual splits only' },
  { value: '200', label: 'Every 200 m' },
  { value: '400', label: 'Every 400 m' },
  { value: '800', label: 'Every 800 m' },
  { value: '1000', label: 'Every 1 km' },
];

type SourceChoice = 'gps' | 'steady5k' | 'intervals8x400' | 'sprints6';

const SIMULATOR_TIME_SCALE = 10;

// meters for sub-mile stretches (track vocabulary: "400 m"), miles beyond
function formatMeters(distanceM: number): string {
  if (distanceM < MILE_M) return `${Math.round(distanceM)} m`;
  return formatDistanceMi(distanceM) ?? '0.00 mi';
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
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(preview && !appSandbox ? 'steady5k' : 'gps');
  const [finishedRun, setFinishedRun] = useState<FinishedRun | null>(null);
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
    setFinishedRun(null);
    setSaveError(null);
    tracker.start(mode, autoLap === 'off' ? null : Number(autoLap), buildSource());
  };

  const handleFinish = useCallback(() => {
    const run = tracker.finish();
    if (run) setFinishedRun(run);
  }, [tracker]);

  const handleSave = async () => {
    if (!finishedRun || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await saveTrackedRun(finishedRun);
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
    setFinishedRun(null);
    setSaveError(null);
  };

  const state = tracker.state;
  const running = state?.status === 'running';

  /* ── live derived values ── */
  const pace = running && !tracker.paused ? rollingPaceSecPerMile(state, tracker.nowMs) : null;
  const paceLabel = tracker.paused ? '—' : pace != null ? formatPace(pace) : '—';
  const elapsedLabel = running ? formatClockDuration(elapsedSeconds(state, tracker.nowMs)) : '0:00';
  const distanceLabel = running ? formatMeters(state.totalDistanceM) : '0 m';
  const warming = running ? isWarmingUp(state) : false;
  const weak = running ? isGpsWeak(state, tracker.nowMs) : false;

  const lastLap = running && state.laps.length > 0 ? state.laps[state.laps.length - 1] : null;
  const lastRep = running && state.reps.length > 0 ? state.reps[state.reps.length - 1] : null;

  // paused: freeze the pace readout, and don't let a screen tap split
  const paused = tracker.paused;
  const screenTapSplit = running && state.config.mode === 'intervals' && !paused;

  /* ── finished summary ── */
  if (finishedRun) {
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
          {MODE_OPTIONS.find((option) => option.value === finishedRun.mode)?.label}
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
              {formatPace(paceSecondsPerMile(finishedRun.totalDistanceM, finishedRun.elapsedS)) ?? '—'}
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
                <span>{formatPace(paceSecondsPerMile(split.distanceM, split.durationS)) ?? '—'}</span>
              </div>
            ))}
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
            {MODE_OPTIONS.find((option) => option.value === state.config.mode)?.label}
          </span>
          <span className={`t-label-sm ${paused ? 'text-[var(--color-accent)]' : warming || weak ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}>
            {paused ? 'paused' : warming ? 'acquiring gps' : weak ? 'gps weak' : 'gps ok'}
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

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="t-label-sm">Time</p>
              <p className="t-data-lg mt-1">{elapsedLabel}</p>
            </div>
            <div>
              <p className="t-label-sm">Distance</p>
              <p className="t-data-lg mt-1">{distanceLabel}</p>
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

      {mode === 'sprints' && (
        <p className="t-caption mt-6">
          Sprints are detected automatically from your speed — stow the phone and run. Each burst
          becomes one rep.
        </p>
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

      <Button size="lg" className="w-full mt-10" onClick={handleStart}>
        Start
      </Button>

      <button
        type="button"
        className="pressable t-label-sm mt-6 w-full text-center text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
        onClick={() => navigate(-1)}
      >
        Back
      </button>
    </motion.div>
  );
}
