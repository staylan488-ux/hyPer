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
import { WorkoutSetRow } from '@/components/workout/WorkoutSetRow';
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

describe('Train live session', () => {
  const row = { id: 'ex-row', name: 'Barbell Row', muscle_group: 'back' };
  const set = (n: number, completed: boolean) => ({
    id: `row-${n}`, workout_id: 'w-1', exercise_id: row.id, exercise: row, set_number: n,
    weight: completed ? 60 : null, reps: completed ? 9 : null, rpe: null, completed,
    completed_at: completed ? '2026-10-07T08:05:00.000Z' : null,
  });

  it('minimises instead of going back, and docks the next set as the primary action', () => {
    useAppStore.setState({
      currentWorkout: {
        id: 'w-1', user_id: USER_ID, split_day_id: 'day-1', date: '2026-10-07', notes: null, completed: false,
        created_at: '2026-10-07T08:00:00.000Z', sets: [set(1, true), set(2, false), set(3, false)],
      } as never,
    });

    const html = renderFirstFrame();

    expect(html).toContain('aria-label="Minimise workout"');
    expect(html).not.toContain('Back to Today');
    // No set entry is open in the first frame, so the next set is offered.
    expect(html).toContain('aria-label="Log set 2 of Barbell Row"');
    expect(html).toMatch(/Log set (<!-- -->)?2(<!-- -->)? · (<!-- -->)?Barbell Row/);
    expect(html).toContain('>Finish<');
  });

  it('shows planned numbers as ghost values with their source, last workout as the alternative', () => {
    const planned = { ...set(1, false), weight: 80, reps: 10, rpe: 7 };
    const props = {
      set: planned as never, setNumber: 1, editing: true, exerciseName: 'Barbell Row',
      previousTarget: { weight: 60, reps: 9, rpe: null },
      autofillValues: { weight: '60', reps: '9', rpe: '', source: 'previous_workout' as const },
    };
    const html = renderToString(createElement(WorkoutSetRow, { ...props, planContinues: true }));

    // Inputs stay empty: the plan is a placeholder until it is typed over or saved.
    expect(html).toMatch(/<input[^>]*aria-label="Weight"[^>]*data-suggested="true"[^>]*placeholder="80"/);
    expect(html).not.toMatch(/<input[^>]*value="80"/);
    expect(html).toContain('aria-label="Save set 1 of Barbell Row, 80 pounds, 10 reps, RPE 7"');
    // Last workout is offered as a repeat under the fields, alone on its line;
    // the plan's source heads the planned rows below it, after the foot.
    expect(html).toMatch(/<div class="studio-set-editor-foot"><div><button[^>]*class="studio-set-repeat[^"]*"[^>]*>.*Repeat last · 60 × 9.*<\/div><span[^>]*class="studio-set-source-head">Planned/s);
    expect(html).not.toMatch(/<div class="studio-set-editor-foot">[^]*?Planned[^]*?<\/div><span[^>]*class="studio-set-source-head"/);
    // Entry closes with the movement's disclosure, not a second grey control.
    expect(html).not.toContain('Hide entry');

    // On the movement's last set nothing follows to head: the source stays a
    // quiet note under the fields.
    const last = renderToString(createElement(WorkoutSetRow, { ...props, planContinues: false }));
    expect(last).toMatch(/<div class="studio-set-editor-foot"><span[^>]*class="studio-set-suggestion">Planned/);
    expect(last).not.toContain('studio-set-source-head');
  });

  it('pins chevron, clock and Finish in one bar, with the compact title ready to take over', () => {
    useAppStore.setState({
      currentWorkout: {
        id: 'w-1', user_id: USER_ID, split_day_id: 'day-1', date: '2026-10-07', notes: null, completed: false,
        created_at: '2026-10-07T08:00:00.000Z', sets: [set(1, true), set(2, false), set(3, false)],
      } as never,
    });

    const html = renderFirstFrame();
    const bar = html.slice(html.indexOf('studio-live-bar'), html.indexOf('studio-live-bar-spacer'));

    expect(bar).toContain('aria-label="Minimise workout"');
    // One timer for assistive tech: the lone clock shown at the top is a
    // hidden visual copy that cross-fades in place to the compact title.
    expect(bar.match(/role="timer"/g)).toHaveLength(1);
    expect(bar).toMatch(/class="page-scroll-edge-title studio-session-solo"[^>]*aria-hidden="true"/);
    expect(bar).not.toContain('translateX');
    expect(bar).toMatch(/class="page-scroll-edge-title studio-session-line"[^>]*><span class="studio-session-prefix"[^>]*aria-hidden="true"[^>]*>Upper · <\/span><span class="studio-session-clock" role="timer">/);
    expect(bar).toContain('>Finish<');
    // The single collapse control is gone from the foot of the movement.
    expect(html).not.toContain('Close movement');
  });
});
