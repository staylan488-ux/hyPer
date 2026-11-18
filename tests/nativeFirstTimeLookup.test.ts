// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as firstTime from '@/lib/firstTimeTargets';
import type { MovementSetRow } from '@/lib/movementHistory';
import type { MovementHistoryMap } from '@/lib/setTargets';
import type { SessionModel } from '../native/src/lib/sessionModel';
import { loadNativeModule } from './helpers/loadNativeModule';

// The live workout's lookup, for a movement the recent read has nothing on:
// one wider read tells "trained long ago" from "never trained", and only the
// second is a first time (docs/set-targets.md, "The first time").

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frontSquat = { id: 'front', name: 'Front Squat', equipment: 'Barbell' };
const backSquat = { id: 'squat', name: 'Barbell Back Squat', equipment: 'Barbell' };
const legPress = { id: 'press', name: 'Leg Press', equipment: 'Machine' };
const library = [frontSquat, backSquat, legPress];

const model = (doneCount = 0, exercises = [frontSquat]) => ({
  workoutId: 'live',
  date: '2026-11-18',
  doneCount,
  movements: exercises.map((exercise) => ({
    exerciseId: exercise.id,
    sets: [{ exercise }],
    plan: { target_reps_min: 6, target_reps_max: 10 },
  })),
}) as unknown as SessionModel;

const sets = (exerciseId: string, workoutId: string, date: string, figures: Array<[number, number]>): MovementSetRow[] =>
  figures.map(([weight, reps], index) => ({
    id: `${workoutId}-${exerciseId}-${index}`,
    workout_id: workoutId,
    exercise_id: exerciseId,
    set_number: index + 1,
    weight,
    reps,
    completed: true,
    workout: { date, completed: true },
  }));

type Lookup = {
  usePreviousTargetsLookup: (session: SessionModel | null) => void;
  usePreviousTargetsStore: { getState: () => { history: MovementHistoryMap; older: MovementHistoryMap; starts: Record<string, unknown> }; setState: (next: object) => void };
  previousStartsFor: (workoutId: string) => Record<string, unknown>;
  previousHistoryFor: (workoutId: string) => MovementHistoryMap;
};

let root: Root;
let host: HTMLDivElement;
let live: SessionModel;
let lookup: Lookup;
const fetchPreviousTraining = vi.fn();
const fetchMovementSets = vi.fn<(ids: string[]) => Promise<MovementSetRow[] | null>>();

function Probe() {
  lookup.usePreviousTargetsLookup(live);
  return null;
}
const render = () => act(async () => { root.render(createElement(Probe)); });

describe('the lookup for a movement with no recent history', () => {
  beforeEach(() => {
    live = model();
    fetchPreviousTraining.mockReset().mockResolvedValue({ targets: {}, history: {} });
    fetchMovementSets.mockReset().mockResolvedValue([]);
    lookup = loadNativeModule<Lookup>('lib/session.ts', {
      'react-native': { Alert: { alert: vi.fn() } },
      zustand: { create },
      '@/lib/exerciseLibrary': { getExerciseLibrary: async () => library, peekExerciseLibrary: () => library },
      '@/lib/firstTimeTargets': firstTime,
      '@/lib/movementHistory': { fetchMovementSets },
      '@/lib/previousSetTargets': { fetchPreviousTraining, fetchPreviousMovementNotes: vi.fn() },
      '@/stores/appStore': { useAppStore: create(() => ({ currentWorkout: { id: 'live' }, activeSplit: null, splits: [], currentWorkoutDayPlan: null })) },
      '@/stores/authStore': { useAuthStore: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: 'me' } }) },
      './haptics': { haptics: {} },
      './sessionModel': { sessionModelCache: () => () => live },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('starts a movement never trained from a close relative trained lately', async () => {
    fetchMovementSets.mockResolvedValue(sets('squat', 'w1', '2026-11-10', [[200, 8], [200, 7], [200, 6]]));
    await render();
    // The movement and its relative on the same bar; never the machine.
    expect(fetchMovementSets).toHaveBeenCalledTimes(1);
    expect([...fetchMovementSets.mock.calls[0][0]].sort()).toEqual(['front', 'squat']);
    expect(lookup.previousStartsFor('live')).toEqual({ front: { weight: 150, reps: 8, from: 'Barbell Back Squat', step: 5 } });
    expect(lookup.previousHistoryFor('live')).toEqual({});
  });

  it('knows a first time with nothing to start from', async () => {
    await render();
    expect(lookup.previousStartsFor('live')).toEqual({ front: null });
  });

  it('treats a movement trained long ago as a return, not a first time', async () => {
    fetchMovementSets.mockResolvedValue(sets('front', 'old', '2026-03-02', [[135, 8], [135, 8]]));
    await render();
    expect(lookup.previousStartsFor('live')).toEqual({});
    expect(lookup.previousHistoryFor('live')).toEqual({ front: [{ workoutId: 'old', date: '2026-03-02', sets: [{ weight: 135, reps: 8 }, { weight: 135, reps: 8 }] }] });
  });

  it('reads no further when the recent history covers every movement', async () => {
    fetchPreviousTraining.mockResolvedValue({ targets: {}, history: { front: [{ workoutId: 'w1', date: '2026-11-10', sets: [{ weight: 135, reps: 8 }] }] } });
    await render();
    expect(fetchMovementSets).not.toHaveBeenCalled();
    expect(lookup.previousStartsFor('live')).toEqual({});
  });

  it('calls nothing a first time while the wider read has failed, and reads again on the next logged set', async () => {
    fetchMovementSets.mockResolvedValue(null);
    await render();
    expect(lookup.previousStartsFor('live')).toEqual({});
    const tried = fetchMovementSets.mock.calls.length;

    fetchMovementSets.mockResolvedValue([]);
    live = model(1);
    await render();
    expect(fetchMovementSets).toHaveBeenCalledTimes(tried + 1);
    expect(lookup.previousStartsFor('live')).toEqual({ front: null });
  });

  it('reads only the movement added mid-workout, and keeps what it already found', async () => {
    fetchMovementSets.mockResolvedValueOnce(sets('squat', 'w1', '2026-11-10', [[200, 8]]));
    await render();
    fetchMovementSets.mockResolvedValueOnce([]);
    live = model(0, [frontSquat, legPress]);
    await render();
    expect(fetchMovementSets).toHaveBeenCalledTimes(2);
    expect(fetchMovementSets.mock.calls[1][0]).toEqual(['press']);
    expect(lookup.previousStartsFor('live')).toEqual({ front: { weight: 150, reps: 8, from: 'Barbell Back Squat', step: 5 }, press: null });
  });
});
