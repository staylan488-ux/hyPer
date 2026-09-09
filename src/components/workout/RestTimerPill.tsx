import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Modal, RailStrip, RollingNumber } from '@/components/shared';
import { springs } from '@/lib/animations';
import { completionHaptic, tapHaptic } from '@/lib/haptics';
import { cancelRestEndNotification, scheduleRestEndNotification } from '@/lib/restNotifications';
import { syncWorkoutActivityRest } from '@/lib/liveActivity';
import {
  clearRestTimerSession,
  createRestTimerSession,
  getRestTimerRemainingSeconds,
  isRestTimerForWorkout,
  parseRestInput,
  pauseRestTimerSession,
  playRestTimerSound,
  readRestTimerSession,
  resumeRestTimerSession,
  saveRestTimerSession,
  syncRestTimerSession,
  type RestTimerSession,
} from '@/lib/restTimer';
import './rest-timer.css';

interface RestTimerPillProps {
  workoutId: string;
  /** Bump to start a fresh timer (new set logged) */
  sessionSeed?: number;
  defaultSeconds?: number;
  /** "Bench Press · set 3" — names the upcoming set in the end-of-rest
   *  notification. Omitted for manual timers (no known next set). */
  nextUpLabel?: string | null;
  onDismiss: () => void;
  /** Fired when the user explicitly picks a new duration (preset). */
  onDurationChange?: (seconds: number) => void;
}

const PRESET_TIMES = [60, 120, 180, 300];

function getInitialSession(workoutId: string, defaultSeconds: number, sessionSeed: number): RestTimerSession {
  const storedSession = readRestTimerSession();
  const syncedSession = storedSession ? syncRestTimerSession(storedSession) : null;

  if (sessionSeed > 0 || !syncedSession || !isRestTimerForWorkout(syncedSession, workoutId)) {
    const nextSession = createRestTimerSession(workoutId, defaultSeconds);
    saveRestTimerSession(nextSession);
    return nextSession;
  }

  saveRestTimerSession(syncedSession);
  return syncedSession;
}

function formatTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Compact recovery bar stays available while the workout and set entry remain
 * usable. Timer options live in a sheet; the session persists across navigation.
 */
export function RestTimerPill({ workoutId, sessionSeed = 0, defaultSeconds = 90, nextUpLabel = null, onDismiss, onDurationChange }: RestTimerPillProps) {
  const [session, setSession] = useState<RestTimerSession | null>(() => getInitialSession(workoutId, defaultSeconds, sessionSeed));
  const [expanded, setExpanded] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState(false);
  const completionHandledRef = useRef(false);
  const barRef = useRef<HTMLElement>(null);

  const isRunning = session?.status === 'running';

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--workout-rest-height', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--workout-rest-height');
    };
  }, [nextUpLabel, isRunning]);

  useEffect(() => {
    if (!isRunning) return;

    const sync = () => {
      setSession((current) => {
        if (!current) return current;
        const nextSession = syncRestTimerSession(current);
        saveRestTimerSession(nextSession);
        return nextSession;
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    const intervalId = window.setInterval(sync, 1000);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pageshow', sync);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pageshow', sync);
    };
  }, [isRunning]);

  useEffect(() => {
    if (session?.status !== 'completed' || completionHandledRef.current) return;

    completionHandledRef.current = true;

    completionHaptic();
    void playRestTimerSound();
  }, [session]);

  // Mirror the running timer into a scheduled iOS notification so "rest over"
  // still reaches the user if the app is backgrounded or the phone is locked.
  // Running → (re)schedule at the absolute end time; paused/completed/replaced
  // → cancel. Keyed on endsAt, not the session object, so the once-a-second
  // sync tick doesn't reschedule.
  const sessionStatus = session?.status;
  const sessionStartedAt = session?.startedAt;
  const sessionEndsAt = session?.endsAt;

  useEffect(() => {
    if (sessionStatus === 'running' && sessionStartedAt && sessionEndsAt) {
      void scheduleRestEndNotification(sessionEndsAt, nextUpLabel);
      syncWorkoutActivityRest({ startedAtIso: sessionStartedAt, endsAtIso: sessionEndsAt });
    } else {
      void cancelRestEndNotification();
      syncWorkoutActivityRest(null);
    }
  }, [sessionStatus, sessionStartedAt, sessionEndsAt, nextUpLabel]);

  // Dismissed or unmounted (workout finished, navigation) — the workout session
  // stays up; only the rest state clears. Workout.tsx owns that lifecycle.
  useEffect(() => () => {
    void cancelRestEndNotification();
    syncWorkoutActivityRest(null);
  }, []);

  // Keep the screen awake while a rest timer is running, so the phone can sit
  // on the bench with the countdown visible. iOS releases the lock whenever the
  // page is hidden, so re-acquire on return. Fails quietly (e.g. Low Power Mode).
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
        // Wake lock denied (battery saver, unsupported) — timer still works.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [isRunning]);

  const timeLeft = session ? getRestTimerRemainingSeconds(session) : defaultSeconds;
  const seconds = session?.durationSeconds ?? defaultSeconds;
  const remainingRatio = seconds > 0 ? timeLeft / seconds : 0;
  const isWarning = timeLeft <= 10 && timeLeft > 0 && isRunning;
  const isComplete = timeLeft === 0;
  const isCustom = !PRESET_TIMES.includes(seconds);

  const handleReset = () => {
    tapHaptic();
    const nextSession = pauseRestTimerSession(createRestTimerSession(workoutId, seconds));
    saveRestTimerSession(nextSession);
    setSession(nextSession);
    completionHandledRef.current = false;
  };

  const handleSetTime = (newSeconds: number) => {
    tapHaptic();
    const nextSession = createRestTimerSession(workoutId, newSeconds);
    saveRestTimerSession(nextSession);
    setSession(nextSession);
    completionHandledRef.current = false;
    setCustomOpen(false);
    onDurationChange?.(newSeconds);
  };

  const handleOpenCustom = () => {
    tapHaptic();
    setCustomDraft(formatTime(seconds));
    setCustomError(false);
    setCustomOpen(true);
  };

  const handleCustomSubmit = () => {
    const parsed = parseRestInput(customDraft);
    if (parsed === null) {
      setCustomError(true);
      return;
    }
    handleSetTime(parsed);
  };

  const handleToggleRunning = () => {
    if (!session) return;
    tapHaptic();

    const nextSession = session.status === 'running' ? pauseRestTimerSession(session) : resumeRestTimerSession(session);

    saveRestTimerSession(nextSession);
    setSession(nextSession);
  };

  const handleDismiss = () => {
    tapHaptic();
    clearRestTimerSession();
    setExpanded(false);
    onDismiss();
  };

  const tone = isWarning ? 'var(--color-accent)' : 'var(--color-text)';
  const statusLabel = isComplete ? 'Rest complete' : isRunning ? 'Rest' : 'Paused';

  return (
    <>
      {createPortal(<section ref={barRef} className="material-glass studio-rest-bar" aria-label="Rest timer">
        <button type="button" className="studio-rest-summary" onClick={() => setExpanded(true)}
          aria-label={`Open rest timer options, ${statusLabel.toLowerCase()}, ${formatTime(timeLeft)}${nextUpLabel ? `, next ${nextUpLabel}` : ''}`}
          aria-haspopup="dialog" aria-expanded={expanded}>
          <span className="studio-rest-countdown" style={{ color: tone }}><RollingNumber value={formatTime(timeLeft)} /></span>
          <span className="studio-rest-status">{statusLabel}</span>
          <span className="studio-rest-context">{nextUpLabel ? `Next · ${nextUpLabel}` : isComplete ? 'Ready when you are' : 'Tap timer for options'}</span>
        </button>
        {!isComplete && <button type="button" className="material-control studio-rest-pause" onClick={handleToggleRunning}
          aria-label={isRunning ? 'Pause rest timer' : 'Resume rest timer'}>{isRunning ? <Pause size={18} /> : <Play size={18} />}</button>}
        <button type="button" className="studio-rest-dismiss" onClick={handleDismiss}
          aria-label={isComplete ? 'Continue training' : 'Skip rest'}>{isComplete ? 'Continue' : 'Skip'}</button>
        <div className="studio-rest-bar-progress" role="progressbar" aria-label="Rest remaining" aria-valuemin={0} aria-valuemax={seconds} aria-valuenow={timeLeft} aria-valuetext={`${formatTime(timeLeft)} remaining`}><span style={{ width: `${Math.max(0, remainingRatio) * 100}%` }} /></div>
      </section>, document.body)}

      <Modal isOpen={expanded} onClose={() => { setExpanded(false); setCustomOpen(false); }} title="Rest timer">
        <div className="pt-1 pb-2">
          <div className="text-center mb-5">
            <motion.p
              className="t-data-hero"
              animate={{ color: tone }}
              transition={{ duration: 0.3 }}
            >
              <RollingNumber value={formatTime(timeLeft)} />
            </motion.p>
            <p className="t-label-sm mt-1">{isRunning ? 'Remaining' : isComplete ? 'Complete' : 'Paused'}</p>
            {nextUpLabel && <p className="mt-3 text-xs text-[var(--color-text-dim)]">Next · {nextUpLabel}</p>}
          </div>

          <RailStrip
            value={isComplete ? 1 : remainingRatio}
            tone={isComplete ? 'sage' : isWarning ? 'berry' : 'amber'}
            size="lg"
            className="mb-6"
          />

          <div className="flex justify-center gap-2.5 mb-6">
            <button
              type="button"
              onClick={handleToggleRunning}
              disabled={isComplete}
              className="pressable flex items-center justify-center min-w-[52px] min-h-[52px] rounded-[11px] material-control text-[var(--color-text)] disabled:opacity-40"
              aria-label={isRunning ? 'Pause' : 'Resume'}
            >
              {isRunning ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="pressable flex items-center justify-center min-w-[52px] min-h-[52px] rounded-[11px] material-control text-[var(--color-muted)] hover:text-[var(--color-text)]"
              aria-label="Restart timer"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-1.5 mb-5">
            {PRESET_TIMES.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleSetTime(preset)}
                className={`pressable rounded-[11px] min-h-11 t-data-sm transition-colors ${
                  !isCustom && seconds === preset
                    ? 'material-button-primary text-[var(--button-primary-fg)]'
                    : 'material-control text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                }`}
              >
                {preset >= 60 ? `${preset / 60}m` : `${preset}s`}
              </button>
            ))}
            <button
              type="button"
              onClick={handleOpenCustom}
              aria-label="Set a custom rest time"
              className={`pressable rounded-[11px] min-h-11 transition-colors ${
                isCustom
                  ? 'material-button-primary text-[var(--button-primary-fg)] t-data-sm tabular-nums'
                  : 'material-control text-[var(--color-text-dim)] hover:text-[var(--color-text)] t-label-sm'
              }`}
            >
              {isCustom ? formatTime(seconds) : 'Custom'}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {customOpen && (
              <motion.div
                key="custom-input"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={springs.smooth}
                className="overflow-hidden"
              >
                <div className="material-inset rounded-[11px] overflow-hidden flex items-stretch gap-px mb-2">
                  <input
                    type="text"
                    value={customDraft}
                    onChange={(event) => {
                      setCustomDraft(event.target.value);
                      setCustomError(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleCustomSubmit();
                    }}
                    placeholder="m:ss"
                    aria-label="Custom rest time, minutes and seconds"
                    aria-invalid={customError}
                    autoFocus
                    className={`flex-1 min-w-0 min-h-11 px-3 t-data-sm tabular-nums bg-transparent text-[var(--color-text)] placeholder:text-[var(--color-muted)] outline-none ${customError ? 'ring-1 ring-[var(--color-accent)]' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={handleCustomSubmit}
                    className="pressable min-h-11 px-5 material-control text-[var(--color-text)] t-label-sm hover:bg-[var(--button-primary-hover)] hover:text-[var(--button-primary-fg)] transition-colors"
                  >
                    Set
                  </button>
                </div>
                {customError && (
                  <p className="t-label-sm mb-3 text-[var(--color-accent)]">Try a time like 1:30 or 4:00 — 5s to 60min.</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            onClick={handleDismiss}
            className="pressable w-full min-h-12 rounded-[11px] material-control t-label text-[var(--color-text)] hover:bg-[var(--button-primary-hover)] hover:text-[var(--button-primary-fg)] transition-colors"
          >
            Done resting
          </button>
        </div>
      </Modal>
    </>
  );
}
