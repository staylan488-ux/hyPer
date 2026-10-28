// Chromeless live run tracker (/train/run). Two startable modes: a continuous
// run with live/average pace, and a split run where the whole screen is the
// split button (plus optional distance auto-splits). Legacy sprint state stays
// readable so an old interrupted or saved run is not corrupted.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { SegmentedControl, SelectSheet } from '@/components/shared';
import { Eyebrow, HeroFigure, MetalSection, MetalTitle, useCommandCapsule, type CommandCapsuleSpec } from '@/components/metal';
import { LapPaceChart } from '@/components/shared/charts';
import { useAppStore } from '@/stores/appStore';
import { useRunTracker, createSimulatedSource, type PositionSource } from '@/hooks/useRunTracker';
import {
  averagePaceSecPerMile,
  currentLapDistanceM,
  currentLapSeconds,
  elapsedSeconds,
  isGpsWeak,
  isWarmingUp,
  type RunMode,
} from '@/lib/runTracker';
import { formatClockDuration } from '@/lib/activityMetrics';
import {
  AUTO_LAP_OPTIONS,
  DEFAULT_AUTO_LAP,
  DEFAULT_CUSTOM_AUTO_LAP_M,
  RUN_MODE_LABELS,
  RUN_MODE_OPTIONS,
  autoLapDistanceM,
  autoLapPhrase,
  finishedRunPace,
  finishedRunSplits,
  formatRunDistance as formatMeters,
  formatRunPace,
  gpsDiagnosticsExport,
  isAutoLapValid,
  livePaceSecPerMile,
  runSaveErrorMessage,
  splitFigure as figure,
  splitPaceSecPerMile,
  type AutoLapChoice,
} from '@/lib/runDisplay';
import { gpsScenarios } from '@/lib/gpsScenarios';
import { isAppSandboxActive, isPreviewActive } from '@/preview/flag';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';
import { isNativeIOS, NativeRun } from '@/lib/nativeBridge';
import './RunTracker.css';

type SourceChoice = 'gps' | 'steady5k' | 'intervals8x400' | 'stationary';

const SIMULATOR_TIME_SCALE = 10;

/** A labelled Fraunces figure with its unit in Geist. */
function Stat({ label, value }: { label: string; value: string }) {
  const [number, unit] = figure(value);
  return (
    <div className="min-w-0">
      <p className="metal-stat-label">{label}</p>
      <p className="metal-stat-value">{number}{unit && <small>{unit}</small>}</p>
    </div>
  );
}

async function exportGpsDiagnostics(
  run: NonNullable<ReturnType<typeof useRunTracker>['finishedRun']>,
): Promise<void> {
  const { filename, content } = gpsDiagnosticsExport(run, new Date());
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
      className={`run-control is-finish w-full${holding ? ' is-holding' : ''}`}
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
        className="run-hold-fill"
        initial={false}
        animate={{ width: holding ? '100%' : '0%' }}
        transition={holding ? { duration: HOLD_TO_FINISH_MS / 1000, ease: 'linear' } : { duration: 0.15 }}
      />
      <span className="run-control-label">
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
  const [autoLap, setAutoLap] = useState<AutoLapChoice>(DEFAULT_AUTO_LAP);
  const [customAutoLapM, setCustomAutoLapM] = useState(DEFAULT_CUSTOM_AUTO_LAP_M);
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
    tracker.start(mode, autoLapDistanceM(autoLap, customAutoLapM), buildSource());
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
      setSaveError(runSaveErrorMessage(error));
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
  // Both modes show the average pace for the CURRENT SPLIT, else the whole
  // run's average (lib/runDisplay).
  const pace = running ? livePaceSecPerMile(state, tracker.nowMs) : null;
  const paceLabel = effectivelyPaused ? '—' : formatRunPace(pace) ?? '—';
  const elapsedLabel = running ? formatClockDuration(elapsedSeconds(state, tracker.nowMs)) : '0:00';
  const distanceLabel = running ? formatMeters(state.totalDistanceM) : '0 m';
  const warming = running ? isWarmingUp(state) : false;
  const weak = running ? isGpsWeak(state, tracker.nowMs) : false;

  const lastLap = running && state.laps.length > 0 ? state.laps[state.laps.length - 1] : null;
  const lastRep = running && state.reps.length > 0 ? state.reps[state.reps.length - 1] : null;

  // paused: freeze the pace readout, and don't let a screen tap split
  const customAutoLapValid = isAutoLapValid(autoLap, customAutoLapM);

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

  /* ── the one primary action ── */
  // Start (or resume an interrupted run) before; Save after. The live run
  // keeps its own large controls, so it registers nothing.
  const autoLapLabel = autoLapPhrase(autoLap, customAutoLapM);
  const capsule: CommandCapsuleSpec | null = tracker.finishedRun
    ? {
        key: 'run-save',
        label: 'Save run',
        sublabel: saveError
          ? 'Couldn’t save · try again'
          : `${RUN_MODE_LABELS[tracker.finishedRun.mode]} · ${formatMeters(tracker.finishedRun.totalDistanceM)}`,
        alert: Boolean(saveError),
        glyph: 'check',
        busy: saving,
        dock: 'bottom',
        onPress: () => { void handleSave(); },
      }
    : running
      ? null
      : tracker.resumable
        ? {
            key: 'run-resume',
            label: 'Resume run',
            sublabel: 'Pick the interrupted run back up',
            glyph: 'arrow',
            dock: 'bottom',
            onPress: () => tracker.resume(),
          }
        : {
            key: 'run-start',
            label: 'Start run',
            sublabel: !customAutoLapValid
              ? 'Enter 10–100,000 m'
              : mode === 'intervals'
                ? `${RUN_MODE_LABELS.intervals} · ${autoLapLabel}`
                : `${RUN_MODE_LABELS.free} · live and average pace`,
            alert: !customAutoLapValid,
            disabled: !customAutoLapValid,
            glyph: 'arrow',
            dock: 'bottom',
            onPress: handleStart,
          };
  useCommandCapsule(capsule);

  /* ── finished summary ── */
  if (tracker.finishedRun) {
    const finishedRun = tracker.finishedRun;
    const splits = finishedRunSplits(finishedRun);
    const [distanceValue, distanceUnit] = figure(formatMeters(finishedRun.totalDistanceM));

    return (
      <motion.div className="metal-page run-page max-w-lg mx-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={springs.settle}>
        <header>
          <Eyebrow>Run complete</Eyebrow>
          <MetalTitle>{RUN_MODE_LABELS[finishedRun.mode]}</MetalTitle>
        </header>

        <HeroFigure value={distanceValue} caption={distanceUnit} />
        <div className="run-stats is-two mt-7">
          <Stat label="Time" value={formatClockDuration(finishedRun.elapsedS) ?? '—'} />
          <Stat
            label="Avg pace"
            value={finishedRunPace(finishedRun) ?? '—'}
          />
        </div>
        <p className="sr-only">Distance {formatMeters(finishedRun.totalDistanceM)}</p>

        {splits.length > 1 && (
          <MetalSection label="Splits" right={<b>{splits.filter((split) => !split.isRest).length}</b>}>
            <LapPaceChart
              className="mt-3 mb-6"
              laps={splits}
              formatPace={formatRunPace}
              formatDistance={(meters) => (meters == null ? null : formatMeters(meters))}
              formatDuration={formatClockDuration}
            />
            <div className="run-ledger-row is-head">
              <span>#</span>
              <span>Time</span>
              <span>Dist</span>
              <span>Pace</span>
            </div>
            {splits.map((split) => {
              const rest = split.isRest;
              return (
                <div key={split.key} className={`run-ledger-row${rest ? ' is-rest' : ''}`}>
                  <span className="text-[var(--metal-ink-3)]">{rest ? '·' : split.key}</span>
                  <span>{formatClockDuration(split.durationS) ?? '—'}</span>
                  <span>{rest ? 'rest' : formatMeters(split.distanceM)}</span>
                  <span>
                    {rest
                      ? '—'
                      : formatRunPace(splitPaceSecPerMile(split)) ?? '—'}
                  </span>
                </div>
              );
            })}
          </MetalSection>
        )}

        {finishedRun.trace && finishedRun.trace.length > 0 && (
          <MetalSection label="GPS diagnostics">
            <button
              type="button"
              className="metal-text-btn"
              onClick={() => {
                setExportError(null);
                void exportGpsDiagnostics(finishedRun).catch(() => {
                  setExportError('Could not open the export sheet. Try again.');
                });
              }}
            >
              Export private GPS diagnostics
            </button>
            <p className="metal-row-detail">Coordinates stay on this device unless you export them.</p>
            {exportError && <p className="metal-flag"><span>{exportError}</span></p>}
          </MetalSection>
        )}

        <div className="metal-section pt-2">
          {saveError && <p className="metal-flag mt-3"><span>{saveError}</span></p>}
          <button
            type="button"
            className="metal-text-btn is-quiet disabled:opacity-40"
            disabled={saving}
            onClick={handleDiscardAll}
          >
            Discard run
          </button>
        </div>
      </motion.div>
    );
  }

  /* ── live tracking ── */
  if (running) {
    const [paceValue, paceUnit] = figure(paceLabel);
    const alertStatus = tracker.resting || warming || weak;
    // A rest lap has no pace; its clock is the figure worth reading.
    const restHero = tracker.resting && state.config.mode === 'intervals';
    return (
      <div className="run-live fixed inset-0 z-40 h-dvh overflow-hidden flex flex-col max-w-lg mx-auto select-none overscroll-none">
        <div className="flex items-center justify-between gap-3 min-h-11">
          <Eyebrow live={!tracker.resting}>
            {RUN_MODE_LABELS[state.config.mode]}
          </Eyebrow>
          <span className={`metal-eyebrow ${alertStatus ? '!text-[var(--metal-red)]' : ''}`}>
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
          <p className="metal-flag mt-3"><span>{tracker.gpsError}</span></p>
        )}

        <div className="flex-1 flex flex-col justify-center">
          <div>
            <p className="metal-eyebrow">{restHero ? 'Rest' : state.config.mode === 'intervals' ? 'Lap pace' : 'Pace'}</p>
            <div className="metal-hero mt-3">
              <span className="metal-num">{restHero ? formatClockDuration(currentLapSeconds(state, tracker.nowMs)) : paceValue}</span>
              {!restHero && paceUnit && <span className="metal-hero-caption">{paceUnit}</span>}
            </div>
          </div>

          <div className="run-stats metal-rule mt-8 pt-5">
            <Stat label="Time" value={elapsedLabel ?? '0:00'} />
            <Stat label="Distance" value={distanceLabel} />
            <Stat label="Avg pace" value={formatRunPace(averagePace) ?? '—'} />
          </div>

          {state.config.mode === 'intervals' && (
            <div className="grid grid-cols-2 gap-6 metal-rule mt-6 pt-5">
              <div>
                <p className="metal-stat-label">{tracker.resting ? 'Resting' : `Lap ${state.laps.length + 1}`}</p>
                <p className="run-detail">
                  {formatClockDuration(currentLapSeconds(state, tracker.nowMs))} · {formatMeters(currentLapDistanceM(state))}
                </p>
              </div>
              <div>
                <p className="metal-stat-label">Last split</p>
                <p className="run-detail">
                  {lastLap
                    ? `${formatClockDuration((lastLap.endedAtMs - lastLap.startedAtMs) / 1000)} · ${formatMeters(lastLap.distanceM)}`
                    : '—'}
                </p>
              </div>
            </div>
          )}

          {state.config.mode === 'sprints' && (
            <div className="grid grid-cols-2 gap-6 metal-rule mt-6 pt-5">
              <div>
                <p className="metal-stat-label">Sprints</p>
                <p className="metal-stat-value">
                  {state.reps.length}
                  {state.sprintPhase === 'active' && <span className="text-[var(--metal-red)] text-[18px] align-middle"> ●</span>}
                </p>
              </div>
              <div>
                <p className="metal-stat-label">Last rep</p>
                <p className="run-detail">
                  {lastRep
                    ? `${formatMeters(lastRep.distanceM)} · ${lastRep.peakSpeedMps.toFixed(1)} m/s peak`
                    : '—'}
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Large hairline controls for running hands; finishing needs a hold. */}
        <div className="flex items-stretch gap-2.5">
          {state.config.mode === 'intervals' && !tracker.resting && (
            <button
              type="button"
              className="run-control is-primary"
              onClick={() => { tapHaptic(); tracker.split(); }}
            >
              Split
            </button>
          )}
          <button
            type="button"
            className="run-control"
            onClick={() => { tapHaptic(); tracker.toggleRest(); }}
          >
            {tracker.resting ? 'Resume' : 'Rest'}
          </button>
          <div className="flex-1 min-w-0 flex">
            <HoldToFinish onFinish={handleFinish} />
          </div>
        </div>
      </div>
    );
  }

  /* ── pre-start config ── */
  return (
    <motion.div className="metal-page run-page max-w-lg mx-auto" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={springs.settle}>
      <button
        type="button"
        className="metal-text-btn is-quiet run-back"
        onClick={() => navigate(-1)}
      >
        <ChevronLeft strokeWidth={1.5} aria-hidden />
        Back
      </button>

      <header className="mt-2">
        <MetalTitle note={mode === 'intervals' ? 'Split on demand or by distance.' : 'Live and average pace.'}>Run</MetalTitle>
      </header>

      {tracker.resumable && (
        <section className="metal-section">
          <div className="metal-section-head">
            <Eyebrow live>Run in progress</Eyebrow>
          </div>
          <p className="metal-note mt-1">A tracked run was interrupted. Pick it back up?</p>
          <p className="metal-row-detail mt-2">Resume or discard the interrupted run before starting another.</p>
          <button type="button" className="metal-text-btn is-quiet mt-1" onClick={handleDiscardAll}>
            Discard
          </button>
        </section>
      )}

      <MetalSection label="Mode">
        <SegmentedControl options={RUN_MODE_OPTIONS} value={mode} onChange={setMode} distribution="equal" className="mt-2" />
      </MetalSection>

      {mode === 'intervals' && (
        <MetalSection label="Auto-split">
          <div className="mt-2">
            <SelectSheet value={autoLap} onChange={setAutoLap} options={AUTO_LAP_OPTIONS} title="Auto-split distance" />
          </div>
          <p className="metal-row-detail mt-2">Use the Split button anytime, or let distance trigger it.</p>
          {autoLap === 'custom' && (
            <label className="block mt-4">
              <span className="t-label block mb-2">Custom metres</span>
              <input
                type="number"
                inputMode="numeric"
                min={10}
                max={100000}
                step={1}
                value={customAutoLapM}
                onChange={(event) => setCustomAutoLapM(event.target.value)}
                className="metal-input run-metres-input w-full min-h-12 px-4 text-[var(--metal-ink)] tabular-nums"
                aria-invalid={!customAutoLapValid}
              />
              {!customAutoLapValid && (
                <span className="metal-flag"><span>Enter 10–100,000 m.</span></span>
              )}
            </label>
          )}
          <p className="metal-row-detail mt-2">Automatic distances also work for hands-free sprint timing.</p>
        </MetalSection>
      )}

      {preview && !appSandbox && (
        <MetalSection label="Position source">
          <div className="mt-2">
            <SelectSheet
              value={sourceChoice}
              onChange={setSourceChoice}
              options={sourceOptions}
              title="Position source"
            />
          </div>
        </MetalSection>
      )}

      {tracker.gpsError && <p className="metal-flag mt-6"><span>{tracker.gpsError}</span></p>}
    </motion.div>
  );
}
