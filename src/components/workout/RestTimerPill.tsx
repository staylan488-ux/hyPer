import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, RotateCcw, Settings2 } from 'lucide-react';
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
 * Anchored recovery face shares the set-entry surface. The existing persisted timer,
 * notification and Live Activity lifecycle is retained; options stay in a sheet.
 */
export function RestTimerPill({ workoutId, sessionSeed = 0, defaultSeconds = 90, nextUpLabel = null, onDismiss, onDurationChange }: RestTimerPillProps) {
  const [session, setSession] = useState<RestTimerSession | null>(() => getInitialSession(workoutId, defaultSeconds, sessionSeed));
  const [expanded, setExpanded] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [customError, setCustomError] = useState(false);
  const completionHandledRef = useRef(false);

  const isRunning = session?.status === 'running';

  useEffect(() => {
    if (!isRunning) return;

    const intervalId = window.setInterval(() => {
      setSession((current) => {
        if (!current) return current;
        const nextSession = syncRestTimerSession(current);
        saveRestTimerSession(nextSession);
        return nextSession;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
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

  // Dismissed or unmounted (workout finished, navigation) — the session card
  // stays up; only the rest state clears. Workout.tsx owns the card lifecycle.
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

  const tone = isComplete ? 'var(--color-sage)' : isWarning ? 'var(--color-rose)' : 'var(--color-accent)';

  return (
    <>
      {createPortal(<section className="studio-workout-dock" aria-label="Rest timer">
        <div className="studio-composer-label"><span className="t-label">{isComplete ? 'Rest complete' : 'Recovery'}</span>
          <button type="button" onClick={() => setExpanded(true)} aria-label="Open rest timer options"><Settings2 size={17} /></button>
        </div>
        <div className="studio-rest-face">
          <div><div className="studio-rest-time"><RollingNumber value={formatTime(timeLeft)} /></div>
            <p className="studio-rest-next">{isComplete ? 'Ready when you are' : isRunning ? 'Time to recover' : 'Paused'}{nextUpLabel && <><br />Next · {nextUpLabel}</>}</p>
          </div>
          <div className="studio-rest-actions"><button type="button" onClick={handleToggleRunning} disabled={isComplete}
            aria-label={isRunning ? 'Pause rest timer' : 'Resume rest timer'}>{isRunning ? <Pause size={18} /> : <Play size={18} />}</button></div>
        </div>
        <button type="button" className="studio-save-set" onClick={handleDismiss}>{isComplete ? 'Continue training' : 'Skip rest'}<Play size={14} /></button>
        <div className="studio-rest-progress" role="progressbar" aria-label="Rest remaining" aria-valuemin={0} aria-valuemax={seconds} aria-valuenow={timeLeft}><span style={{width:`${Math.max(0, remainingRatio) * 100}%`}} /></div>
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
              className="pressable flex items-center justify-center min-w-[52px] min-h-[52px] rounded-[11px] bg-[var(--color-surface-2)] text-[var(--color-text)] disabled:opacity-40"
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
              className="pressable flex items-center justify-center min-w-[52px] min-h-[52px] rounded-[11px] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              aria-label="Restart timer"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-5 gap-px bg-[var(--color-border)] border border-[var(--color-border)] mb-5">
            {PRESET_TIMES.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleSetTime(preset)}
                className={`pressable min-h-11 t-data-sm transition-colors ${
                  !isCustom && seconds === preset
                    ? 'bg-[var(--color-text)] text-[var(--color-base)]'
                    : 'bg-[var(--color-surface-1)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]'
                }`}
              >
                {preset >= 60 ? `${preset / 60}m` : `${preset}s`}
              </button>
            ))}
            <button
              type="button"
              onClick={handleOpenCustom}
              aria-label="Set a custom rest time"
              className={`pressable min-h-11 transition-colors ${
                isCustom
                  ? 'bg-[var(--color-text)] text-[var(--color-base)] t-data-sm tabular-nums'
                  : 'bg-[var(--color-surface-1)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] t-label-sm'
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
                <div className="flex items-stretch gap-px bg-[var(--color-border)] border border-[var(--color-border)] mb-2">
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
                    className={`flex-1 min-w-0 min-h-11 px-3 t-data-sm tabular-nums bg-[var(--color-surface-1)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] outline-none ${customError ? 'ring-1 ring-[var(--color-accent)]' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={handleCustomSubmit}
                    className="pressable min-h-11 px-5 bg-[var(--color-surface-2)] text-[var(--color-text)] t-label-sm hover:bg-[var(--color-text)] hover:text-[var(--color-base)] transition-colors"
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
            className="pressable w-full min-h-12 rounded-[11px] bg-[var(--color-surface-2)] t-label text-[var(--color-text)] hover:bg-[var(--color-text)] hover:text-[var(--color-base)] transition-colors"
          >
            Done resting
          </button>
        </div>
      </Modal>
    </>
  );
}
