import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Foreground handling for the token refresh that iOS suspends with the app:
// restart the SDK's ticker, refresh a session that is about to expire, and
// never let a stalled step hang or throw.
const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  addListener: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.isNativePlatform } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.addListener } }));
vi.mock('@/lib/authDiagnostics', () => ({
  recordAuthDiagnostic: mocks.record,
  describeAuthError: (error: { name?: string }) => error?.name ?? 'unknown',
}));

import {
  AUTH_REFRESH_TIMEOUT_MS,
  AUTH_STEP_TIMEOUT_MS,
  installAuthResume,
  recoverAuthSession,
  resumeAuth,
} from '@/lib/authResume';

const NOW = new Date('2026-10-13T12:00:00Z').getTime();

function fakeAuth(expiresInSeconds: number | null) {
  const session = expiresInSeconds === null ? null : { expires_at: NOW / 1000 + expiresInSeconds };
  return {
    stopAutoRefresh: vi.fn(async () => {}),
    startAutoRefresh: vi.fn(async () => {}),
    getSession: vi.fn(async () => ({ data: { session } })),
    refreshSession: vi.fn(async () => ({ error: null })),
  };
}

function outcomes(event: string) {
  return mocks.record.mock.calls.filter(([name]) => name === event).map(([, fields]) => fields?.outcome);
}

beforeEach(() => {
  mocks.isNativePlatform.mockReturnValue(false);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('resumeAuth', () => {
  it('restarts auto-refresh and refreshes a session expiring within 60 s', async () => {
    const auth = fakeAuth(45);
    await resumeAuth(auth);

    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.stopAutoRefresh.mock.invocationCallOrder[0])
      .toBeLessThan(auth.startAutoRefresh.mock.invocationCallOrder[0]);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(outcomes('resume:end')).toEqual(['refreshed']);
  });

  it('refreshes an already expired session', async () => {
    const auth = fakeAuth(-600);
    await resumeAuth(auth);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('restarts auto-refresh without refreshing a session with time left', async () => {
    const auth = fakeAuth(10 * 60);
    await resumeAuth(auth);
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(outcomes('resume:end')).toEqual(['fresh']);
  });

  it('does nothing more when signed out', async () => {
    const auth = fakeAuth(null);
    await resumeAuth(auth);
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(outcomes('resume:end')).toEqual(['no-session']);
  });

  it('gives up on a stalled session read without throwing', async () => {
    const auth = fakeAuth(30);
    auth.getSession.mockImplementation(() => new Promise(() => {}));
    const resumed = resumeAuth(auth);
    await vi.advanceTimersByTimeAsync(AUTH_STEP_TIMEOUT_MS);
    await expect(resumed).resolves.toBeUndefined();
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(outcomes('resume:end')).toEqual(['timeout']);
  });

  it('gives up on a stalled refresh without throwing', async () => {
    const auth = fakeAuth(30);
    auth.refreshSession.mockImplementation(() => new Promise(() => {}));
    const resumed = resumeAuth(auth);
    await vi.advanceTimersByTimeAsync(AUTH_REFRESH_TIMEOUT_MS);
    await expect(resumed).resolves.toBeUndefined();
    expect(outcomes('resume:end')).toEqual(['timeout']);
  });

  it('shares one run between overlapping resume signals', async () => {
    const auth = fakeAuth(30);
    await Promise.all([resumeAuth(auth, 'visible'), resumeAuth(auth, 'app-active')]);
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for the preview client, which has no refresh controls', async () => {
    const preview = { getSession: vi.fn() };
    await resumeAuth(preview);
    await recoverAuthSession(preview);
    expect(preview.getSession).not.toHaveBeenCalled();
    expect(installAuthResume(preview)).toBeTypeOf('function');
  });
});

describe('recoverAuthSession', () => {
  it('restarts auto-refresh and refreshes regardless of expiry', async () => {
    const auth = fakeAuth(50 * 60);
    await recoverAuthSession(auth);
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(outcomes('recovery:end')).toEqual(['refreshed']);
  });

  it('reports a refresh error and a thrown step without rejecting', async () => {
    const auth = fakeAuth(0);
    auth.refreshSession.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError' } } as never);
    await expect(recoverAuthSession(auth)).resolves.toBeUndefined();
    auth.stopAutoRefresh.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'BridgeError' }));
    await expect(recoverAuthSession(auth)).resolves.toBeUndefined();
    expect(outcomes('recovery:end')).toEqual(['AuthRetryableFetchError', 'BridgeError']);
  });
});

describe('installAuthResume', () => {
  function fakeDocument() {
    const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    target.visibilityState = 'visible';
    return target;
  }

  it('pauses on hidden and resumes on visible until disposed', async () => {
    const doc = fakeDocument();
    vi.stubGlobal('document', doc);
    const auth = fakeAuth(20);
    const dispose = installAuthResume(auth);

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.startAutoRefresh).not.toHaveBeenCalled();

    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);

    dispose();
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.addListener).not.toHaveBeenCalled();
  });

  it('also follows the native app state on iOS', async () => {
    vi.stubGlobal('document', fakeDocument());
    mocks.isNativePlatform.mockReturnValue(true);
    const remove = vi.fn(async () => {});
    let onAppState: ((state: { isActive: boolean }) => void) | undefined;
    mocks.addListener.mockImplementation(async (_event: string, callback: typeof onAppState) => {
      onAppState = callback;
      return { remove };
    });
    const auth = fakeAuth(20);
    const dispose = installAuthResume(auth);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

    onAppState?.({ isActive: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    onAppState?.({ isActive: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);

    dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
