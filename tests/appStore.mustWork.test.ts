import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workout, WorkoutSet } from '@/types';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

import { useAppStore } from '@/stores/appStore';

type Chain = {
  error: null;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function createChain(overrides: Partial<Chain> = {}): Chain {
  const chain = {
    error: null,
    update: vi.fn(),
    upsert: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  } as unknown as Chain;

  chain.update.mockImplementation(() => chain);
  chain.upsert.mockImplementation(() => chain);
  chain.insert.mockImplementation(() => chain);
  chain.delete.mockImplementation(() => chain);
  chain.eq.mockImplementation(() => chain);
  chain.order.mockImplementation(() => chain);
  chain.select.mockImplementation(() => chain);
  chain.single.mockResolvedValue({ data: null, error: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });

  Object.assign(chain, overrides);
  return chain;
}

function makeWorkoutWithSet(set: WorkoutSet): Workout {
  return {
    id: 'workout-1',
    user_id: 'user-1',
    split_day_id: 'split-day-1',
    date: '2026-02-14',
    notes: null,
    completed: false,
    sets: [set],
  };
}

beforeEach(() => {
  supabaseMock.from.mockReset();
  supabaseMock.auth.getUser.mockReset();

  useAppStore.setState({
    activeSplit: null,
    splits: [],
    currentWorkout: null,
    macroTarget: null,
    volumeLandmarks: [],
    weeklyVolume: [],
    loading: false,
  });
});

describe('must-work store contracts', () => {
  it('resumes today\'s in-progress workout instead of creating duplicate', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    const existingWorkout: Workout = {
      id: 'workout-existing',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-14',
      notes: null,
      completed: false,
      sets: [
        {
          id: 'set-1',
          workout_id: 'workout-existing',
          exercise_id: 'exercise-1',
          set_number: 1,
          weight: null,
          reps: null,
          rpe: null,
          completed: false,
          completed_at: null,
        },
      ],
    };

    const workoutsChain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: existingWorkout, error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().startWorkout('split-day-1');

    expect(result).toEqual(existingWorkout);
    expect(useAppStore.getState().currentWorkout).toEqual(existingWorkout);
    expect(workoutsChain.insert).not.toHaveBeenCalled();
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('logs a set and updates latest workout state (stale-closure guard)', async () => {
    const firstSet: WorkoutSet = {
      id: 'set-1',
      workout_id: 'workout-1',
      exercise_id: 'exercise-1',
      set_number: 1,
      weight: null,
      reps: null,
      rpe: null,
      completed: false,
      completed_at: null,
    };

    const secondSet: WorkoutSet = {
      id: 'set-2',
      workout_id: 'workout-1',
      exercise_id: 'exercise-2',
      set_number: 1,
      weight: null,
      reps: null,
      rpe: null,
      completed: false,
      completed_at: null,
    };

    const baseWorkout = makeWorkoutWithSet(firstSet);
    useAppStore.setState({ currentWorkout: baseWorkout });

    const deferred: { resolve: (value: { data: WorkoutSet; error: null }) => void } = {
      resolve: (value) => {
        void value;
      },
    };
    const singlePromise = new Promise<{ data: WorkoutSet; error: null }>((resolve) => {
      deferred.resolve = resolve;
    });

    const setsChain = createChain({
      single: vi.fn(() => singlePromise),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') return setsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const logSetPromise = useAppStore.getState().logSet('exercise-1', 1, 225, 6, 8.5);

    useAppStore.setState({
      currentWorkout: {
        ...baseWorkout,
        sets: [firstSet, secondSet],
      },
    });

    deferred.resolve({
      data: {
        ...firstSet,
        weight: 225,
        reps: 6,
        rpe: 8.5,
        completed: true,
        completed_at: '2026-02-14T12:00:00.000Z',
      },
      error: null,
    });

    await logSetPromise;

    const currentWorkout = useAppStore.getState().currentWorkout;
    expect(currentWorkout?.sets).toHaveLength(2);
    expect(currentWorkout?.sets[0]).toMatchObject({
      id: 'set-1',
      weight: 225,
      reps: 6,
      rpe: 8.5,
      completed: true,
    });
    expect(currentWorkout?.sets[1].id).toBe('set-2');

    expect(setsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        weight: 225,
        reps: 6,
        rpe: 8.5,
        completed: true,
      })
    );
    expect(setsChain.eq).toHaveBeenNthCalledWith(1, 'workout_id', 'workout-1');
    expect(setsChain.eq).toHaveBeenNthCalledWith(2, 'exercise_id', 'exercise-1');
    expect(setsChain.eq).toHaveBeenNthCalledWith(3, 'set_number', 1);
  });

  it('edits a past workout set locally after update call', async () => {
    const set: WorkoutSet = {
      id: 'set-1',
      workout_id: 'workout-1',
      exercise_id: 'exercise-1',
      set_number: 1,
      weight: 185,
      reps: 8,
      rpe: 8,
      completed: true,
      completed_at: '2026-02-14T12:00:00.000Z',
    };

    useAppStore.setState({ currentWorkout: makeWorkoutWithSet(set) });
    const setsChain = createChain();

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') return setsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().updateSet('set-1', {
      weight: 195,
      reps: 6,
      rpe: 9,
    });

    const currentSet = useAppStore.getState().currentWorkout?.sets[0];
    expect(currentSet).toMatchObject({
      id: 'set-1',
      weight: 195,
      reps: 6,
      rpe: 9,
    });
    expect(setsChain.update).toHaveBeenCalledWith({ weight: 195, reps: 6, rpe: 9 });
    expect(setsChain.eq).toHaveBeenCalledWith('id', 'set-1');
  });

  it('sets active split and refreshes splits', async () => {
    const splits = [
      { id: 'split-a', is_active: true },
      { id: 'split-b', is_active: false },
    ] as unknown as { id: string; is_active: boolean }[];

    const fetchSplitsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      splits: splits as unknown as ReturnType<typeof useAppStore.getState>['splits'],
      fetchSplits: fetchSplitsSpy,
    });

    const splitsChain = createChain();
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'splits') return splitsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().setActiveSplit('split-b');

    expect(splitsChain.update).toHaveBeenCalledTimes(3);
    expect(splitsChain.update).toHaveBeenNthCalledWith(1, { is_active: false });
    expect(splitsChain.update).toHaveBeenNthCalledWith(2, { is_active: false });
    expect(splitsChain.update).toHaveBeenNthCalledWith(3, { is_active: true });
    expect(splitsChain.eq).toHaveBeenNthCalledWith(1, 'id', 'split-a');
    expect(splitsChain.eq).toHaveBeenNthCalledWith(2, 'id', 'split-b');
    expect(splitsChain.eq).toHaveBeenNthCalledWith(3, 'id', 'split-b');
    expect(fetchSplitsSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes a split and refreshes split list', async () => {
    const fetchSplitsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ fetchSplits: fetchSplitsSpy });

    const splitsChain = createChain();
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'splits') return splitsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().deleteSplit('split-z');

    expect(splitsChain.delete).toHaveBeenCalledTimes(1);
    expect(splitsChain.eq).toHaveBeenCalledWith('id', 'split-z');
    expect(fetchSplitsSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes workout sets before deleting the workout', async () => {
    const setsChain = createChain();
    const workoutsChain = createChain();

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') return setsChain;
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().deleteWorkout('workout-42');

    expect(setsChain.delete).toHaveBeenCalledTimes(1);
    expect(setsChain.eq).toHaveBeenCalledWith('workout_id', 'workout-42');
    expect(workoutsChain.delete).toHaveBeenCalledTimes(1);
    expect(workoutsChain.eq).toHaveBeenCalledWith('id', 'workout-42');
  });

  it('upserts macro targets by user_id and stores saved target', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    const savedTarget = {
      id: 'macro-1',
      user_id: 'user-1',
      calories: 2300,
      protein: 180,
      carbs: 240,
      fat: 70,
      created_at: '2026-02-15T10:00:00.000Z',
    };

    const macroTargetsChain = createChain({
      single: vi.fn().mockResolvedValue({ data: savedTarget, error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'macro_targets') return macroTargetsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().updateMacroTarget({
      calories: 2300,
      protein: 180,
      carbs: 240,
      fat: 70,
    });

    expect(macroTargetsChain.upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        calories: 2300,
        protein: 180,
        carbs: 240,
        fat: 70,
      },
      { onConflict: 'user_id' }
    );
    expect(useAppStore.getState().macroTarget).toEqual(savedTarget);
  });
});
