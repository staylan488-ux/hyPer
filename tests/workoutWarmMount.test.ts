import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StateCreator } from 'zustand/vanilla';

import type { Split } from '@/types';

// Server rendering stops at the first commit: no effect has run, which is the
// frame a warm return to Train paints before the schedule effect fills it in.
vi.mock('@/lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lte', 'abortSignal']) query[method] = () => query;
  query.maybeSingle = async () => ({ data: null, error: null });
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return {
    supabase: {
      from: () => query,
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    },
  };
});

// Server rendering reads a zustand store's initial state; these hooks read the
// live state instead, so the test can seed a warm store.
vi.mock('zustand', async () => {
  const { useSyncExternalStore } = await import('react');
  const { createStore } = await import('zustand/vanilla');
  const createBound = (init: StateCreator<unknown>) => {
    const api = createStore(init);
    const useBound = (selector: (state: unknown) => unknown = (state) => state) => {
      const snapshot = () => selector(api.getState());
      return useSyncExternalStore(api.subscribe, snapshot, snapshot);
    };
    return Object.assign(useBound, api);
  };
  return { create: (init?: StateCreator<unknown>) => (init ? createBound(init) : createBound) };
});

import { Workout } from '@/pages/Workout';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

const USER_ID = 'user-1';

const split = {
  id: 'split-1', user_id: USER_ID, name: 'Upper / Lower', days_per_week: 4, is_active: true,
  created_at: '2026-09-01T00:00:00.000Z',
  days: [
    { id: 'day-1', split_id: 'split-1', day_name: 'Upper', day_order: 0, exercises: [] },
    { id: 'day-2', split_id: 'split-1', day_name: 'Lower', day_order: 1, exercises: [] },
  ],
} as unknown as Split;

const storage = new Map<string, string>();

function renderFirstFrame() {
  return renderToString(createElement(MemoryRouter, null, createElement(Workout)));
}

beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  useAuthStore.setState({ user: { id: USER_ID } as never });
  useAppStore.setState({
    activeSplit: split,
    splits: [split],
    currentWorkout: null,
    currentWorkoutDayPlan: null,
    workoutMode: 'split',
    hydratedForUserId: USER_ID,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Train on a warm return', () => {
  it('does not paint the Start Plan setup for a saved schedule before the effect runs', () => {
    storage.set(`plan-schedule:${USER_ID}:${split.id}`, JSON.stringify({
      splitId: split.id, startDate: '2026-09-28', mode: 'fixed', weekdays: [1, 2, 4, 5],
      updatedAt: '2026-09-28T08:00:00.000Z',
    }));

    const html = renderFirstFrame();

    expect(html).not.toContain('Start Plan');
    expect(html).not.toContain('Loading program');
  });

  it('shows the saved-setup loader, not the setup form, while a schedule may still arrive', () => {
    const html = renderFirstFrame();

    expect(html).not.toContain('Start Plan');
    expect(html).toContain('Loading saved plan setup');
  });
});
