import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { describeAuthError, recordAuthDiagnostic } from '@/lib/authDiagnostics';
import { withTimeout } from '@/lib/withTimeout';

// supabase-js refreshes the access token on a timer that iOS suspends with the
// app, and its own resume handling has no deadline. If that refresh or the
// session read behind it stalls, every request waits on it until the app is
// cold-started. This module takes over foreground handling with bounded steps,
// and gives a stalled save a way to restart the refresh before it retries.
export const AUTH_STEP_TIMEOUT_MS = 3_000;
export const AUTH_REFRESH_TIMEOUT_MS = 5_000;
// Refresh on resume when the access token has this long left, or less.
export const RESUME_REFRESH_WINDOW_MS = 60_000;

// The parts of supabase.auth driven here. All optional, so the preview mock
// client, which has none of them, makes every call a no-op.
export interface AuthControls {
  startAutoRefresh?: () => Promise<void>;
  stopAutoRefresh?: () => Promise<void>;
  getSession?: () => Promise<{ data: { session: { expires_at?: number } | null } }>;
  refreshSession?: () => Promise<{ error: unknown }>;
}

const TIMED_OUT = 'auth step timed out';

function outcomeOf(error: unknown): string {
  return error instanceof Error && error.message === TIMED_OUT ? 'timeout' : describeAuthError(error);
}

function bounded<T>(run: () => Promise<T>, ms = AUTH_STEP_TIMEOUT_MS): Promise<T> {
  return withTimeout(Promise.resolve().then(run), ms, TIMED_OUT);
}

function inForeground(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

// Clears the SDK's ticker and starts a fresh one, which checks the session
// immediately. Calling these also removes the SDK's own visibility listener,
// leaving foreground handling to installAuthResume.
async function restartAutoRefresh(auth: AuthControls): Promise<void> {
  const { startAutoRefresh, stopAutoRefresh } = auth;
  if (!startAutoRefresh || !stopAutoRefresh) return;
  await bounded(() => stopAutoRefresh.call(auth));
  if (inForeground()) await bounded(() => startAutoRefresh.call(auth));
}

async function refresh(auth: AuthControls): Promise<string> {
  const { error } = await bounded(() => auth.refreshSession!(), AUTH_REFRESH_TIMEOUT_MS);
  return error ? describeAuthError(error) : 'refreshed';
}

async function refreshIfExpiring(auth: AuthControls): Promise<string> {
  if (!auth.getSession || !auth.refreshSession) return 'unsupported';
  const { data } = await bounded(() => auth.getSession!());
  const expiresAt = data.session?.expires_at;
  if (!data.session || !expiresAt) return 'no-session';
  if (expiresAt * 1000 - Date.now() > RESUME_REFRESH_WINDOW_MS) return 'fresh';
  return refresh(auth);
}

let resuming: Promise<void> | null = null;
let recovering: Promise<void> | null = null;

/** Restarts auto-refresh and refreshes a session that is about to expire. Never throws. */
export function resumeAuth(auth: AuthControls, source = 'visible'): Promise<void> {
  if (!auth.startAutoRefresh || !auth.stopAutoRefresh) return Promise.resolve();
  resuming ??= (async () => {
    const startedAt = Date.now();
    recordAuthDiagnostic('resume', { detail: source });
    let outcome: string;
    try {
      await restartAutoRefresh(auth);
      outcome = await refreshIfExpiring(auth);
    } catch (error) {
      outcome = outcomeOf(error);
    }
    recordAuthDiagnostic('resume:end', { outcome, durationMs: Date.now() - startedAt });
  })().finally(() => { resuming = null; });
  return resuming;
}

/** Stops the refresh ticker while the app is in the background. Never throws. */
export async function pauseAuth(auth: AuthControls, source = 'hidden'): Promise<void> {
  const { stopAutoRefresh } = auth;
  if (!stopAutoRefresh) return;
  recordAuthDiagnostic('pause', { detail: source });
  try {
    await bounded(() => stopAutoRefresh.call(auth));
  } catch {
    // The ticker is suspended with the app anyway.
  }
}

/**
 * Bounded recovery for a request that timed out, likely behind a stalled
 * refresh: restart auto-refresh and refresh the session. Concurrent callers
 * share one run. Never throws.
 */
export function recoverAuthSession(auth: AuthControls): Promise<void> {
  if (!auth.refreshSession) return Promise.resolve();
  recovering ??= (async () => {
    const startedAt = Date.now();
    let outcome: string;
    try {
      await restartAutoRefresh(auth);
      outcome = await refresh(auth);
    } catch (error) {
      outcome = outcomeOf(error);
    }
    recordAuthDiagnostic('recovery:end', { outcome, durationMs: Date.now() - startedAt });
  })().finally(() => { recovering = null; });
  return recovering;
}

/** The recovery in progress, if any, so a new attempt can wait for it. */
export function pendingAuthRecovery(): Promise<void> {
  return recovering ?? Promise.resolve();
}

/** Wires foreground/background handling once at startup. Returns a disposer. */
export function installAuthResume(auth: AuthControls): () => void {
  if (typeof document === 'undefined' || !auth.startAutoRefresh || !auth.stopAutoRefresh) return () => {};

  const visibilityChanged = () => {
    if (document.visibilityState === 'visible') void resumeAuth(auth, 'visible');
    else if (document.visibilityState === 'hidden') void pauseAuth(auth, 'hidden');
  };
  document.addEventListener('visibilitychange', visibilityChanged);

  let disposed = false;
  let nativeListener: { remove: () => Promise<void> } | undefined;
  if (Capacitor.isNativePlatform()) {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (disposed) return;
      if (isActive) void resumeAuth(auth, 'app-active');
      else void pauseAuth(auth, 'app-inactive');
    }).then((listener) => {
      if (disposed) void listener.remove().catch(() => undefined);
      else nativeListener = listener;
    }).catch(() => {
      // visibilitychange still covers resume in an older installed shell.
    });
  }

  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', visibilityChanged);
    void nativeListener?.remove().catch(() => undefined);
  };
}
