// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as muscleVolume from '@/lib/muscleVolume';
import type { MuscleSets } from '@/lib/muscleVolume';
import type { SessionModel } from '../native/src/lib/sessionModel';
import { loadNativeModule } from './helpers/loadNativeModule';

// The week Train keeps ready for the Add list: the other workouts' sets and
// the planned week, both landed before the list may lead with what fits.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Module = {
  useWeekFitLookup: (session: SessionModel) => void;
  weekFitFor: (workoutId: string) => { elsewhere: MuscleSets; planned: MuscleSets | null } | null;
  sessionMovementSets: (session: SessionModel) => Array<{ exercise: { name: string }; done: number; left: number }>;
  programExerciseIds: () => Set<string>;
};

const exercise = (id: string, muscle: string, secondary: string | null = null) => ({ id, name: id, equipment: 'machine', muscle_group: muscle, muscle_group_secondary: secondary });
const split = {
  id: 'split', days_per_week: 2,
  days: [
    { id: 'legs', day_name: 'Legs', exercises: [{ exercise_id: 'squat', exercise: exercise('squat', 'quads', 'glutes'), target_sets: 3 }, { exercise_id: 'curl', exercise: exercise('curl', 'hamstrings'), target_sets: 4 }] },
    { id: 'push', day_name: 'Push', exercises: [{ exercise_id: 'bench', exercise: exercise('bench', 'chest', 'triceps'), target_sets: 3 }] },
  ],
};
const session = (workoutId = 'live') => ({
  workoutId,
  movements: [
    { exerciseId: 'squat', done: 2, skipped: false, sets: [{ exercise: exercise('squat', 'quads', 'glutes') }, {}, {}] },
    { exerciseId: 'curl', done: 1, skipped: true, sets: [{ exercise: exercise('curl', 'hamstrings') }, {}, {}] },
    { exerciseId: 'gone', done: 0, skipped: false, sets: [{}] },
  ],
}) as unknown as SessionModel;

let root: Root;
let host: HTMLDivElement;
let weekFit: Module;
let live: SessionModel;
const app = create(() => ({ activeSplit: split as typeof split | null, workoutMode: 'split', currentWorkout: { id: 'live' } }));
const readWeekSetsBesides = vi.fn<(userId: string, workoutId: string) => Promise<MuscleSets>>();
const completions = { loading: false };

function Probe() {
  weekFit.useWeekFitLookup(live);
  return null;
}
const render = () => act(async () => { root.render(createElement(Probe)); });

describe('the week kept ready for the Add list', () => {
  beforeEach(() => {
    live = session();
    completions.loading = false;
    app.setState({ activeSplit: split, workoutMode: 'split' });
    readWeekSetsBesides.mockReset().mockResolvedValue(new Map([['hamstrings', 2]]));
    weekFit = loadNativeModule<Module>('lib/weekFit.ts', {
      zustand: { create },
      '@/hooks/useAdaptiveSplitScheduling': { useAdaptiveSplitScheduling: () => false },
      '@/hooks/usePlanSchedule': { usePlanSchedule: () => ({ schedule: null, loading: false }) },
      '@/hooks/useScheduleWorkouts': { useScheduleWorkouts: () => ({ workouts: [], loading: completions.loading }) },
      '@/lib/muscleVolume': muscleVolume,
      '@/lib/weekSetsRead': { readWeekSetsBesides },
      '@/stores/appStore': { useAppStore: app },
      '@/stores/authStore': { useAuthStore: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: 'me' } }) },
      './accountData': {
        useAccountDay: (select: (state: { dayKey: string }) => unknown) => select({ dayKey: '2026-11-18' }),
        useWorkoutsRevision: (select: (state: { revision: number }) => unknown) => select({ revision: 0 }),
      },
      './today': { useScheduleRevision: (select: (state: { revision: number }) => unknown) => select({ revision: 0 }) },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('holds the other workouts’ sets and the program’s week once both have landed', async () => {
    expect(weekFit.weekFitFor('live')).toBeNull();
    await render();
    expect(readWeekSetsBesides).toHaveBeenCalledWith('me', 'live');
    const week = weekFit.weekFitFor('live')!;
    expect([...week.elsewhere]).toEqual([['hamstrings', 2]]);
    // Both days once: a squat's 3 sets are 1.5 for the glutes, a bench's 3 are 1.5 for the triceps.
    expect(Object.fromEntries(week.planned!)).toEqual({ quads: 3, glutes: 1.5, hamstrings: 4, chest: 3, triceps: 1.5 });
    expect(weekFit.weekFitFor('another')).toBeNull();
  });

  it('is not ready while the plan’s completions are still loading, or when the read fails', async () => {
    completions.loading = true;
    await render();
    expect(weekFit.weekFitFor('live')).toBeNull();
    completions.loading = false;
    await render();
    expect(weekFit.weekFitFor('live')).not.toBeNull();

    live = session('next');
    readWeekSetsBesides.mockRejectedValue(new Error('offline'));
    await render();
    expect(weekFit.weekFitFor('next')).toBeNull();
    expect(weekFit.weekFitFor('live')).toBeNull();
  });

  it('has no planned week without a program', async () => {
    app.setState({ workoutMode: 'flexible' });
    await render();
    expect(weekFit.weekFitFor('live')).toEqual({ elsewhere: new Map([['hamstrings', 2]]), planned: null });
  });

  it('reads today’s movements with their sets done and still to come', () => {
    expect(weekFit.sessionMovementSets(live).map((entry) => [entry.exercise.name, entry.done, entry.left])).toEqual([
      ['squat', 2, 1],
      // Skipped: its unlogged sets will not be done.
      ['curl', 1, 0],
    ]);
    expect([...weekFit.programExerciseIds()].sort()).toEqual(['bench', 'curl', 'squat']);
  });
});
