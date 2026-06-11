import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Modal, RailStrip } from '@/components/shared';
import { springs } from '@/lib/animations';
import {
  clearRestTimerSession,
  createRestTimerSession,
  getRestTimerRemainingSeconds,
  isRestTimerForWorkout,
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
  onDismiss: () => void;
}

const PRESET_TIMES = [60, 90, 120, 180, 300];

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
 * Ambient rest timer: a pill docked above the bottom nav that drains in place.
 * Tap to expand for presets — never a blocking modal between sets.
 */
export function RestTimerPill({ workoutId, sessionSeed = 0, defaultSeconds = 90, onDismiss }: RestTimerPillProps) {
  const [session, setSession] = useState<RestTimerSession | null>(() => getInitialSession(workoutId, defaultSeconds, sessionSeed));
  const [expanded, setExpanded] = useState(false);
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

    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }

    void playRestTimerSound();
  }, [session]);

  const timeLeft = session ? getRestTimerRemainingSeconds(session) : defaultSeconds;
  const seconds = session?.durationSeconds ?? defaultSeconds;
  const remainingRatio = seconds > 0 ? timeLeft / seconds : 0;
  const isWarning = timeLeft <= 10 && timeLeft > 0 && isRunning;
  const isComplete = timeLeft === 0;

  const handleReset = () => {
    const nextSession = pauseRestTimerSession(createRestTimerSession(workoutId, seconds));
    saveRestTimerSession(nextSession);
    setSession(nextSession);
    completionHandledRef.current = false;
  };

  const handleSetTime = (newSeconds: number) => {
    const nextSession = createRestTimerSession(workoutId, newSeconds);
    saveRestTimerSession(nextSession);
    setSession(nextSession);
    completionHandledRef.current = false;
  };

  const handleToggleRunning = () => {
    if (!session) return;

    const nextSession = session.status === 'running' ? pauseRestTimerSession(session) : resumeRestTimerSession(session);

    saveRestTimerSession(nextSession);
    setSession(nextSession);
  };

  const handleDismiss = () => {
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
          style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom, 0px))' }}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={springs.smooth}
        >
          <div className="max-w-lg mx-auto px-5">
            <motion.div
              className="pointer-events-auto flex items-center gap-3 pl-2 pr-1 py-1.5 rounded-full bg-[var(--color-surface-2)] hairline-strong raised"
              animate={isWarning ? { scale: [1, 1.012, 1] } : {}}
              transition={isWarning ? { duration: 1, repeat: Infinity } : springs.smooth}
            >
              <button
                type="button"
                onClick={handleToggleRunning}
                disabled={isComplete}
                aria-label={isRunning ? 'Pause rest timer' : 'Resume rest timer'}
                className="pressable flex items-center justify-center w-9 h-9 rounded-full bg-[var(--color-surface-3)] disabled:opacity-40 shrink-0"
              >
                {isRunning ? (
                  <Pause className="w-3.5 h-3.5 text-[var(--color-text)]" fill="currentColor" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-[var(--color-text)] ml-0.5" fill="currentColor" />
                )}
              </button>

              <button
                type="button"
                className="flex items-center gap-3 flex-1 min-w-0 py-1"
                onClick={() => setExpanded(true)}
                aria-label="Open rest timer options"
              >
                <span className="t-data-lg shrink-0 tabular-nums" style={{ color: tone }}>
                  {isComplete ? 'Go' : formatTime(timeLeft)}
                </span>
                <div className="flex-1 min-w-0">
                  <RailStrip
                    value={isComplete ? 1 : remainingRatio}
                    tone={isComplete ? 'sage' : isWarning ? 'berry' : 'amber'}
                    size="sm"
                  />
                </div>
                <span className="t-label-sm shrink-0 flex items-center gap-1">
                  <Timer className="w-3 h-3" strokeWidth={2} />
                  {isComplete ? 'rest done' : 'rest'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss rest timer"
                className="pressable flex items-center justify-center w-9 h-9 rounded-full text-[var(--color-muted)] hover:text-[var(--color-text)] shrink-0"
              >
                <X className="w-4 h-4" strokeWidth={2.25} />
              </button>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>

      <Modal isOpen={expanded} onClose={() => setExpanded(false)} title="Rest timer">
        <div className="pt-1 pb-2">
          <div className="text-center mb-5">
            <motion.p
              className="t-data-hero"
              animate={{ color: tone }}
              transition={{ duration: 0.3 }}
            >
              {formatTime(timeLeft)}
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
              className="pressable flex items-center justify-center w-13 h-13 min-w-[52px] min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-surface-2)] hairline-strong disabled:opacity-40"
              aria-label={isRunning ? 'Pause' : 'Resume'}
            >
              {isRunning ? (
                <Pause className="w-5 h-5 text-[var(--color-text)]" />
              ) : (
                <Play className="w-5 h-5 text-[var(--color-text)] ml-0.5" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="pressable flex items-center justify-center min-w-[52px] min-h-[52px] rounded-[var(--radius-md)] hairline text-[var(--color-muted)] hover:text-[var(--color-text)]"
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
                className={`pressable min-h-10 rounded-[var(--radius-sm)] t-data-sm border transition-colors ${
                  seconds === preset
                    ? 'bg-accent-tint-strong text-[var(--color-accent)] border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)]'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] border-[var(--color-border)]'
                }`}
              >
                {preset >= 60 ? `${preset / 60}m` : `${preset}s`}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="pressable w-full min-h-12 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] hairline-strong text-sm font-semibold text-[var(--color-text)]"
          >
            Done resting
          </button>
        </div>
      </Modal>
    </>
  );
}
