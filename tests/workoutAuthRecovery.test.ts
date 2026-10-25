import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutSet } from '@/types';

const backend = vi.hoisted(() => {
  const key = 'workout-auth-recovery';
  const session = {
    access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  };
  return { key, session, storage: new Map([[key, JSON.stringify(session)]]) };
});

// Keep real SDK session loading, single-flight refresh, refresh retry and
// PostgREST behavior. A mocked refreshSession cannot reproduce the stall.
vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { timedFetch } = await import('@/lib/timedFetch');
  return {
    supabase: createClient('https://workout-auth-recovery.test', 'test-key', {
      auth: {
        persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: backend.key,
        storage: {
          getItem: async (key: string) => backend.storage.get(key) ?? null,
          setItem: async (key: string, value: string) => { backend.storage.set(key, value); },
          removeItem: async (key: string) => { backend.storage.delete(key); },
        },
      },
      global: { fetch: timedFetch },
    }),
  };
});

import { supabase } from '@/lib/supabase';
import { AUTH_REFRESH_TIMEOUT_MS } from '@/lib/authResume';
import { saveWorkoutSet, SET_SAVE_TIMEOUT_MS } from '@/lib/saveWorkoutSet';

const target: WorkoutSet = {
  id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 1,
  weight: null, reps: null, rpe: null, completed: false, completed_at: null,
};

beforeEach(async () => {
  await supabase.auth.initialize();
  vi.useFakeTimers();
  backend.storage.set(backend.key, JSON.stringify({ ...backend.session, expires_at: Math.floor(Date.now() / 1000) - 1 }));
});

afterEach(async () => {
  await supabase.auth.stopAutoRefresh();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('set saves behind the real SDK token refresh', () => {
  it.each([
    { stalledAttempts: 1, stage: 'fetch' },
    { stalledAttempts: 1, stage: 'body' },
    { stalledAttempts: 2, stage: 'fetch' },
    { stalledAttempts: 2, stage: 'body' },
  ])('recovers after $stalledAttempts expired-token refresh $stage stalls without a cold restart', async ({ stalledAttempts, stage }) => {
    let refreshes = 0;
    const finishLate: Array<() => void> = [];
    const writes: RequestInit[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === '/auth/v1/token') {
        if (++refreshes <= stalledAttempts) {
          const stale = { ...backend.session, access_token: 'late-access', refresh_token: 'late-refresh' };
          if (stage === 'fetch') {
            return new Promise((resolve) => { finishLate.push(() => resolve(Response.json(stale))); });
          }
          return new Response(new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(stale)));
              finishLate.push(() => controller.close());
            },
          }));
        }
        return Response.json({ ...backend.session, access_token: 'new-access', refresh_token: 'new-refresh' });
      }
      if (path === '/rest/v1/sets') {
        writes.push(init!);
        return Response.json({ ...target, ...JSON.parse(String(init?.body)) });
      }
      throw new Error(`Unexpected test endpoint ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = { saved: false, error: undefined as unknown };
    const save = saveWorkoutSet(target, { weight: 185, reps: 8, rpe: 8.5 }).then(
      () => { result.saved = true; },
      (error) => { result.error = error; },
    );

    // The previous implementation exhausted both save attempts while its
    // "recovery" awaited the very same never-settling SDK refresh.
    await vi.advanceTimersByTimeAsync(2 * SET_SAVE_TIMEOUT_MS + AUTH_REFRESH_TIMEOUT_MS);
    expect(result.error).toBeUndefined();
    expect(result.saved).toBe(true);
    await save;
    expect(refreshes).toBeGreaterThan(stalledAttempts);
    expect(fetchMock.mock.calls.slice(0, stalledAttempts).every(([, init]) => init?.signal?.aborted)).toBe(true);
    // When the first save timed out behind auth, its later continuation must
    // not send an obsolete write. Only the successful save attempt reaches REST.
    expect(writes).toHaveLength(1);
    expect(new Headers(writes[0].headers).get('Authorization')).toBe('Bearer new-access');
    expect(JSON.parse(String(writes[0].body))).toMatchObject({ weight: 185, reps: 8, completed: true });
    expect(JSON.parse(backend.storage.get(backend.key)!)).toMatchObject({ refresh_token: 'new-refresh' });

    // The abandoned transport can finish later; its stale session must never
    // escape the losing race and replace the successfully rotated token.
    finishLate.forEach((finish) => finish());
    await vi.advanceTimersByTimeAsync(0);
    expect((await supabase.auth.getSession()).data.session?.access_token).toBe('new-access');
  });

  it('retains the session through an outage and lets a manual retry recover after the SDK cooldown', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(() => new Promise(() => {})));
    const failed = saveWorkoutSet(target, { weight: 185, reps: 8, rpe: null })
      .then(() => 'saved', () => 'failed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await failed).toBe('failed');
    expect(JSON.parse(backend.storage.get(backend.key)!)).toMatchObject({ refresh_token: 'old-refresh' });

    const writes: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (new URL(String(input)).pathname === '/auth/v1/token') {
        return Response.json({ ...backend.session, access_token: 'reconnected-access', refresh_token: 'reconnected-refresh' });
      }
      if (new Headers(init?.headers).get('Authorization') !== 'Bearer reconnected-access') {
        return Response.json({ code: 'PGRST301', message: 'JWT required' }, { status: 401 });
      }
      writes.push(init!);
      return Response.json({ ...target, ...JSON.parse(String(init?.body)) });
    }));
    // After exhausting refresh attempts, auth-js 2.115 caches the failure for
    // 60 s. Restarting its ticker does not bypass this SDK cooldown either.
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(saveWorkoutSet(target, { weight: 185, reps: 8, rpe: null }))
      .resolves.toMatchObject({ completed: true, weight: 185, reps: 8 });
    expect(writes).toHaveLength(1);
    expect(new Headers(writes[0].headers).get('Authorization')).toBe('Bearer reconnected-access');
  });
});
