export interface RestTimerSession {
  workoutId: string;
  durationSeconds: number;
  startedAt: string;
  endsAt: string;
  remainingSeconds: number;
  status: 'running' | 'paused' | 'completed';
  completedAt: string | null;
}

type TimerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const REST_TIMER_STORAGE_KEY = 'hyper:rest-timer';

function getStorage(storage?: TimerStorage | null): TimerStorage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function toDate(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createRestTimerSession(
  workoutId: string,
  durationSeconds: number,
  now: Date = new Date(),
): RestTimerSession {
  const normalizedDuration = Math.max(1, Math.round(durationSeconds));
  const startedAt = now.toISOString();
  const endsAt = new Date(now.getTime() + normalizedDuration * 1000).toISOString();

  return {
    workoutId,
    durationSeconds: normalizedDuration,
    startedAt,
    endsAt,
    remainingSeconds: normalizedDuration,
    status: 'running',
    completedAt: null,
  };
}

export function getRestTimerRemainingSeconds(
  session: RestTimerSession,
  now: Date = new Date(),
): number {
  if (session.status === 'paused') return Math.max(0, Math.round(session.remainingSeconds));
  if (session.status === 'completed') return 0;

  const endsAt = toDate(session.endsAt);
  if (!endsAt) return 0;

  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 1000));
}

export function syncRestTimerSession(
  session: RestTimerSession,
  now: Date = new Date(),
): RestTimerSession {
  if (session.status === 'paused' || session.status === 'completed') return session;

  const remainingSeconds = getRestTimerRemainingSeconds(session, now);
  if (remainingSeconds > 0) {
    if (session.remainingSeconds === remainingSeconds) return session;
    return {
      ...session,
      remainingSeconds,
    };
  }

  return {
    ...session,
    remainingSeconds: 0,
    status: 'completed',
    completedAt: now.toISOString(),
  };
}

export function readRestTimerSession(storage?: TimerStorage | null): RestTimerSession | null {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return null;

  try {
    const raw = targetStorage.getItem(REST_TIMER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<RestTimerSession>;
    if (
      typeof parsed?.workoutId !== 'string'
      || typeof parsed?.durationSeconds !== 'number'
      || typeof parsed?.remainingSeconds !== 'number'
      || typeof parsed?.startedAt !== 'string'
      || typeof parsed?.endsAt !== 'string'
      || (parsed?.status !== 'running' && parsed?.status !== 'paused' && parsed?.status !== 'completed')
    ) {
      return null;
    }

    return {
      workoutId: parsed.workoutId,
      durationSeconds: parsed.durationSeconds,
      startedAt: parsed.startedAt,
      endsAt: parsed.endsAt,
      remainingSeconds: parsed.remainingSeconds,
      status: parsed.status,
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
    };
  } catch {
    return null;
  }
}

export function saveRestTimerSession(
  session: RestTimerSession,
  storage?: TimerStorage | null,
): RestTimerSession {
  const targetStorage = getStorage(storage);
  if (targetStorage) {
    targetStorage.setItem(REST_TIMER_STORAGE_KEY, JSON.stringify(session));
  }

  return session;
}

export function clearRestTimerSession(storage?: TimerStorage | null): void {
  const targetStorage = getStorage(storage);
  targetStorage?.removeItem(REST_TIMER_STORAGE_KEY);
}

export function isRestTimerForWorkout(
  session: RestTimerSession | null,
  workoutId: string | null | undefined,
): boolean {
  if (!session || !workoutId) return false;
  return session.workoutId === workoutId;
}

export function pauseRestTimerSession(
  session: RestTimerSession,
  now: Date = new Date(),
): RestTimerSession {
  if (session.status !== 'running') return session;

  return {
    ...session,
    remainingSeconds: getRestTimerRemainingSeconds(session, now),
    status: 'paused',
  };
}

export function resumeRestTimerSession(
  session: RestTimerSession,
  now: Date = new Date(),
): RestTimerSession {
  if (session.status !== 'paused') return session;

  return {
    ...session,
    startedAt: now.toISOString(),
    endsAt: new Date(now.getTime() + session.remainingSeconds * 1000).toISOString(),
    status: 'running',
  };
}

export async function playRestTimerSound(): Promise<void> {
  if (typeof window === 'undefined') return;

  const audioWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };

  const AudioContextCtor = window.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioContextCtor) return;

  try {
    const context = new AudioContextCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.4);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.4);

    await new Promise((resolve) => {
      oscillator.onended = resolve;
    });

    void context.close();
  } catch {
    // Audio playback is best-effort in the web phase.
  }
}
