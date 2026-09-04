import { afterEach, expect, it, vi } from 'vitest';
import type { WorkoutSet } from '@/types';

const backend = vi.hoisted(() => {
  const user = {
    id: 'workout-isolation-user', aud: 'authenticated', role: 'authenticated',
    app_metadata: {}, user_metadata: {}, created_at: '2026-09-04T00:00:00Z',
  };
  const session = {
    access_token: 'test-only-access-token', refresh_token: 'test-only-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  };
  return { user, session, fetch: vi.fn<typeof fetch>() };
});

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const key = 'workout-auth-isolation';
  const secureStorage = new Map([[key, JSON.stringify(backend.session)]]);
  return {
    supabase: createClient('https://workout-isolation.test', 'test-only-public-key', {
      auth: {
        persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: key,
        // Exercise asynchronous storage, as used by the native Keychain adapter.
        storage: {
          getItem: async (name) => secureStorage.get(name) ?? null,
          setItem: async (name, value) => { secureStorage.set(name, value); },
          removeItem: async (name) => { secureStorage.delete(name); },
        },
      },
      global: { fetch: backend.fetch },
    }),
  };
});

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';

afterEach(() => vi.unstubAllGlobals());

it('saves sets while a preference lookup triggered by session refresh is still pending', async () => {
  // No saved photo-worker settings: the real auth callback will hydrate them.
  const preferences = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => preferences.set(key, value),
    removeItem: (key: string) => preferences.delete(key),
  });
  const workoutSet: WorkoutSet = {
    id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 1,
    weight: null, reps: null, rpe: null, completed: false, completed_at: null,
  };
  useAppStore.setState({ currentWorkout: {
    id: 'workout-1', user_id: backend.user.id, split_day_id: null,
    date: '2026-09-04', notes: null, completed: false, sets: [workoutSet],
  } });

  let stallUserLookup = false;
  let userLookupPending = false;
  let releaseUserLookup!: (response: Response) => void;
  const userLookup = new Promise<Response>((resolve) => { releaseUserLookup = resolve; });
  backend.fetch.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === '/auth/v1/token') return Response.json(backend.session);
    if (path === '/auth/v1/user') {
      if (stallUserLookup) {
        userLookupPending = true;
        return userLookup;
      }
      return Response.json(backend.user);
    }
    if (path === '/rest/v1/profiles') return Response.json({ id: backend.user.id, display_name: 'Test' });
    if (path === '/rest/v1/sets') return Response.json({ ...workoutSet, ...JSON.parse(String(init?.body)) });
    throw new Error(`Unexpected test endpoint: ${path}`);
  });

  await useAuthStore.getState().initialize();
  await supabase.auth.getSession();
  await vi.waitFor(() => expect(useAuthStore.getState().profile?.display_name).toBe('Test'));
  stallUserLookup = true;

  // The public refresh API emits the same TOKEN_REFRESHED event as the
  // foreground timer. No screen lock or app switch is involved.
  const refresh = supabase.auth.refreshSession();
  let save: Promise<void> | undefined;
  try {
    await vi.waitFor(() => expect(userLookupPending).toBe(true));
    save = useAppStore.getState().logSet('exercise-1', 1, 185, 8, 8.5);
    await vi.waitFor(() => {
      expect(useAppStore.getState().currentWorkout?.sets[0]).toMatchObject({
        weight: 185, reps: 8, rpe: 8.5, completed: true,
      });
    }, { timeout: 1_000, interval: 10 });
    // The save completed without releasing or timing out the unrelated lookup.
    expect(userLookupPending).toBe(true);
    const patches = backend.fetch.mock.calls.filter(([url, init]) =>
      String(url).includes('/rest/v1/sets') && init?.method === 'PATCH');
    expect(patches).toHaveLength(1);
  } finally {
    stallUserLookup = false;
    releaseUserLookup(Response.json(backend.user));
    await refresh;
    await save;
    await supabase.auth.stopAutoRefresh();
  }
});
