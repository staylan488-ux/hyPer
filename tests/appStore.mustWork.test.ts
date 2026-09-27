import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivitySegment, ActivitySession, Workout, WorkoutSet } from '@/types';
import type { FinishedRun } from '@/lib/runTracker';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

const whoopClientMock = vi.hoisted(() => ({
  fetchWhoopBatchRemote: vi.fn(),
}));

vi.mock('@/lib/whoopClient', () => ({
  fetchWhoopBatchRemote: whoopClientMock.fetchWhoopBatchRemote,
  startWhoopConnect: vi.fn(),
  disconnectWhoopRemote: vi.fn(),
}));

import { useAppStore } from '@/stores/appStore';

const defaultActivityActions = {
  createActivitySession: useAppStore.getState().createActivitySession,
  upsertActivitySegments: useAppStore.getState().upsertActivitySegments,
};

type Chain = {
  error: null;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  abortSignal: ReturnType<typeof vi.fn>;
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
    neq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    abortSignal: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  } as unknown as Chain;

  chain.update.mockImplementation(() => chain);
  chain.upsert.mockImplementation(() => chain);
  chain.insert.mockImplementation(() => chain);
  chain.delete.mockImplementation(() => chain);
  chain.eq.mockImplementation(() => chain);
  chain.neq.mockImplementation(() => chain);
  chain.in.mockImplementation(() => chain);
  chain.gte.mockImplementation(() => chain);
  chain.lte.mockImplementation(() => chain);
  chain.order.mockImplementation(() => chain);
  chain.limit.mockImplementation(() => chain);
  chain.select.mockImplementation(() => chain);
  chain.abortSignal.mockImplementation(() => chain);
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
    workoutMode: 'split',
    currentWorkoutDayPlan: null,
    flexTemplates: [],
    macroTarget: null,
    volumeLandmarks: [],
    weeklyVolume: [],
    loading: false,
    ...defaultActivityActions,
  });
});

describe('must-work store contracts', () => {
  it('resumes the latest in-progress workout instead of creating duplicate after midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-15T01:00:00.000Z'));

    try {
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
      created_at: '2026-02-14T23:30:00.000Z',
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
    expect(workoutsChain.eq).toHaveBeenCalledWith('completed', false);
    expect(workoutsChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(workoutsChain.limit).toHaveBeenCalledWith(1);
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetches the latest incomplete workout even when the calendar day has rolled over', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-15T01:00:00.000Z'));

    try {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    const overnightWorkout: Workout = {
      id: 'workout-overnight',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-14',
      notes: null,
      completed: false,
      created_at: '2026-02-14T23:45:00.000Z',
      sets: [],
    };

    const workoutsChain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: overnightWorkout, error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      if (table === 'workout_day_plans') return createChain();
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().fetchCurrentWorkout();

    expect(useAppStore.getState().currentWorkout).toEqual(overnightWorkout);
    expect(workoutsChain.eq).toHaveBeenCalledWith('completed', false);
    expect(workoutsChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(workoutsChain.limit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not resume a stale incomplete workout that is older than 24 hours', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    const staleWorkout: Workout = {
      id: 'workout-stale',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-10',
      notes: null,
      completed: false,
      created_at: '2026-02-10T08:00:00.000Z',
      sets: [],
    };

    const existingWorkoutChain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: staleWorkout, error: null }),
    });

    const insertedWorkout = {
      id: 'workout-new',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-14',
      notes: null,
      completed: false,
      created_at: '2026-02-14T12:00:00.000Z',
    };

    const insertWorkoutChain = createChain({
      single: vi.fn().mockResolvedValue({ data: insertedWorkout, error: null }),
    });

    const splitExercisesChain = createChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const fetchWorkoutChain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { ...insertedWorkout, sets: [] },
        error: null,
      }),
    });

    let workoutCalls = 0;
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') {
        workoutCalls += 1;
        if (workoutCalls === 1) return existingWorkoutChain;
        if (workoutCalls === 2) return insertWorkoutChain;
        return fetchWorkoutChain;
      }
      if (table === 'split_exercises') return splitExercisesChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().startWorkout('split-day-1');

    expect(result?.id).toBe('workout-new');
    expect(insertWorkoutChain.insert).toHaveBeenCalledTimes(1);
  });

  it('adds a new set with next set number and updates workout state', async () => {
    const currentWorkout: Workout = {
      id: 'workout-1',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-14',
      notes: null,
      completed: false,
      sets: [
        {
          id: 'set-1',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          set_number: 1,
          weight: null,
          reps: null,
          rpe: null,
          completed: true,
          completed_at: '2026-02-14T12:00:00.000Z',
        },
        {
          id: 'set-2',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          set_number: 2,
          weight: null,
          reps: null,
          rpe: null,
          completed: false,
          completed_at: null,
        },
      ],
    };

    useAppStore.setState({ currentWorkout });

    const createdSet: WorkoutSet = {
      id: 'set-3',
      workout_id: 'workout-1',
      exercise_id: 'exercise-1',
      set_number: 3,
      weight: null,
      reps: null,
      rpe: null,
      completed: false,
      completed_at: null,
    };

    const setsChain = createChain({
      single: vi.fn().mockResolvedValue({ data: createdSet, error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') return setsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().addWorkoutSet('exercise-1');

    const updatedWorkout = useAppStore.getState().currentWorkout;
    expect(updatedWorkout?.sets).toHaveLength(3);
    expect(updatedWorkout?.sets.find((set) => set.id === 'set-3')).toMatchObject({
      exercise_id: 'exercise-1',
      set_number: 3,
      completed: false,
    });

    expect(setsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workout_id: 'workout-1',
        exercise_id: 'exercise-1',
        set_number: 3,
        completed: false,
      })
    );
  });

  it('blocks workout mode switch while a workout is in progress', async () => {
    useAppStore.setState({
      currentWorkout: {
        id: 'workout-open',
        user_id: 'user-1',
        split_day_id: null,
        date: '2026-02-19',
        notes: null,
        completed: false,
        sets: [],
      },
      workoutMode: 'split',
    });

    const result = await useAppStore.getState().setWorkoutMode('flexible');

    expect(result.ok).toBe(false);
    expect(useAppStore.getState().workoutMode).toBe('split');
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('persists workout mode when no workout is active', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    useAppStore.setState({ currentWorkout: null, workoutMode: 'split' });

    const preferencesChain = createChain();

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'program_preferences') return preferencesChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().setWorkoutMode('flexible');

    expect(result.ok).toBe(true);
    expect(useAppStore.getState().workoutMode).toBe('flexible');
    expect(preferencesChain.upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        workout_mode: 'flexible',
      },
      { onConflict: 'user_id' }
    );
  });

  it('removes only the last uncompleted set for an exercise', async () => {
    const currentWorkout: Workout = {
      id: 'workout-1',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-14',
      notes: null,
      completed: false,
      sets: [
        {
          id: 'set-1',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          set_number: 1,
          weight: 185,
          reps: 8,
          rpe: 8,
          completed: true,
          completed_at: '2026-02-14T12:00:00.000Z',
        },
        {
          id: 'set-2',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          set_number: 2,
          weight: null,
          reps: null,
          rpe: null,
          completed: false,
          completed_at: null,
        },
        {
          id: 'set-3',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          set_number: 3,
          weight: null,
          reps: null,
          rpe: null,
          completed: false,
          completed_at: null,
        },
      ],
    };

    useAppStore.setState({ currentWorkout });

    const setsChain = createChain();

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') return setsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().removeLastUncompletedSet('exercise-1');

    const updatedWorkout = useAppStore.getState().currentWorkout;
    expect(updatedWorkout?.sets).toHaveLength(2);
    expect(updatedWorkout?.sets.find((set) => set.id === 'set-3')).toBeUndefined();
    expect(updatedWorkout?.sets.find((set) => set.id === 'set-2')).toBeDefined();

    expect(setsChain.delete).toHaveBeenCalledTimes(1);
    expect(setsChain.eq).toHaveBeenCalledWith('id', 'set-3');
  });

  it('saves flexible template from current workout and includes movement notes', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    useAppStore.setState({
      currentWorkout: {
        id: 'workout-1',
        user_id: 'user-1',
        split_day_id: null,
        date: '2026-02-19',
        notes: JSON.stringify({ movementNotes: { 'exercise-1': 'Keep elbows tucked' } }),
        completed: false,
        sets: [],
      },
      currentWorkoutDayPlan: {
        id: 'plan-1',
        workout_id: 'workout-1',
        day_label: 'Upper',
        items: [
          {
            exercise_id: 'exercise-1',
            exercise_name: 'Barbell Bench Press',
            order: 0,
            target_sets: 3,
            target_reps_min: 6,
            target_reps_max: 8,
            notes: null,
            hidden: false,
          },
        ],
      },
    });

    const templateUpsertChain = createChain();
    const templateFetchChain = createChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'flex_day_templates') {
        if (templateUpsertChain.select.mock.calls.length > 0 || templateUpsertChain.upsert.mock.calls.length > 0) {
          return templateFetchChain;
        }
        return templateUpsertChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().saveFlexibleTemplateFromCurrentWorkout();

    expect(templateUpsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        label: 'Upper',
        items: expect.arrayContaining([
          expect.objectContaining({
            exercise_id: 'exercise-1',
            notes: 'Keep elbows tucked',
          }),
        ]),
      }),
      { onConflict: 'user_id,label' }
    );
  });

  it('does not remove sets when only completed sets exist', async () => {
    const currentWorkout: Workout = {
      id: 'workout-1',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-14',
      notes: null,
      completed: false,
      sets: [
        {
          id: 'set-1',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          set_number: 1,
          weight: 185,
          reps: 8,
          rpe: 8,
          completed: true,
          completed_at: '2026-02-14T12:00:00.000Z',
        },
      ],
    };

    useAppStore.setState({ currentWorkout });

    await useAppStore.getState().removeLastUncompletedSet('exercise-1');

    expect(useAppStore.getState().currentWorkout?.sets).toHaveLength(1);
    expect(supabaseMock.from).not.toHaveBeenCalled();
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
    expect(setsChain.eq).toHaveBeenNthCalledWith(2, 'id', 'set-1');
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

  it('persists set updates even when no workout is active', async () => {
    useAppStore.setState({ currentWorkout: null });
    const setsChain = createChain();

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') return setsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().updateSet('set-99', {
      weight: 135,
      reps: 12,
      completed: true,
    });

    expect(setsChain.update).toHaveBeenCalledWith({
      weight: 135,
      reps: 12,
      completed: true,
    });
    expect(setsChain.eq).toHaveBeenCalledWith('id', 'set-99');
  });

  it('adds set to workout using next set number and returns created set', async () => {
    const currentWorkout: Workout = {
      id: 'workout-1',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-14',
      notes: null,
      completed: false,
      sets: [
        {
          id: 'set-1',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          set_number: 1,
          weight: null,
          reps: null,
          rpe: null,
          completed: false,
          completed_at: null,
        },
        {
          id: 'set-2',
          workout_id: 'workout-1',
          exercise_id: 'exercise-1',
          set_number: 2,
          weight: null,
          reps: null,
          rpe: null,
          completed: false,
          completed_at: null,
        },
      ],
    };

    useAppStore.setState({ currentWorkout });

    const selectChain = createChain({
      order: vi.fn().mockResolvedValue({ data: [{ set_number: 1 }, { set_number: 2 }], error: null }),
    });

    const createdSet: WorkoutSet = {
      id: 'set-3',
      workout_id: 'workout-1',
      exercise_id: 'exercise-1',
      set_number: 3,
      weight: null,
      reps: null,
      rpe: null,
      completed: false,
      completed_at: null,
    };

    const insertChain = createChain({
      single: vi.fn().mockResolvedValue({ data: createdSet, error: null }),
    });

    let setsCalls = 0;
    supabaseMock.from.mockImplementation((table: string) => {
      if (table !== 'sets') throw new Error(`Unexpected table: ${table}`);
      setsCalls += 1;
      return setsCalls === 1 ? selectChain : insertChain;
    });

    const result = await useAppStore.getState().addSetToWorkout('workout-1', 'exercise-1');

    expect(result?.set_number).toBe(3);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workout_id: 'workout-1',
        exercise_id: 'exercise-1',
        set_number: 3,
      })
    );
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.id)).toContain('set-3');
  });

  it('removes selected set and compacts remaining set numbers', async () => {
    useAppStore.setState({
      currentWorkout: {
        id: 'workout-1',
        user_id: 'user-1',
        split_day_id: 'split-day-1',
        date: '2026-02-14',
        notes: null,
        completed: false,
        sets: [
          {
            id: 'set-1',
            workout_id: 'workout-1',
            exercise_id: 'exercise-1',
            set_number: 1,
            weight: null,
            reps: null,
            rpe: null,
            completed: false,
            completed_at: null,
          },
          {
            id: 'set-2',
            workout_id: 'workout-1',
            exercise_id: 'exercise-1',
            set_number: 2,
            weight: null,
            reps: null,
            rpe: null,
            completed: false,
            completed_at: null,
          },
          {
            id: 'set-3',
            workout_id: 'workout-1',
            exercise_id: 'exercise-1',
            set_number: 3,
            weight: null,
            reps: null,
            rpe: null,
            completed: false,
            completed_at: null,
          },
        ],
      },
    });

    const deleteChain = createChain();
    const remainingChain = createChain({
      order: vi.fn().mockResolvedValue({
        data: [
          { id: 'set-1', set_number: 1 },
          { id: 'set-3', set_number: 3 },
        ],
        error: null,
      }),
    });
    const renumberChain = createChain();

    let setsCalls = 0;
    supabaseMock.from.mockImplementation((table: string) => {
      if (table !== 'sets') throw new Error(`Unexpected table: ${table}`);
      setsCalls += 1;
      if (setsCalls === 1) return deleteChain;
      if (setsCalls === 2) return remainingChain;
      return renumberChain;
    });

    await useAppStore.getState().removeSetFromWorkout('workout-1', 'exercise-1', 'set-2');

    expect(deleteChain.delete).toHaveBeenCalledTimes(1);
    expect(renumberChain.update).toHaveBeenCalledWith({ set_number: 2 });
    const exerciseSets = (useAppStore.getState().currentWorkout?.sets || [])
      .filter((set) => set.exercise_id === 'exercise-1')
      .sort((a, b) => a.set_number - b.set_number);
    expect(exerciseSets.map((set) => [set.id, set.set_number])).toEqual([
      ['set-1', 1],
      ['set-3', 2],
    ]);
  });

  it('adds exercise to workout with default one set and updates plan items', async () => {
    const selectChain = createChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const createdSet: WorkoutSet = {
      id: 'set-1',
      workout_id: 'workout-1',
      exercise_id: 'exercise-9',
      set_number: 1,
      weight: null,
      reps: null,
      rpe: null,
      completed: false,
      completed_at: null,
    };

    const insertChain = createChain({
      single: vi.fn().mockResolvedValue({ data: createdSet, error: null }),
    });

    let setsCalls = 0;
    supabaseMock.from.mockImplementation((table: string) => {
      if (table !== 'sets') throw new Error(`Unexpected table: ${table}`);
      setsCalls += 1;
      return setsCalls === 1 ? selectChain : insertChain;
    });

    const ensurePlanSpy = vi.fn().mockResolvedValue({
      id: 'plan-1',
      workout_id: 'workout-1',
      day_label: 'Upper',
      items: [],
    });
    const updatePlanSpy = vi.fn().mockResolvedValue({
      id: 'plan-1',
      workout_id: 'workout-1',
      day_label: 'Upper',
      items: [],
    });

    useAppStore.setState({
      ensureWorkoutDayPlan: ensurePlanSpy,
      updateWorkoutDayPlanItems: updatePlanSpy,
    });

    const exercise = {
      id: 'exercise-9',
      name: 'Ring Pull-Up',
      muscle_group: 'back',
      muscle_group_secondary: null,
      equipment: 'rings',
      is_compound: true,
    };

    const result = await useAppStore.getState().addExerciseToWorkout('workout-1', exercise);

    expect(result?.set_number).toBe(1);
    expect(updatePlanSpy).toHaveBeenCalled();
    const plannedItemsArg = updatePlanSpy.mock.calls[0][1] as Array<{ exercise_id: string; target_sets?: number }>;
    expect(plannedItemsArg[0]).toMatchObject({
      exercise_id: 'exercise-9',
      target_sets: 1,
    });
  });

  it('removes exercise sets from workout', async () => {
    useAppStore.setState({
      currentWorkout: {
        id: 'workout-1',
        user_id: 'user-1',
        split_day_id: null,
        date: '2026-02-14',
        notes: null,
        completed: false,
        sets: [
          {
            id: 'set-a',
            workout_id: 'workout-1',
            exercise_id: 'exercise-1',
            set_number: 1,
            weight: null,
            reps: null,
            rpe: null,
            completed: false,
            completed_at: null,
          },
          {
            id: 'set-b',
            workout_id: 'workout-1',
            exercise_id: 'exercise-2',
            set_number: 1,
            weight: null,
            reps: null,
            rpe: null,
            completed: false,
            completed_at: null,
          },
        ],
      },
      fetchWorkoutDayPlanByWorkoutId: vi.fn().mockResolvedValue(null),
    });

    const setsChain = createChain();
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') return setsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().removeExerciseFromWorkout('workout-1', 'exercise-1');

    expect(setsChain.delete).toHaveBeenCalledTimes(1);
    expect(setsChain.eq).toHaveBeenCalledWith('workout_id', 'workout-1');
    expect(setsChain.eq).toHaveBeenCalledWith('exercise_id', 'exercise-1');
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.id)).toEqual(['set-b']);
  });

  it('syncs workout completion from set completion counts', async () => {
    useAppStore.setState({
      currentWorkout: {
        id: 'workout-1',
        user_id: 'user-1',
        split_day_id: null,
        date: '2026-02-14',
        notes: null,
        completed: false,
        sets: [],
      },
    });

    const setsChain = createChain();
    setsChain.eq.mockImplementation(() => Promise.resolve({
      data: [
        { id: 'set-1', completed: true, completed_at: '2026-03-10T12:20:00.000Z' },
        { id: 'set-2', completed: true, completed_at: '2026-03-10T12:35:00.000Z' },
      ],
      error: null,
    }));

    const workoutsChain = createChain();

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') {
        return setsChain;
      }
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().syncWorkoutCompletion('workout-1');

    expect(result).toEqual({
      totalSets: 2,
      completedSets: 2,
      completed: true,
    });
    expect(workoutsChain.update).toHaveBeenCalledWith({
      completed: true,
      completed_at: '2026-03-10T12:35:00.000Z',
    });
    expect(workoutsChain.eq).toHaveBeenCalledWith('id', 'workout-1');
    expect(useAppStore.getState().currentWorkout?.completed).toBe(true);
    expect(useAppStore.getState().currentWorkout?.completed_at).toBe('2026-03-10T12:35:00.000Z');
  });

  it('marks a workout complete with the latest completed set timestamp', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
    });

    useAppStore.setState({
      currentWorkout: {
        id: 'workout-1',
        user_id: 'user-1',
        split_day_id: 'split-day-1',
        date: '2026-03-10',
        notes: null,
        completed: false,
        created_at: '2026-03-10T11:00:00.000Z',
        completed_at: null,
        sets: [
          {
            id: 'set-1',
            workout_id: 'workout-1',
            exercise_id: 'exercise-1',
            set_number: 1,
            weight: 185,
            reps: 8,
            rpe: 8,
            completed: true,
            completed_at: '2026-03-10T11:20:00.000Z',
          },
          {
            id: 'set-2',
            workout_id: 'workout-1',
            exercise_id: 'exercise-1',
            set_number: 2,
            weight: 185,
            reps: 8,
            rpe: 8,
            completed: true,
            completed_at: '2026-03-10T11:42:00.000Z',
          },
        ],
      },
    });

    const workoutsChain = createChain();

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().completeWorkout();

    expect(workoutsChain.update).toHaveBeenCalledWith({
      completed: true,
      completed_at: '2026-03-10T11:42:00.000Z',
    });
    expect(workoutsChain.eq).toHaveBeenCalledWith('id', 'workout-1');
    expect(useAppStore.getState().currentWorkout).toBeNull();
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
        // Stamped on every write so the adaptive loop can tell how fresh a
        // target is; the exact instant is not part of the contract.
        updated_at: expect.any(String),
      },
      { onConflict: 'user_id' }
    );
    expect(useAppStore.getState().macroTarget).toEqual(savedTarget);
  });

  it('calculates weekly volume from completed sets even when workout is unfinished', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    const workouts = [
      {
        id: 'workout-1',
        completed: false,
        sets: [
          {
            completed: true,
            exercise: {
              muscle_group: 'chest',
              muscle_group_secondary: 'triceps',
            },
          },
          {
            completed: false,
            exercise: {
              muscle_group: 'back',
              muscle_group_secondary: null,
            },
          },
        ],
      },
    ];

    const workoutsChain = createChain({
      lte: vi.fn().mockResolvedValue({ data: workouts, error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().calculateWeeklyVolume();

    const weeklyVolume = useAppStore.getState().weeklyVolume;
    expect(weeklyVolume).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ muscle_group: 'chest', weekly_sets: 1 }),
        expect.objectContaining({ muscle_group: 'triceps', weekly_sets: 0.5 }),
      ])
    );
    expect(workoutsChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(workoutsChain.eq).toHaveBeenCalledWith('sets.completed', true);
    expect(workoutsChain.eq).not.toHaveBeenCalledWith('completed', true);
  });

  it('does not count incomplete sets in weekly volume', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
    });

    useAppStore.setState({
      weeklyVolume: [{
        muscle_group: 'chest',
        weekly_sets: 4,
        status: 'below_mev',
      }],
    });

    const workouts = [
      {
        id: 'workout-1',
        completed: false,
        sets: [
          {
            completed: false,
            exercise: {
              muscle_group: 'chest',
              muscle_group_secondary: null,
            },
          },
        ],
      },
    ];

    const workoutsChain = createChain({
      lte: vi.fn().mockResolvedValue({ data: workouts, error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().calculateWeeklyVolume();

    expect(useAppStore.getState().weeklyVolume).toEqual([]);
  });

  it('adds flexible superset and inserts partner sets', async () => {
    const fetchWorkoutChain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'workout-1',
          user_id: 'user-1',
          split_day_id: null,
          date: '2026-02-21',
          notes: null,
          completed: false,
          sets: [
            {
              id: 'set-a1',
              workout_id: 'workout-1',
              exercise_id: 'exercise-a',
              set_number: 1,
              completed: false,
              weight: null,
              reps: null,
              rpe: null,
              completed_at: null,
            },
            {
              id: 'set-a2',
              workout_id: 'workout-1',
              exercise_id: 'exercise-a',
              set_number: 2,
              completed: false,
              weight: null,
              reps: null,
              rpe: null,
              completed_at: null,
            },
            {
              id: 'set-a3',
              workout_id: 'workout-1',
              exercise_id: 'exercise-a',
              set_number: 3,
              completed: false,
              weight: null,
              reps: null,
              rpe: null,
              completed_at: null,
            },
          ],
        },
        error: null,
      }),
    });

    const plansChain = createChain({
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'plan-1',
          workout_id: 'workout-1',
          day_label: 'Upper',
          items: [
            {
              exercise_id: 'exercise-a',
              exercise_name: 'Bench Press',
              order: 0,
              target_sets: 3,
              target_reps_min: 8,
              target_reps_max: 12,
              notes: null,
              hidden: false,
              superset_group_id: 'group-1',
            },
            {
              exercise_id: 'exercise-b',
              exercise_name: 'Row',
              order: 1,
              target_sets: 3,
              target_reps_min: 8,
              target_reps_max: 12,
              notes: null,
              hidden: false,
              superset_group_id: 'group-1',
            },
          ],
        },
        error: null,
      }),
    });

    const setsInsertChain = createChain();

    useAppStore.setState({
      currentWorkout: {
        id: 'workout-1',
        user_id: 'user-1',
        split_day_id: null,
        date: '2026-02-21',
        notes: null,
        completed: false,
        sets: [
          {
            id: 'set-a1',
            workout_id: 'workout-1',
            exercise_id: 'exercise-a',
            set_number: 1,
            completed: false,
            weight: null,
            reps: null,
            rpe: null,
            completed_at: null,
          },
          {
            id: 'set-a2',
            workout_id: 'workout-1',
            exercise_id: 'exercise-a',
            set_number: 2,
            completed: false,
            weight: null,
            reps: null,
            rpe: null,
            completed_at: null,
          },
          {
            id: 'set-a3',
            workout_id: 'workout-1',
            exercise_id: 'exercise-a',
            set_number: 3,
            completed: false,
            weight: null,
            reps: null,
            rpe: null,
            completed_at: null,
          },
        ],
      },
      currentWorkoutDayPlan: {
        id: 'plan-1',
        workout_id: 'workout-1',
        day_label: 'Upper',
        items: [
          {
            exercise_id: 'exercise-a',
            exercise_name: 'Bench Press',
            order: 0,
            target_sets: 3,
            target_reps_min: 8,
            target_reps_max: 12,
            notes: null,
            hidden: false,
            superset_group_id: null,
          },
        ],
      },
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workout_day_plans') return plansChain;
      if (table === 'sets') return setsInsertChain;
      if (table === 'workouts') return fetchWorkoutChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().addFlexibleSuperset('exercise-a', {
      id: 'exercise-b',
      name: 'Row',
      muscle_group: 'back',
      muscle_group_secondary: null,
      equipment: 'barbell',
      is_compound: true,
    });

    expect(plansChain.update).toHaveBeenCalled();
    expect(setsInsertChain.insert).toHaveBeenCalledTimes(3);

    const updatedPlan = useAppStore.getState().currentWorkoutDayPlan;
    const groupIds = new Set((updatedPlan?.items || []).map((item) => item.superset_group_id).filter(Boolean));
    expect(groupIds.size).toBe(1);
  });

  it('reuses an existing GPS session when a tracked-run save is retried', async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const run: FinishedRun = {
      runId: 'stable-run-id',
      mode: 'free',
      startedAtMs: Date.parse('2026-07-12T14:00:00.000Z'),
      endedAtMs: Date.parse('2026-07-12T14:30:00.000Z'),
      totalDistanceM: 5000,
      elapsedS: 1800,
      laps: [],
      reps: [],
    };
    const existingSession: ActivitySession = {
      id: 'existing-gps-session',
      user_id: 'user-1',
      activity_type: 'run',
      title: null,
      date: '2026-07-12',
      started_at: '2026-07-12T14:00:00.000Z',
      ended_at: null,
      duration_seconds: 1800,
      source: 'gps',
      notes: null,
      strain: null,
      avg_hr: null,
      max_hr: null,
      energy_kcal: null,
      distance_m: 5000,
      auto_grouped: false,
      user_edited: false,
      dismissed_at: null,
      created_at: '2026-07-12T14:30:00.000Z',
      updated_at: '2026-07-12T14:30:00.000Z',
    };
    const segment: ActivitySegment = {
      id: 'gps-segment',
      user_id: 'user-1',
      session_id: null,
      source: 'gps',
      external_id: 'gps:stable-run-id:1',
      sport: 'running',
      started_at: '2026-07-12T14:00:00.000Z',
      ended_at: '2026-07-12T14:30:00.000Z',
      duration_seconds: 1800,
      strain: null,
      avg_hr: null,
      max_hr: null,
      energy_kcal: null,
      distance_m: 5000,
      raw: null,
      created_at: '2026-07-12T14:30:00.000Z',
      updated_at: '2026-07-12T14:30:00.000Z',
    };

    const sessionChain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({ data: existingSession, error: null }),
    });
    const segmentChain = createChain();
    const createSession = vi.fn();
    const upsertSegments = vi.fn().mockResolvedValue([segment]);
    useAppStore.setState({
      createActivitySession: createSession,
      upsertActivitySegments: upsertSegments,
    });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'activity_sessions') return sessionChain;
      if (table === 'activity_segments') return segmentChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const saved = await useAppStore.getState().saveTrackedRun(run);

    expect(saved).toEqual(existingSession);
    expect(createSession).not.toHaveBeenCalled();
    expect(upsertSegments).toHaveBeenCalledOnce();
    expect(segmentChain.update).toHaveBeenCalledWith(expect.objectContaining({ session_id: existingSession.id }));
  });
});

describe('session-only exercise substitution', () => {
  beforeEach(() => {
    useAppStore.setState({ currentWorkoutDayPlan: { id: 'plan', workout_id: 'workout-1', day_label: 'Today', items: [
      { exercise_id: 'original', order: 0, target_sets: 6, target_reps_min: 3, target_reps_max: 5 },
    ] } });
  });
  const original: WorkoutSet = {
    id: 'original-set', workout_id: 'workout-1', exercise_id: 'original',
    set_number: 1, weight: 100, reps: 5, rpe: 9, completed: false, completed_at: null,
  };
  const replacement = { id: 'replacement', name: 'Cable fly', muscle_group: 'chest',
    muscle_group_secondary: null, equipment: 'cable', is_compound: false } as import('@/types').Exercise;

  it('creates independent defaults and preserves completed original sets without touching the program', async () => {
    const chain = createChain();
    supabaseMock.from.mockReturnValue(chain);
    const completed = { ...original, id: 'logged', completed: true };
    useAppStore.setState({ currentWorkout: { ...makeWorkoutWithSet(original), sets: [completed, original] } });
    await useAppStore.getState().substituteWorkoutExercise('original', replacement);
    const sets = useAppStore.getState().currentWorkout!.sets;
    expect(sets.filter((row) => row.exercise_id === 'original')).toEqual([completed]);
    expect(sets.filter((row) => row.exercise_id === 'replacement')).toHaveLength(3);
    expect(sets.find((row) => row.exercise_id === 'replacement')).toMatchObject({ weight: null, reps: null, rpe: null, set_number: 1, completed: false });
    expect(supabaseMock.from.mock.calls.every(([table]) => ['sets', 'workout_day_plans'].includes(table))).toBe(true);
    expect(chain.eq).toHaveBeenCalledWith('completed', false);
  });

  it('changes only the flexible session plan and clears inherited targets and notes', async () => {
    supabaseMock.from.mockReturnValue(createChain());
    useAppStore.setState({
      currentWorkout: { ...makeWorkoutWithSet(original), split_day_id: null },
      currentWorkoutDayPlan: { id: 'plan', workout_id: 'workout-1', day_label: 'Today', items: [
        { exercise_id: 'original', order: 0, target_sets: 6, target_reps_min: 3, target_reps_max: 5, notes: 'Original cue' },
      ] },
    });
    await useAppStore.getState().substituteWorkoutExercise('original', replacement);
    expect(useAppStore.getState().currentWorkoutDayPlan!.items[0]).toMatchObject({
      exercise_id: 'replacement', target_sets: 3, target_reps_min: 8, target_reps_max: 12, notes: null,
    });
    expect(supabaseMock.from.mock.calls.map(([table]) => table)).not.toContain('flex_day_templates');
  });

  it('leaves the original intact if insertion fails', async () => {
    const chain = createChain();
    chain.insert.mockResolvedValue({ error: { message: 'offline' } });
    supabaseMock.from.mockReturnValue(chain);
    useAppStore.setState({ currentWorkout: makeWorkoutWithSet(original) });
    await expect(useAppStore.getState().substituteWorkoutExercise('original', replacement)).rejects.toThrow('Could not add');
    expect(useAppStore.getState().currentWorkout!.sets).toEqual([original]);
    expect(chain.delete).not.toHaveBeenCalled();
  });

  it('rolls back replacement rows if removing pending original sets fails', async () => {
    const insert = createChain();
    const removal = createChain();
    removal.eq.mockReturnValue(removal);
    Object.assign(removal, { error: { message: 'offline' } });
    const cleanup = createChain();
    supabaseMock.from.mockReturnValueOnce(insert).mockReturnValueOnce(createChain()).mockReturnValueOnce(removal).mockReturnValueOnce(cleanup).mockReturnValueOnce(createChain());
    useAppStore.setState({ currentWorkout: makeWorkoutWithSet(original) });
    await expect(useAppStore.getState().substituteWorkoutExercise('original', replacement)).rejects.toThrow('Please try again');
    expect(cleanup.delete).toHaveBeenCalled();
    expect(useAppStore.getState().currentWorkout!.sets).toEqual([original]);
  });

  it('rejects duplicates and finished movements before writing', async () => {
    useAppStore.setState({ currentWorkout: makeWorkoutWithSet({ ...original, completed: true }) });
    await expect(useAppStore.getState().substituteWorkoutExercise('original', replacement)).rejects.toThrow('no remaining sets');
    useAppStore.setState({ currentWorkout: { ...makeWorkoutWithSet(original), sets: [original, { ...original, exercise_id: replacement.id }] } });
    await expect(useAppStore.getState().substituteWorkoutExercise('original', replacement)).rejects.toThrow('already in');
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});

// A table-aware Supabase stand-in for the WHOOP paths: every awaited query is
// recorded and answered by `respond`, so a test can fail one specific read and
// then assert that no destructive write followed it.
type RecordedQuery = {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  payload: unknown;
  filters: Array<[string, string, unknown]>;
  single: boolean;
};
type QueryResult = { data: unknown; error: { message: string } | null };

function installRecordingSupabase(respond: (query: RecordedQuery) => QueryResult | undefined) {
  const queries: RecordedQuery[] = [];
  supabaseMock.from.mockImplementation((table: string) => {
    const query: RecordedQuery = { table, action: 'select', payload: undefined, filters: [], single: false };
    const run = () => {
      queries.push(query);
      return Promise.resolve(respond(query) ?? { data: null, error: null });
    };
    const builder: Record<string, unknown> = {};
    const write = (action: RecordedQuery['action']) => (payload?: unknown) => {
      query.action = action;
      query.payload = payload;
      return builder;
    };
    builder.insert = write('insert');
    builder.update = write('update');
    builder.upsert = write('upsert');
    builder.delete = write('delete');
    builder.select = () => builder;
    for (const op of ['eq', 'neq', 'in', 'is', 'gte', 'lte', 'order', 'limit', 'abortSignal']) {
      builder[op] = (column: string, value?: unknown) => {
        query.filters.push([op, column, value]);
        return builder;
      };
    }
    builder.single = () => {
      query.single = true;
      return run();
    };
    builder.maybeSingle = builder.single;
    builder.then = (onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) =>
      run().then(onFulfilled, onRejected);
    return builder;
  });
  return {
    queries,
    writes: () => queries.filter((query) => query.action !== 'select'),
  };
}

function hasFilter(query: RecordedQuery, op: string, column: string): boolean {
  return query.filters.some(([filterOp, filterColumn]) => filterOp === op && filterColumn === column);
}

type WhoopRead = 'watermark' | 'segmentsWindow' | 'sessionsWindow' | 'sessionsByIds' | 'upsert';

function whoopReadKind(query: RecordedQuery): WhoopRead | null {
  if (query.table === 'activity_segments' && query.action === 'upsert') return 'upsert';
  if (query.action !== 'select') return null;
  if (query.table === 'activity_segments' && query.single) return 'watermark';
  if (query.table === 'activity_segments' && hasFilter(query, 'gte', 'started_at')) return 'segmentsWindow';
  if (query.table === 'activity_sessions' && hasFilter(query, 'gte', 'started_at')) return 'sessionsWindow';
  if (query.table === 'activity_sessions' && hasFilter(query, 'in', 'id')) return 'sessionsByIds';
  return null;
}

const HOUR_MS = 60 * 60 * 1000;

function makeActivitySession(overrides: Partial<ActivitySession> & { id: string }): ActivitySession {
  const startedAt = new Date(Date.now() - 3 * HOUR_MS).toISOString();
  return {
    user_id: 'user-1',
    activity_type: 'run',
    custom_type: null,
    title: null,
    date: startedAt.slice(0, 10),
    started_at: startedAt,
    ended_at: new Date(Date.parse(startedAt) + 30 * 60 * 1000).toISOString(),
    duration_seconds: 1800,
    source: 'whoop',
    notes: null,
    strain: 10,
    avg_hr: 150,
    max_hr: 180,
    energy_kcal: 400,
    distance_m: null,
    auto_grouped: true,
    user_edited: false,
    dismissed_at: null,
    created_at: startedAt,
    updated_at: startedAt,
    ...overrides,
  };
}

function makeWhoopSegment(overrides: Partial<ActivitySegment> & { id: string }): ActivitySegment {
  const startedAt = new Date(Date.now() - 3 * HOUR_MS).toISOString();
  return {
    user_id: 'user-1',
    session_id: null,
    source: 'whoop',
    external_id: `wf-${overrides.id}`,
    sport: 'running',
    started_at: startedAt,
    ended_at: new Date(Date.parse(startedAt) + 30 * 60 * 1000).toISOString(),
    duration_seconds: 1800,
    strain: 10,
    avg_hr: 150,
    max_hr: 180,
    energy_kcal: 400,
    distance_m: null,
    raw: null,
    created_at: startedAt,
    updated_at: startedAt,
    ...overrides,
  };
}

describe('WHOOP sync never treats a failed read as "no data"', () => {
  const readFailure = { data: null, error: { message: 'network request failed' } };

  function installWhoopDb(opts: {
    fail?: WhoopRead;
    segments?: ActivitySegment[];
    sessions?: ActivitySession[];
    byIds?: ActivitySession[];
  }) {
    const watermark = { started_at: new Date(Date.now() - 24 * HOUR_MS).toISOString() };
    return installRecordingSupabase((query) => {
      const kind = whoopReadKind(query);
      if (kind && kind === opts.fail) return readFailure;
      switch (kind) {
        case 'watermark': return { data: watermark, error: null };
        case 'segmentsWindow': return { data: opts.segments ?? [], error: null };
        case 'sessionsWindow': return { data: opts.sessions ?? [], error: null };
        case 'sessionsByIds': return { data: opts.byIds ?? [], error: null };
        case 'upsert': {
          const rows = query.payload as Array<Record<string, unknown>>;
          return { data: rows.map((row, i) => ({ id: `upserted-${i}`, session_id: null, ...row })), error: null };
        }
        default: break;
      }
      if (query.table === 'activity_sessions' && query.action === 'insert') {
        return { data: { ...(query.payload as object), id: 'created-session' }, error: null };
      }
      return undefined;
    });
  }

  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    whoopClientMock.fetchWhoopBatchRemote.mockReset();
    whoopClientMock.fetchWhoopBatchRemote.mockResolvedValue({ records: [], nextToken: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('imports a new WHOOP workout on a healthy sync', async () => {
    const db = installWhoopDb({ segments: [makeWhoopSegment({ id: 'seg-new' })] });

    const result = await useAppStore.getState().syncWhoop();

    expect(result).toMatchObject({ created: 1, deleted: 0 });
    const inserted = db.writes().filter((q) => q.table === 'activity_sessions' && q.action === 'insert');
    expect(inserted).toHaveLength(1);
    expect(inserted[0].payload).toMatchObject({ user_id: 'user-1', source: 'whoop', auto_grouped: true });
    const linked = db.writes().filter((q) => q.table === 'activity_segments' && q.action === 'update');
    expect(linked).toHaveLength(1);
    expect(linked[0].payload).toMatchObject({ session_id: 'created-session' });
  });

  it('aborts without deleting sessions when the segment window read fails', async () => {
    const db = installWhoopDb({
      fail: 'segmentsWindow',
      sessions: [makeActivitySession({ id: 'auto-whoop' })],
    });

    const result = await useAppStore.getState().syncWhoop();

    expect(result).toBeNull();
    expect(db.writes()).toEqual([]);
  });

  it('aborts without creating or relinking when the session window read fails', async () => {
    const db = installWhoopDb({
      fail: 'sessionsWindow',
      segments: [
        // enriched GPS host and a dismissed tombstone, hours apart
        makeWhoopSegment({ id: 'seg-gps', session_id: 'gps-host' }),
        makeWhoopSegment({
          id: 'seg-dismissed',
          session_id: 'dismissed-whoop',
          started_at: new Date(Date.now() - 8 * HOUR_MS).toISOString(),
          ended_at: new Date(Date.now() - 7.5 * HOUR_MS).toISOString(),
        }),
      ],
    });

    const result = await useAppStore.getState().syncWhoop();

    expect(result).toBeNull();
    expect(db.writes()).toEqual([]);
  });

  it('aborts without touching a straddling host when its by-id read fails', async () => {
    const db = installWhoopDb({
      fail: 'sessionsByIds',
      segments: [makeWhoopSegment({ id: 'seg-host', session_id: 'host-before-window' })],
    });

    const result = await useAppStore.getState().syncWhoop();

    expect(result).toBeNull();
    expect(db.writes()).toEqual([]);
  });

  it('aborts before reconciling when the segment upsert fails', async () => {
    whoopClientMock.fetchWhoopBatchRemote.mockResolvedValue({
      records: [{
        id: 'wf-new',
        sport_name: 'running',
        start: new Date(Date.now() - 2 * HOUR_MS).toISOString(),
        end: new Date(Date.now() - 1.5 * HOUR_MS).toISOString(),
        timezone_offset: '+00:00',
        score_state: 'SCORED',
        score: { strain: 9, average_heart_rate: 150, max_heart_rate: 175, kilojoule: 1500 },
      }],
      nextToken: null,
    });
    const db = installWhoopDb({
      fail: 'upsert',
      sessions: [makeActivitySession({ id: 'auto-whoop' })],
    });

    const result = await useAppStore.getState().syncWhoop();

    expect(result).toBeNull();
    expect(db.writes().filter((q) => q.action !== 'upsert')).toEqual([]);
  });

  it('shares one run between overlapping syncs, then starts fresh once it settles', async () => {
    installWhoopDb({ segments: [] });
    let releaseBatch!: (value: { records: never[]; nextToken: null }) => void;
    whoopClientMock.fetchWhoopBatchRemote.mockImplementationOnce(
      () => new Promise((resolve) => { releaseBatch = resolve; }),
    );

    // e.g. the foreground auto-sync is mid-flight when the user taps Sync
    const automatic = useAppStore.getState().syncWhoop();
    const manual = useAppStore.getState().syncWhoop();
    await vi.waitFor(() => expect(whoopClientMock.fetchWhoopBatchRemote).toHaveBeenCalled());
    releaseBatch({ records: [], nextToken: null });

    const [first, second] = await Promise.all([automatic, manual]);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(whoopClientMock.fetchWhoopBatchRemote).toHaveBeenCalledOnce();

    await useAppStore.getState().syncWhoop();
    expect(whoopClientMock.fetchWhoopBatchRemote).toHaveBeenCalledTimes(2);
  });

  it('aborts instead of widening the window when the watermark read fails', async () => {
    const db = installWhoopDb({ fail: 'watermark' });

    const result = await useAppStore.getState().syncWhoop();

    expect(result).toBeNull();
    expect(whoopClientMock.fetchWhoopBatchRemote).not.toHaveBeenCalled();
    expect(db.writes()).toEqual([]);
  });
});

describe('saveTrackedRun WHOOP absorb failures', () => {
  const run: FinishedRun = {
    runId: 'absorb-run',
    mode: 'free',
    startedAtMs: Date.parse('2026-07-12T14:00:00.000Z'),
    endedAtMs: Date.parse('2026-07-12T14:30:00.000Z'),
    totalDistanceM: 5000,
    elapsedS: 1800,
    laps: [],
    reps: [],
  };
  const gpsSession = makeActivitySession({
    id: 'new-gps-session',
    source: 'gps',
    auto_grouped: false,
    started_at: '2026-07-12T14:00:00.000Z',
    ended_at: '2026-07-12T14:30:00.000Z',
    strain: null,
    avg_hr: null,
    max_hr: null,
    energy_kcal: null,
  });
  const whoopCopy = makeActivitySession({
    id: 'whoop-copy',
    started_at: '2026-07-12T14:01:00.000Z',
    ended_at: '2026-07-12T14:29:00.000Z',
  });
  const gpsSegment = makeWhoopSegment({ id: 'gps-seg', source: 'gps', external_id: 'gps:absorb-run:1' });

  beforeEach(() => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    useAppStore.setState({
      createActivitySession: vi.fn().mockResolvedValue(gpsSession),
      upsertActivitySegments: vi.fn().mockResolvedValue([gpsSegment]),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const isAbsorbWindowRead = (q: RecordedQuery) =>
    q.table === 'activity_sessions' && q.action === 'select' && hasFilter(q, 'gte', 'started_at');
  const isAbsorbRelink = (q: RecordedQuery) =>
    q.table === 'activity_segments' && q.action === 'update' && hasFilter(q, 'eq', 'session_id');

  it('keeps the saved run and skips the absorb when the window read fails', async () => {
    const db = installRecordingSupabase((q) => {
      if (isAbsorbWindowRead(q)) return { data: null, error: { message: 'timeout' } };
      return undefined;
    });

    const saved = await useAppStore.getState().saveTrackedRun(run);

    expect(saved).toEqual(gpsSession);
    expect(db.writes().filter(isAbsorbRelink)).toEqual([]);
    expect(db.writes().filter((q) => q.table === 'activity_sessions')).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it('never deletes the WHOOP copy when moving its segments fails', async () => {
    const db = installRecordingSupabase((q) => {
      if (isAbsorbWindowRead(q)) return { data: [gpsSession, whoopCopy], error: null };
      if (isAbsorbRelink(q)) return { data: null, error: { message: 'timeout' } };
      return undefined;
    });

    const saved = await useAppStore.getState().saveTrackedRun(run);

    expect(saved).toEqual(gpsSession);
    expect(db.writes().filter(isAbsorbRelink)).toHaveLength(1);
    expect(db.writes().filter((q) => q.table === 'activity_sessions')).toEqual([]);
  });

  it('absorbs the WHOOP copy when every step succeeds', async () => {
    const db = installRecordingSupabase((q) => {
      if (isAbsorbWindowRead(q)) return { data: [gpsSession, whoopCopy], error: null };
      if (q.table === 'activity_sessions' && q.action === 'update') {
        return { data: { ...gpsSession, ...(q.payload as object) }, error: null };
      }
      return undefined;
    });

    const saved = await useAppStore.getState().saveTrackedRun(run);

    expect(saved).toMatchObject({ id: gpsSession.id, strain: whoopCopy.strain });
    const deletes = db.writes().filter((q) => q.table === 'activity_sessions' && q.action === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toContainEqual(['eq', 'id', whoopCopy.id]);
  });
});
