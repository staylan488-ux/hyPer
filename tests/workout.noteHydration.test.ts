import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { Workout as WorkoutRecord } from '@/types';

// Exercise the page's real callbacks/effects across a delayed warm refresh.
const hooks = vi.hoisted(() => {
  type Effect = { deps?: readonly unknown[]; setup: () => void | (() => void); cleanup?: () => void };
  const state = { slots: [] as unknown[], cursor: 0, pending: [] as Effect[], effects: [] as Effect[] };
  const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    state,
    reset() { state.slots = []; state.cursor = 0; state.pending = []; state.effects = []; },
    commit() { for (const effect of state.pending.splice(0)) { effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; } },
    cleanup() { for (const effect of state.effects) { effect.cleanup?.(); effect.cleanup = undefined; } },
    useRef(value: unknown) { const index = state.cursor++; return state.slots[index] ??= { current: value }; },
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [state.slots[index], (value: unknown) => { state.slots[index] = typeof value === 'function' ? value(state.slots[index]) : value; }];
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as { deps: readonly unknown[]; callback: unknown } | undefined;
      if (previous && same(previous.deps, deps)) return previous.callback;
      state.slots[index] = { deps, callback };
      return callback;
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as { deps: readonly unknown[]; value: unknown } | undefined;
      if (previous && same(previous.deps, deps)) return previous.value;
      const value = factory();
      state.slots[index] = { deps, value };
      return value;
    },
    useEffect(setup: Effect['setup'], deps?: readonly unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as Effect | undefined;
      if (previous && same(previous.deps, deps)) { previous.setup = setup; return; }
      const effect = previous ?? { setup };
      effect.setup = setup;
      effect.deps = deps;
      state.slots[index] = effect;
      if (!previous) state.effects.push(effect);
      state.pending.push(effect);
    },

  };
});

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: hooks.useRef, useState: hooks.useState, useCallback: hooks.useCallback,
  useMemo: hooks.useMemo, useEffect: hooks.useEffect,
  useReducer: (reducer: (state: unknown, action: unknown) => unknown, initial: unknown) => {
    const [state, setState] = hooks.useState(initial);
    return [state, (action: unknown) => (setState as (next: unknown) => void)((current: unknown) => reducer(current, action))];
  },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useScheduleWorkouts', () => ({ useScheduleWorkouts: () => ({ workouts: [], loading: false, error: null, retry: vi.fn() }) }));
vi.mock('@/hooks/useAdaptiveSplitScheduling', () => ({ useAdaptiveSplitScheduling: () => true }));
vi.mock('@/lib/keepAwake', () => ({ useKeepAwakeWhile: () => {} }));
vi.mock('@/lib/liveActivity', () => ({ endWorkoutActivity: async () => {}, syncWorkoutActivity: async () => {} }));
vi.mock('@/lib/restPreferences', () => ({ loadRestPreferences: () => ({}), loadRestPreferencesAsync: async () => ({}), resolveRestSeconds: () => 90, saveRestPreference: vi.fn() }));
vi.mock('@/lib/previousSetTargets', async (original) => ({
  ...(await original<typeof import('@/lib/previousSetTargets')>()),
  fetchPreviousSetTargets: async () => ({}),
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { id: 'note-user' } }) }));
const backend = vi.hoisted(() => ({
  workout: null as WorkoutRecord | null,
  split: { id: 'split', name: 'Upper', days_per_week: 3, days: [] },
  refresh: vi.fn(async () => {}),
  updateNotes: vi.fn<(id: string, notes: string | null) => Promise<void>>(async () => {}),
  load: vi.fn(async () => {}),
}));
vi.mock('@/stores/appStore', () => {
  const getState = () => ({
    currentWorkout: backend.workout,
    currentWorkoutDayPlan: null,
    activeSplit: backend.split,
    flexTemplates: [],
    workoutMode: 'split',
    hydratedForUserId: 'note-user',
    fetchCurrentWorkout: backend.refresh,
    fetchCurrentWorkoutDayPlan: backend.load,
    fetchSplits: backend.load,
    fetchWorkoutMode: backend.load,
    fetchFlexTemplates: backend.load,
    updateWorkoutNotes: backend.updateNotes,
  });
  return { useAppStore: Object.assign(getState, { getState }) };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'order', 'limit']) query[method] = () => query;
  query.maybeSingle = async () => ({ data: null, error: null });
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return query;
} } }));

import { Workout } from '@/pages/Workout';
import { serializeWorkoutNotes, parseWorkoutNotes } from '@/lib/workoutNotes';

type Element = ReactElement<{ children?: ReactNode; value?: string; onChange?: (value: string) => void; onBlur?: () => void }>;
function nodes(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...nodes(element.props.children)];
}
function render() {
  hooks.state.cursor = 0;
  const tree = Workout();
  hooks.commit();
  return tree;
}
function noteInput() {
  return nodes(render()).find((node) => typeof node.type === 'function' && node.type.name === 'MovementNote')!;
}
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

beforeEach(() => {
  hooks.reset();
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), setTimeout });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' });
  backend.workout = {
    id: `warm-note-${expect.getState().currentTestName}`, user_id: 'note-user', split_day_id: 'day',
    date: '2026-10-04', created_at: '2026-10-04T10:00:00Z', completed: false, notes: null,
    sets: [{ id: 'set', workout_id: 'warm-note', exercise_id: 'curl', set_number: 1, completed: false,
      weight: null, reps: null, rpe: null, exercise: { id: 'curl', name: 'Curl' } }],
  } as WorkoutRecord;
  backend.refresh.mockReset().mockResolvedValue();
  backend.updateNotes.mockReset().mockImplementation(async (_id, notes) => {
    backend.workout = { ...backend.workout!, notes };
  });
});

afterEach(async () => {
  hooks.cleanup();
  await tick();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps and saves a newer note typed while the warm mount refresh returns an older saved note', async () => {
  let resolveRefresh!: () => void;
  backend.refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRefresh = resolve; }));
  render();
  await tick();
  const input = noteInput();
  expect(input).toBeDefined();
  input.props.onChange!('New draft B');
  render();
  backend.workout = { ...backend.workout!, notes: serializeWorkoutNotes({ curl: 'Saved note A' }) };
  resolveRefresh();
  await tick();
  render();
  expect(noteInput().props.value).toBe('New draft B');

  await vi.advanceTimersByTimeAsync(1200);
  await tick();
  expect(backend.updateNotes).toHaveBeenCalledTimes(1);
  expect(parseWorkoutNotes(backend.updateNotes.mock.calls[0][1]).movementNotes).toEqual({ curl: 'New draft B' });
  render();
  expect(noteInput().props.value).toBe('New draft B');
});

it('does not acknowledge typing after a slow save as already persisted', async () => {
  let resolveSave!: () => void;
  backend.updateNotes.mockImplementationOnce((_id, notes) => new Promise<void>((resolve) => {
    resolveSave = () => { backend.workout = { ...backend.workout!, notes }; resolve(); };
  }));
  render();
  await tick();
  noteInput().props.onChange!('First save');
  render();
  await vi.advanceTimersByTimeAsync(1200);
  await tick();
  noteInput().props.onChange!('Typed during save');
  render();
  resolveSave();
  await tick();
  render();
  expect(noteInput().props.value).toBe('Typed during save');
  await vi.advanceTimersByTimeAsync(1200);
  await tick();
  expect(backend.updateNotes).toHaveBeenCalledTimes(2);
  expect(parseWorkoutNotes(backend.updateNotes.mock.calls[1][1]).movementNotes).toEqual({ curl: 'Typed during save' });
});
