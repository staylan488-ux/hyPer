import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Modal, RailStrip, RollingNumber } from '@/components/shared';
import { springs } from '@/lib/animations';
import { completionHaptic, tapHaptic } from '@/lib/haptics';
import { cancelRestEndNotification, scheduleRestEndNotification } from '@/lib/restNotifications';
import { endRestLiveActivity, startRestLiveActivity } from '@/lib/liveActivity';
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
 * Ambient rest timer: a sharp bar docked above the bottom nav that drains in
 * place — square corners, a precise mono countdown, a hairline progress rule
 * and a single lacquer live tick. Tap to expand for presets — never a blocking
 * modal between sets.
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
      void startRestLiveActivity(sessionStartedAt, sessionEndsAt, nextUpLabel);
    } else {
      void cancelRestEndNotification();
      void endRestLiveActivity();
    }
  }, [sessionStatus, sessionStartedAt, sessionEndsAt, nextUpLabel]);

  // Dismissed or unmounted (workout finished, navigation) — nothing to announce.
  useEffect(() => () => {
    void cancelRestEndNotification();
    void endRestLiveActivity();
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
      <AnimatePresence>
        <motion.div
          key="rest-pill"
          className="fixed left-0 right-0 z-40 pointer-events-none"
          style={{ bottom: 'calc(5.9rem + env(safe-area-inset-bottom, 0px))' }}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={springs.smooth}
        >
          <div className="max-w-lg mx-auto px-5">
            <motion.div
              className="pointer-events-auto bg-[var(--color-surface-2)] border border-[var(--color-border-strong)]"
              style={{ borderTop: `2px solid ${tone}` }}
              animate={isWarning ? { scale: [1, 1.008, 1] } : {}}
              transition={isWarning ? { duration: 1, repeat: Infinity } : springs.smooth}
            >
              <div className="flex items-center gap-3 pl-3 pr-1 py-1.5">
                <button
                  type="button"
                  onClick={handleToggleRunning}
                  disabled={isComplete}
                  aria-label={isRunning ? 'Pause rest timer' : 'Resume rest timer'}
                  className="pressable flex items-center justify-center w-9 h-9 border border-[var(--color-border-strong)] text-[var(--color-text)] disabled:opacity-40 shrink-0"
                >
                  {isRunning ? (
                    <Pause className="w-3.5 h-3.5" fill="currentColor" />
                  ) : (
                    <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />
                  )}
                </button>

                <button
                  type="button"
                  className="flex items-center gap-3 flex-1 min-w-0 py-1"
                  onClick={() => setExpanded(true)}
                  aria-label="Open rest timer options"
                >
                  {!isComplete && (
                    <span
                      className="shrink-0 w-[3px] h-5 animate-tick-live"
                      style={{ backgroundColor: tone }}
                      aria-hidden
                    />
                  )}
                  {isComplete ? (
                    <span
                      className="shrink-0 t-caps text-[15px] font-normal tracking-[0.24em]"
                      style={{ color: tone }}
                    >
                      Go
                    </span>
                  ) : (
                    <RollingNumber
                      value={formatTime(timeLeft)}
                      className="shrink-0 t-data-lg tabular-nums"
                      style={{ color: tone }}
                    />
                  )}
                  <span className="t-label-sm shrink-0 ml-auto flex items-center gap-1.5">
                    <Timer className="w-3 h-3" strokeWidth={1.75} />
                    {isComplete ? 'rest done' : 'rest'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleDismiss}
                  aria-label="Dismiss rest timer"
                  className="pressable flex items-center justify-center w-9 h-9 text-[var(--color-muted)] hover:text-[var(--color-text)] shrink-0"
                >
                  <X className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>

              <RailStrip
                value={isComplete ? 1 : remainingRatio}
                tone={isComplete ? 'sage' : isWarning ? 'berry' : 'amber'}
                size="sm"
              />
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>

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
              className="pressable flex items-center justify-center min-w-[52px] min-h-[52px] bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] text-[var(--color-text)] disabled:opacity-40"
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
              className="pressable flex items-center justify-center min-w-[52px] min-h-[52px] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
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
                    className={`flex-1 min-w-0 min-h-11 px-3 t-data-sm tabular-nums bg-[var(--color-surface-1)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] outline-none border-l-2 ${customError ? 'border-[var(--color-accent)]' : 'border-transparent'}`}
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
            className="pressable w-full min-h-12 bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] text-[11px] uppercase font-medium tracking-[0.22em] text-[var(--color-text)] hover:bg-[var(--color-text)] hover:text-[var(--color-base)] transition-colors"
          >
            Done resting
          </button>
        </div>
      </Modal>
    </>
  );
}
