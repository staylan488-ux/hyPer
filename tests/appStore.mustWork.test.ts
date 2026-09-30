import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivitySegment, ActivitySession, Exercise, FlexiblePlanItem, VolumeLandmark, Workout, WorkoutDayPlan, WorkoutSet } from '@/types';
import type { FinishedRun } from '@/lib/runTracker';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
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
import { SET_SAVE_TIMEOUT_MS } from '@/lib/saveWorkoutSet';

const realFetchSplits = useAppStore.getState().fetchSplits;

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
  supabaseMock.auth.getSession.mockReset();

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
    ...defaultActivityActions,
  });
});

describe('must-work store contracts', () => {
  it('resumes the latest in-progress workout instead of creating duplicate after midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-15T01:00:00.000Z'));

    try {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
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
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
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

  it('keeps the active workout when the stored session is gone (expired and not refreshable)', async () => {
    const activeWorkout = makeWorkoutWithSet({
      id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 1,
      weight: 185, reps: 8, rpe: 8, completed: true, completed_at: '2026-03-10T11:20:00.000Z',
    });
    useAppStore.setState({ currentWorkout: activeWorkout });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await useAppStore.getState().fetchCurrentWorkout();

    expect(useAppStore.getState().currentWorkout).toEqual(activeWorkout);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('reads the user id from the stored session without an auth server lookup', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });
    const workoutsChain = createChain();
    const splitsChain = createChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      if (table === 'splits') return splitsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().fetchCurrentWorkout();
    await realFetchSplits();

    expect(workoutsChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(splitsChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it('does not resume a stale incomplete workout that is older than 24 hours', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
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

  describe('starting a workout', () => {
    const insertedWorkout = {
      id: 'workout-new',
      user_id: 'user-1',
      split_day_id: 'split-day-1',
      date: '2026-02-14',
      notes: null,
      completed: false,
      created_at: '2026-02-14T12:00:00.000Z',
    };

    // workouts: 1st call = resume check, 2nd = insert, later = delete/refetch.
    function routeStart({ setsError = null, workoutInsertError = null, existing = null }: {
      setsError?: unknown;
      workoutInsertError?: unknown;
      existing?: Workout | null;
    } = {}) {
      supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
      const existingChain = createChain({
        maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
      });
      const insertWorkoutChain = createChain({
        single: vi.fn().mockResolvedValue(workoutInsertError
          ? { data: null, error: workoutInsertError }
          : { data: insertedWorkout, error: null }),
      });
      const laterWorkoutsChain = createChain({
        maybeSingle: vi.fn().mockResolvedValue({ data: { ...insertedWorkout, sets: [] }, error: null }),
      });
      const splitExercisesChain = createChain({
        order: vi.fn().mockResolvedValue({
          data: [
            { exercise_id: 'exercise-squat', target_sets: 3, exercise_order: 0 },
            { exercise_id: 'exercise-press', target_sets: 2, exercise_order: 1 },
          ],
          error: null,
        }),
      });
      const setsChain = createChain();
      setsChain.insert.mockImplementation(() => ({ error: setsError }));
      const plansChain = createChain({
        single: vi.fn().mockResolvedValue({
          data: { id: 'plan-new', workout_id: 'workout-new', day_label: 'Pull', items: [] },
          error: null,
        }),
      });

      let workoutCalls = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'workouts') {
          workoutCalls += 1;
          if (workoutCalls === 1) return existingChain;
          if (workoutCalls === 2) return insertWorkoutChain;
          return laterWorkoutsChain;
        }
        if (table === 'split_exercises') return splitExercisesChain;
        if (table === 'sets') return setsChain;
        if (table === 'workout_day_plans') return plansChain;
        throw new Error(`Unexpected table: ${table}`);
      });
      return { setsChain, laterWorkoutsChain };
    }

    it('creates every planned set in one insert, in plan order', async () => {
      const { setsChain } = routeStart();

      const result = await useAppStore.getState().startWorkout('split-day-1');

      expect(result?.id).toBe('workout-new');
      expect(setsChain.insert).toHaveBeenCalledTimes(1);
      expect(setsChain.insert).toHaveBeenCalledWith([
        ['exercise-squat', 1], ['exercise-squat', 2], ['exercise-squat', 3],
        ['exercise-press', 1], ['exercise-press', 2],
      ].map(([exerciseId, setNumber]) => ({
        workout_id: 'workout-new',
        exercise_id: exerciseId,
        set_number: setNumber,
        completed: false,
      })));
      expect(useAppStore.getState().currentWorkout?.id).toBe('workout-new');
    });

    it('removes the new workout and rejects when the set insert fails', async () => {
      const { laterWorkoutsChain } = routeStart({ setsError: { message: 'offline' } });

      await expect(useAppStore.getState().startWorkout('split-day-1')).rejects.toThrow("Couldn't start the workout");

      expect(laterWorkoutsChain.delete).toHaveBeenCalledTimes(1);
      expect(laterWorkoutsChain.eq).toHaveBeenCalledWith('id', 'workout-new');
      expect(laterWorkoutsChain.maybeSingle).not.toHaveBeenCalled();
      expect(useAppStore.getState().currentWorkout).toBeNull();
    });

    it('does not resume a set-less workout left by a start that timed out after saving', async () => {
      // First Start: the workout row commits on the server, but the reply is
      // aborted at the request deadline, so no sets are added.
      routeStart({ workoutInsertError: { message: 'AbortError: The operation was aborted.' } });
      await expect(useAppStore.getState().startWorkout('split-day-1')).rejects.toThrow("Couldn't start the workout");

      // Second Start finds that row: in progress, recent, and without sets.
      const orphan: Workout = {
        ...insertedWorkout,
        id: 'workout-orphan',
        created_at: new Date().toISOString(),
        sets: [],
      };
      const existingChain = createChain({
        maybeSingle: vi.fn().mockResolvedValue({ data: orphan, error: null }),
      });
      const discardChain = createChain();
      const insertWorkoutChain = createChain({
        single: vi.fn().mockResolvedValue({ data: insertedWorkout, error: null }),
      });
      const placeholderSet: WorkoutSet = {
        id: 'set-1', workout_id: 'workout-new', exercise_id: 'exercise-squat', set_number: 1,
        weight: null, reps: null, rpe: null, completed: false, completed_at: null,
      };
      const refetchChain = createChain({
        maybeSingle: vi.fn().mockResolvedValue({ data: { ...insertedWorkout, sets: [placeholderSet] }, error: null }),
      });
      const splitExercisesChain = createChain({
        order: vi.fn().mockResolvedValue({
          data: [{ exercise_id: 'exercise-squat', target_sets: 1, exercise_order: 0 }],
          error: null,
        }),
      });
      const setsChain = createChain();
      setsChain.insert.mockImplementation(() => ({ error: null }));
      const workoutChains = [existingChain, discardChain, insertWorkoutChain, refetchChain];
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'workouts') return workoutChains.shift();
        if (table === 'split_exercises') return splitExercisesChain;
        if (table === 'sets') return setsChain;
        throw new Error(`Unexpected table: ${table}`);
      });

      const result = await useAppStore.getState().startWorkout('split-day-1');

      expect(discardChain.delete).toHaveBeenCalledTimes(1);
      expect(discardChain.eq).toHaveBeenCalledWith('id', 'workout-orphan');
      expect(insertWorkoutChain.insert).toHaveBeenCalledTimes(1);
      expect(setsChain.insert).toHaveBeenCalledTimes(1);
      expect(result?.id).toBe('workout-new');
      expect(result?.sets).toHaveLength(1);
      expect(useAppStore.getState().currentWorkout?.id).toBe('workout-new');
    });

    it('still resumes an in-progress split workout that has sets', async () => {
      const inProgress: Workout = {
        ...insertedWorkout,
        id: 'workout-split',
        created_at: new Date().toISOString(),
        sets: [{
          id: 'set-1', workout_id: 'workout-split', exercise_id: 'exercise-squat', set_number: 1,
          weight: 100, reps: 5, rpe: null, completed: true, completed_at: new Date().toISOString(),
        }],
      };
      const { setsChain, laterWorkoutsChain } = routeStart({ existing: inProgress });

      await expect(useAppStore.getState().startWorkout('split-day-1')).resolves.toEqual(inProgress);
      expect(laterWorkoutsChain.delete).not.toHaveBeenCalled();
      expect(setsChain.insert).not.toHaveBeenCalled();
      expect(useAppStore.getState().currentWorkout?.id).toBe('workout-split');
    });

    it('rejects instead of returning null when a flexible workout cannot be created', async () => {
      routeStart({ workoutInsertError: { message: 'offline' } });

      await expect(useAppStore.getState().startFlexibleWorkout('Pull')).rejects.toThrow("Couldn't start the workout");
      expect(useAppStore.getState().currentWorkout).toBeNull();
    });

    it('still returns null when a split workout is already in progress', async () => {
      const splitInProgress: Workout = {
        ...insertedWorkout,
        id: 'workout-split',
        created_at: new Date().toISOString(),
        sets: [],
      };
      const { setsChain } = routeStart({ existing: splitInProgress });

      await expect(useAppStore.getState().startFlexibleWorkout('Pull')).resolves.toBeNull();
      expect(setsChain.insert).not.toHaveBeenCalled();
      expect(useAppStore.getState().currentWorkout).toBeNull();
    });

    it('creates a template flexible workout with one insert that skips hidden items', async () => {
      const { setsChain } = routeStart();
      const templateItems: FlexiblePlanItem[] = [
        { exercise_id: 'exercise-row', exercise_name: 'Row', order: 0, target_sets: 2, target_reps_min: 8, target_reps_max: 12, notes: null, hidden: false, superset_group_id: null },
        { exercise_id: 'exercise-curl', exercise_name: 'Curl', order: 1, target_sets: 3, target_reps_min: 8, target_reps_max: 12, notes: null, hidden: true, superset_group_id: null },
        { exercise_id: 'exercise-pulldown', exercise_name: 'Pulldown', order: 2, target_sets: 1, target_reps_min: 8, target_reps_max: 12, notes: null, hidden: false, superset_group_id: null },
      ];
      const baseFrom = supabaseMock.from.getMockImplementation()!;
      supabaseMock.from.mockImplementation((table: string) => (
        table === 'flex_day_templates'
          ? createChain({ maybeSingle: vi.fn().mockResolvedValue({ data: { items: templateItems }, error: null }) })
          : baseFrom(table)
      ));

      await useAppStore.getState().startFlexibleWorkout('Pull', 'Pull');

      expect(setsChain.insert).toHaveBeenCalledTimes(1);
      expect(setsChain.insert).toHaveBeenCalledWith([
        ['exercise-row', 1], ['exercise-row', 2], ['exercise-pulldown', 1],
      ].map(([exerciseId, setNumber]) => ({
        workout_id: 'workout-new',
        exercise_id: exerciseId,
        set_number: setNumber,
        completed: false,
      })));
    });
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
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
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
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
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

  it('saves a flexible template with the notes on screen over stale saved notes', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    });

    useAppStore.setState({
      currentWorkout: {
        id: 'workout-1',
        user_id: 'user-1',
        split_day_id: null,
        date: '2026-02-19',
        notes: JSON.stringify({ movementNotes: { 'exercise-1': 'Old text' } }),
        completed: false,
        sets: [],
      },
      currentWorkoutDayPlan: {
        id: 'plan-1',
        workout_id: 'workout-1',
        day_label: 'Upper',
        items: [
          { exercise_id: 'exercise-1', exercise_name: 'Bench', order: 0, target_sets: 3, notes: 'Old text', hidden: false },
          { exercise_id: 'exercise-2', exercise_name: 'Row', order: 1, target_sets: 3, notes: 'Template cue', hidden: false },
          { exercise_id: 'exercise-3', exercise_name: 'Curl', order: 2, target_sets: 3, notes: 'Keep me', hidden: false },
        ],
      },
    });

    const templateUpsertChain = createChain();
    const templateFetchChain = createChain({
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'flex_day_templates') {
        return templateUpsertChain.upsert.mock.calls.length > 0 ? templateFetchChain : templateUpsertChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().saveFlexibleTemplateFromCurrentWorkout({
      'exercise-1': '  Typed just now ',
      'exercise-2': '',
    });

    const items = (templateUpsertChain.upsert.mock.calls[0][0] as { items: FlexiblePlanItem[] }).items;
    expect(items.map((item) => [item.exercise_id, item.notes])).toEqual([
      ['exercise-1', 'Typed just now'],
      ['exercise-2', null],
      ['exercise-3', 'Keep me'],
    ]);
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

    const exercise: Exercise = {
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

  describe('fetchActivitySegmentsBySessionIds tells failure from empty', () => {
    it('returns null when nobody is signed in', async () => {
      supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null } });
      await expect(useAppStore.getState().fetchActivitySegmentsBySessionIds(['s-1'])).resolves.toBeNull();
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it('returns null when the query fails', async () => {
      supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
      const chain = createChain({
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }),
      });
      supabaseMock.from.mockImplementation(() => chain);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(useAppStore.getState().fetchActivitySegmentsBySessionIds(['s-1'])).resolves.toBeNull();
      errorSpy.mockRestore();
    });

    it('returns [] when the query succeeds with no rows', async () => {
      supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
      const chain = createChain({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      });
      supabaseMock.from.mockImplementation(() => chain);

      await expect(useAppStore.getState().fetchActivitySegmentsBySessionIds(['s-1'])).resolves.toEqual([]);
      expect(chain.in).toHaveBeenCalledWith('session_id', ['s-1']);
    });

    it('returns [] without a request for no ids', async () => {
      await expect(useAppStore.getState().fetchActivitySegmentsBySessionIds([])).resolves.toEqual([]);
      expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    });
  });

  describe('past-workout edits reject on a failed save', () => {
    const failure = { message: 'network down', code: 'fetch_failed' };

    function workoutWithTwoSets(): Workout {
      return {
        id: 'workout-1',
        user_id: 'user-1',
        split_day_id: 'split-day-1',
        date: '2026-02-14',
        notes: 'Old note',
        completed: false,
        sets: [
          { id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 1, weight: 100, reps: 5, rpe: null, completed: true, completed_at: null },
          { id: 'set-2', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 2, weight: 100, reps: 5, rpe: null, completed: true, completed_at: null },
        ],
      };
    }

    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('updateSet rejects and leaves currentWorkout unchanged', async () => {
      const before = workoutWithTwoSets();
      useAppStore.setState({ currentWorkout: before });
      const setsChain = createChain({ error: failure as unknown as null });
      supabaseMock.from.mockImplementation(() => setsChain);

      await expect(useAppStore.getState().updateSet('set-1', { weight: 120 })).rejects.toThrow('Could not save that change.');
      expect(useAppStore.getState().currentWorkout).toEqual(before);
    });

    it('removeSetFromWorkout rejects when the delete fails', async () => {
      const before = workoutWithTwoSets();
      useAppStore.setState({ currentWorkout: before });
      const deleteChain = createChain({ error: failure as unknown as null });
      supabaseMock.from.mockImplementation(() => deleteChain);

      await expect(useAppStore.getState().removeSetFromWorkout('workout-1', 'exercise-1', 'set-2')).rejects.toThrow();
      expect(useAppStore.getState().currentWorkout).toEqual(before);
    });

    it('removeSetFromWorkout rejects when the compaction read fails', async () => {
      const before = workoutWithTwoSets();
      useAppStore.setState({ currentWorkout: before });
      const deleteChain = createChain();
      const remainingChain = createChain({
        order: vi.fn().mockResolvedValue({ data: null, error: failure }),
      });
      let setsCalls = 0;
      supabaseMock.from.mockImplementation(() => {
        setsCalls += 1;
        return setsCalls === 1 ? deleteChain : remainingChain;
      });

      await expect(useAppStore.getState().removeSetFromWorkout('workout-1', 'exercise-1', 'set-2')).rejects.toThrow();
      expect(useAppStore.getState().currentWorkout).toEqual(before);
    });

    it('removeExerciseFromWorkout rejects and does not touch the plan', async () => {
      const before = workoutWithTwoSets();
      const fetchPlan = vi.fn();
      useAppStore.setState({ currentWorkout: before, fetchWorkoutDayPlanByWorkoutId: fetchPlan });
      const setsChain = createChain({ error: failure as unknown as null });
      supabaseMock.from.mockImplementation(() => setsChain);

      await expect(useAppStore.getState().removeExerciseFromWorkout('workout-1', 'exercise-1')).rejects.toThrow();
      expect(fetchPlan).not.toHaveBeenCalled();
      expect(useAppStore.getState().currentWorkout).toEqual(before);
    });

    it('updateWorkoutNotes rejects and leaves the notes unchanged', async () => {
      const before = workoutWithTwoSets();
      useAppStore.setState({ currentWorkout: before });
      const workoutsChain = createChain({ error: failure as unknown as null });
      supabaseMock.from.mockImplementation(() => workoutsChain);

      await expect(useAppStore.getState().updateWorkoutNotes('workout-1', 'New note')).rejects.toThrow();
      expect(useAppStore.getState().currentWorkout?.notes).toBe('Old note');
    });
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

    const workoutsChain = createChain({
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          completed: false,
          completed_at: null,
          sets: [
            { id: 'set-1', completed: true, completed_at: '2026-03-10T12:20:00.000Z' },
            { id: 'set-2', completed: true, completed_at: '2026-03-10T12:35:00.000Z' },
          ],
        },
        error: null,
      }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().syncWorkoutCompletion('workout-1');

    expect(result).toEqual({
      totalSets: 2,
      completedSets: 2,
      completed: true,
    });
    expect(workoutsChain.select).toHaveBeenCalledWith('completed, completed_at, sets(id, completed, completed_at)');
    expect(workoutsChain.update).toHaveBeenCalledWith({
      completed: true,
      completed_at: '2026-03-10T12:35:00.000Z',
    });
    expect(workoutsChain.eq).toHaveBeenCalledWith('id', 'workout-1');
    expect(useAppStore.getState().currentWorkout?.completed).toBe(true);
    expect(useAppStore.getState().currentWorkout?.completed_at).toBe('2026-03-10T12:35:00.000Z');
  });

  describe('syncWorkoutCompletion only moves a workout toward complete', () => {
    function mockWorkoutRow(row: { completed: boolean; completed_at: string | null; sets: Array<{ id: string; completed: boolean; completed_at: string | null }> }) {
      const workoutsChain = createChain({
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      });
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'workouts') return workoutsChain;
        throw new Error(`Unexpected table: ${table}`);
      });
      return workoutsChain;
    }

    it('keeps a workout finished with a skipped set completed and does not write', async () => {
      const workoutsChain = mockWorkoutRow({
        completed: true,
        completed_at: '2026-03-10T12:40:00.000Z',
        sets: [
          { id: 'set-1', completed: true, completed_at: '2026-03-10T12:20:00.000Z' },
          { id: 'set-2', completed: false, completed_at: null },
        ],
      });

      const result = await useAppStore.getState().syncWorkoutCompletion('workout-1');

      expect(result).toEqual({ totalSets: 2, completedSets: 1, completed: true });
      expect(workoutsChain.update).not.toHaveBeenCalled();
    });

    it('keeps the original completed_at when a set is added to a finished workout', async () => {
      useAppStore.setState({
        currentWorkout: {
          id: 'workout-1',
          user_id: 'user-1',
          split_day_id: null,
          date: '2026-03-10',
          notes: null,
          completed: true,
          completed_at: '2026-03-10T12:40:00.000Z',
          sets: [],
        },
      });
      const workoutsChain = mockWorkoutRow({
        completed: true,
        completed_at: '2026-03-10T12:40:00.000Z',
        sets: [
          { id: 'set-1', completed: true, completed_at: '2026-03-10T12:20:00.000Z' },
          { id: 'set-new', completed: false, completed_at: null },
        ],
      });

      const result = await useAppStore.getState().syncWorkoutCompletion('workout-1');

      expect(result.completed).toBe(true);
      expect(workoutsChain.update).not.toHaveBeenCalled();
      expect(useAppStore.getState().currentWorkout?.completed).toBe(true);
      expect(useAppStore.getState().currentWorkout?.completed_at).toBe('2026-03-10T12:40:00.000Z');
    });

    it('fills a missing completed_at on a completed workout from the latest set time', async () => {
      const workoutsChain = mockWorkoutRow({
        completed: true,
        completed_at: null,
        sets: [
          { id: 'set-1', completed: true, completed_at: '2026-03-10T12:20:00.000Z' },
          { id: 'set-2', completed: true, completed_at: '2026-03-10T12:31:00.000Z' },
          { id: 'set-3', completed: false, completed_at: null },
        ],
      });

      await useAppStore.getState().syncWorkoutCompletion('workout-1');

      expect(workoutsChain.update).toHaveBeenCalledTimes(1);
      expect(workoutsChain.update).toHaveBeenCalledWith({
        completed: true,
        completed_at: '2026-03-10T12:31:00.000Z',
      });
    });

    it('leaves an incomplete workout with open sets incomplete without writing', async () => {
      const workoutsChain = mockWorkoutRow({
        completed: false,
        completed_at: null,
        sets: [
          { id: 'set-1', completed: true, completed_at: '2026-03-10T12:20:00.000Z' },
          { id: 'set-2', completed: false, completed_at: null },
        ],
      });

      const result = await useAppStore.getState().syncWorkoutCompletion('workout-1');

      expect(result).toEqual({ totalSets: 2, completedSets: 1, completed: false });
      expect(workoutsChain.update).not.toHaveBeenCalled();
    });

    it('writes nothing when the read fails', async () => {
      const workoutsChain = createChain({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'offline' } }),
      });
      supabaseMock.from.mockImplementation(() => workoutsChain);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await useAppStore.getState().syncWorkoutCompletion('workout-1');

      expect(result).toEqual({ totalSets: 0, completedSets: 0, completed: false });
      expect(workoutsChain.update).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  it('marks a workout complete with the latest completed set timestamp', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: null },
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

  it('keeps the session open and rejects when the finish save fails', async () => {
    const workout = makeWorkoutWithSet({
      id: 'set-1',
      workout_id: 'workout-1',
      exercise_id: 'exercise-1',
      set_number: 1,
      weight: 185,
      reps: 8,
      rpe: 8,
      completed: true,
      completed_at: '2026-03-10T11:20:00.000Z',
    });
    const plan: WorkoutDayPlan = { id: 'plan-1', workout_id: 'workout-1', day_label: 'Upper', items: [] };
    useAppStore.setState({ currentWorkout: workout, currentWorkoutDayPlan: plan });

    const workoutsChain = createChain({
      abortSignal: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' }, status: 0 }),
    });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(useAppStore.getState().completeWorkout()).rejects.toThrow("Couldn't finish the workout");

    // One retry with the same payload, then the session stays open.
    expect(workoutsChain.abortSignal).toHaveBeenCalledTimes(2);
    expect(workoutsChain.update).toHaveBeenNthCalledWith(2, { completed: true, completed_at: '2026-03-10T11:20:00.000Z' });
    expect(useAppStore.getState().currentWorkout?.id).toBe('workout-1');
    expect(useAppStore.getState().currentWorkoutDayPlan).toBe(plan);
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
  });

  it('turns a stalled finish into the retry message instead of waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const workout = makeWorkoutWithSet({
        id: 'set-1',
        workout_id: 'workout-1',
        exercise_id: 'exercise-1',
        set_number: 1,
        weight: 185,
        reps: 8,
        rpe: 8,
        completed: true,
        completed_at: '2026-03-10T11:20:00.000Z',
      });
      useAppStore.setState({ currentWorkout: workout });

      const signals: AbortSignal[] = [];
      const workoutsChain = createChain({
        abortSignal: vi.fn((signal: AbortSignal) => {
          signals.push(signal);
          return new Promise(() => {});
        }),
      });
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'workouts') return workoutsChain;
        throw new Error(`Unexpected table: ${table}`);
      });

      const finishing = expect(useAppStore.getState().completeWorkout()).rejects.toThrow("Couldn't finish the workout");
      await vi.advanceTimersByTimeAsync(2 * SET_SAVE_TIMEOUT_MS);
      await finishing;

      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(useAppStore.getState().currentWorkout?.id).toBe('workout-1');
      expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('finishes without waiting for the weekly volume recount', async () => {
    supabaseMock.auth.getSession.mockReturnValue(new Promise(() => {}));
    useAppStore.setState({
      currentWorkout: makeWorkoutWithSet({
        id: 'set-1',
        workout_id: 'workout-1',
        exercise_id: 'exercise-1',
        set_number: 1,
        weight: 185,
        reps: 8,
        rpe: 8,
        completed: true,
        completed_at: '2026-03-10T11:20:00.000Z',
      }),
    });

    const workoutsChain = createChain();
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(useAppStore.getState().completeWorkout()).resolves.toBeUndefined();

    expect(workoutsChain.update).toHaveBeenCalledWith({ completed: true, completed_at: '2026-03-10T11:20:00.000Z' });
    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(supabaseMock.auth.getSession).toHaveBeenCalled();
  });

  it('activates the target before deactivating the rest, then refreshes splits', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    const fetchSplitsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ fetchSplits: fetchSplitsSpy });

    const splitsChain = createChain();
    (splitsChain as unknown as { data: unknown }).data = [{ id: 'split-b' }];
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'splits') return splitsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().setActiveSplit('split-b');

    expect(result).toEqual({ ok: true });
    expect(splitsChain.update).toHaveBeenCalledTimes(2);
    expect(splitsChain.update).toHaveBeenNthCalledWith(1, { is_active: true });
    expect(splitsChain.select).toHaveBeenCalledWith('id');
    expect(splitsChain.update).toHaveBeenNthCalledWith(2, { is_active: false });
    expect(splitsChain.eq).toHaveBeenNthCalledWith(1, 'id', 'split-b');
    expect(splitsChain.eq).toHaveBeenNthCalledWith(2, 'user_id', 'user-1');
    expect(splitsChain.neq).toHaveBeenCalledWith('id', 'split-b');
    expect(fetchSplitsSpy).toHaveBeenCalledTimes(1);
  });

  it('never deactivates other splits when activating the target fails', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    const fetchSplitsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ fetchSplits: fetchSplitsSpy });

    const splitsChain = createChain();
    (splitsChain as unknown as { error: unknown }).error = { message: 'network down' };
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'splits') return splitsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().setActiveSplit('split-b');

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(splitsChain.update).toHaveBeenCalledTimes(1);
    expect(splitsChain.update).toHaveBeenCalledWith({ is_active: true });
    expect(splitsChain.neq).not.toHaveBeenCalled();
    expect(fetchSplitsSpy).not.toHaveBeenCalled();
  });

  it('never deactivates other splits when the target row no longer exists', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    const fetchSplitsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ fetchSplits: fetchSplitsSpy });

    // PostgREST reports no error when an update matches zero rows, e.g. when the
    // program was deleted on another device or is hidden by RLS.
    const splitsChain = createChain();
    (splitsChain as unknown as { data: unknown }).data = [];
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'splits') return splitsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().setActiveSplit('split-gone');

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(splitsChain.update).toHaveBeenCalledTimes(1);
    expect(splitsChain.update).toHaveBeenCalledWith({ is_active: true });
    expect(splitsChain.neq).not.toHaveBeenCalled();
    expect(fetchSplitsSpy).not.toHaveBeenCalled();
  });

  it('deletes a split and refreshes split list', async () => {
    const fetchSplitsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ fetchSplits: fetchSplitsSpy });

    const splitsChain = createChain();
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'splits') return splitsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().deleteSplit('split-z');

    expect(result).toEqual({ ok: true });
    expect(splitsChain.delete).toHaveBeenCalledTimes(1);
    expect(splitsChain.eq).toHaveBeenCalledWith('id', 'split-z');
    expect(fetchSplitsSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a failed split delete instead of acting as if it worked', async () => {
    const fetchSplitsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ fetchSplits: fetchSplitsSpy });

    const splitsChain = createChain();
    (splitsChain as unknown as { error: unknown }).error = { message: 'permission denied' };
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'splits') return splitsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await useAppStore.getState().deleteSplit('split-z');

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(fetchSplitsSpy).not.toHaveBeenCalled();
  });

  it('deletes a workout in one request and lets the database cascade its sets', async () => {
    const workoutsChain = createChain();

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().deleteWorkout('workout-42');

    expect(supabaseMock.from).not.toHaveBeenCalledWith('sets');
    expect(workoutsChain.delete).toHaveBeenCalledTimes(1);
    expect(workoutsChain.eq).toHaveBeenCalledWith('id', 'workout-42');
  });

  it('rejects when the workout delete fails and leaves the sets alone', async () => {
    const failure = { code: '42501', message: 'permission denied' };
    const workoutsChain = createChain();
    Object.assign(workoutsChain, { error: failure });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(useAppStore.getState().deleteWorkout('workout-42')).rejects.toBe(failure);

    expect(supabaseMock.from).not.toHaveBeenCalledWith('sets');
    consoleError.mockRestore();
  });

  it('falls back to deleting sets first when the database has no cascade', async () => {
    const workoutsChain = createChain();
    const setsChain = createChain();
    const results = [{ error: { code: '23503', message: 'foreign key violation' } }, { error: null }];
    workoutsChain.eq.mockImplementation(() => results.shift());

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'sets') return setsChain;
      if (table === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().deleteWorkout('workout-42');

    expect(setsChain.delete).toHaveBeenCalledTimes(1);
    expect(setsChain.eq).toHaveBeenCalledWith('workout_id', 'workout-42');
    expect(workoutsChain.delete).toHaveBeenCalledTimes(2);
  });

  it('clears the current workout when the deleted workout is the active one', async () => {
    supabaseMock.from.mockImplementation(() => createChain());
    const active = { ...makeWorkoutWithSet({} as WorkoutSet), id: 'workout-42' };
    useAppStore.setState({
      currentWorkout: active,
      currentWorkoutDayPlan: { workout_id: 'workout-42' } as never,
    });

    await useAppStore.getState().deleteWorkout('workout-42');

    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
  });

  it('leaves the current workout alone when deleting a different one', async () => {
    supabaseMock.from.mockImplementation(() => createChain());
    const active = makeWorkoutWithSet({} as WorkoutSet);
    const plan = { workout_id: active.id } as never;
    useAppStore.setState({ currentWorkout: active, currentWorkoutDayPlan: plan });

    await useAppStore.getState().deleteWorkout('workout-42');

    expect(useAppStore.getState().currentWorkout).toBe(active);
    expect(useAppStore.getState().currentWorkoutDayPlan).toBe(plan);
  });

  it('upserts macro targets by user_id and stores saved target', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
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
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
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

    const landmarksChain = createChain({
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      if (table === 'volume_landmarks') return landmarksChain;
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
    supabaseMock.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
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

    const landmarksChain = createChain({
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'workouts') return workoutsChain;
      if (table === 'volume_landmarks') return landmarksChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await useAppStore.getState().calculateWeeklyVolume();

    expect(useAppStore.getState().weeklyVolume).toEqual([]);
  });

  describe('weekly volume landmarks', () => {
    const chestLandmark: VolumeLandmark = {
      id: 'lm-chest',
      user_id: 'user-1',
      muscle_group: 'chest',
      mv: 4,
      mev: 6,
      mav_low: 10,
      mav_high: 16,
      mrv: 20,
    };
    const tricepsLandmark: VolumeLandmark = {
      id: 'lm-triceps',
      user_id: 'user-1',
      muscle_group: 'triceps',
      mv: 2,
      mev: 4,
      mav_low: 6,
      mav_high: 12,
      mrv: 16,
    };

    // 7 chest sets with triceps as the secondary: chest 7 (mev_mav), triceps 3.5 (below_mev).
    const workouts = [
      {
        id: 'workout-1',
        completed: true,
        sets: Array.from({ length: 7 }, () => ({
          completed: true,
          exercise: { muscle_group: 'chest', muscle_group_secondary: 'triceps' },
        })),
      },
    ];

    function mockTables(landmarksResult: () => Promise<unknown>) {
      const workoutsChain = createChain({
        lte: vi.fn().mockResolvedValue({ data: workouts, error: null }),
      });
      const landmarksChain = createChain({
        eq: vi.fn().mockImplementation(landmarksResult),
      });
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === 'workouts') return workoutsChain;
        if (table === 'volume_landmarks') return landmarksChain;
        throw new Error(`Unexpected table: ${table}`);
      });
      return { workoutsChain, landmarksChain };
    }

    beforeEach(() => {
      supabaseMock.auth.getSession.mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
      });
    });

    it('grades against landmarks that arrive after the workouts on a cold store', async () => {
      const { landmarksChain } = mockTables(
        () => new Promise((resolve) => {
          setTimeout(() => resolve({ data: [chestLandmark, tricepsLandmark], error: null }), 5);
        })
      );

      await useAppStore.getState().calculateWeeklyVolume();

      const state = useAppStore.getState();
      expect(supabaseMock.auth.getSession).toHaveBeenCalledTimes(1);
      expect(landmarksChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(state.volumeLandmarks).toEqual([chestLandmark, tricepsLandmark]);
      expect(state.weeklyVolume).toEqual([
        { muscle_group: 'chest', weekly_sets: 7, landmark: chestLandmark, status: 'mev_mav' },
        { muscle_group: 'triceps', weekly_sets: 3.5, landmark: tricepsLandmark, status: 'below_mev' },
      ]);
    });

    it('keeps the stored landmarks when the landmarks query fails', async () => {
      useAppStore.setState({ volumeLandmarks: [chestLandmark] });
      mockTables(() => Promise.resolve({ data: null, error: { message: 'offline' } }));

      await useAppStore.getState().calculateWeeklyVolume();

      const state = useAppStore.getState();
      expect(state.volumeLandmarks).toEqual([chestLandmark]);
      expect(state.weeklyVolume).toEqual([
        { muscle_group: 'chest', weekly_sets: 7, landmark: chestLandmark, status: 'mev_mav' },
        { muscle_group: 'triceps', weekly_sets: 3.5, landmark: undefined, status: 'below_mev' },
      ]);
    });

    it('keeps the stored landmarks when the landmarks request rejects', async () => {
      useAppStore.setState({ volumeLandmarks: [chestLandmark] });
      mockTables(() => Promise.reject(new Error('network down')));

      await useAppStore.getState().calculateWeeklyVolume();

      const state = useAppStore.getState();
      expect(state.volumeLandmarks).toEqual([chestLandmark]);
      expect(state.weeklyVolume[0]).toEqual(
        { muscle_group: 'chest', weekly_sets: 7, landmark: chestLandmark, status: 'mev_mav' }
      );
    });

    it('leaves the current weekly volume in place when the workouts query fails', async () => {
      const previous = [{ muscle_group: 'chest' as const, weekly_sets: 4, status: 'below_mev' as const }];
      useAppStore.setState({ volumeLandmarks: [chestLandmark], weeklyVolume: previous });
      const { workoutsChain } = mockTables(() => Promise.resolve({ data: [tricepsLandmark], error: null }));
      workoutsChain.lte.mockResolvedValue({ data: null, error: { message: 'offline' } });

      await useAppStore.getState().calculateWeeklyVolume();

      const state = useAppStore.getState();
      expect(state.weeklyVolume).toBe(previous);
      expect(state.volumeLandmarks).toEqual([chestLandmark]);
    });

    describe('Monday-to-Sunday training week', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('on a Sunday, queries the Monday-to-Sunday week that ends that day', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 27, 12)); // Sunday, local time
        const { workoutsChain } = mockTables(() => Promise.resolve({ data: [chestLandmark], error: null }));

        await useAppStore.getState().calculateWeeklyVolume();

        expect(workoutsChain.gte).toHaveBeenCalledWith('date', '2026-09-21');
        expect(workoutsChain.lte).toHaveBeenCalledWith('date', '2026-09-27');
        expect(useAppStore.getState().weeklyVolume[0]).toEqual(
          { muscle_group: 'chest', weekly_sets: 7, landmark: chestLandmark, status: 'mev_mav' }
        );
      });

      it('on a Monday, starts a new week that runs through the next Sunday', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 8, 28, 9)); // Monday, local time
        const { workoutsChain } = mockTables(() => Promise.resolve({ data: [chestLandmark], error: null }));

        await useAppStore.getState().calculateWeeklyVolume();

        expect(workoutsChain.gte).toHaveBeenCalledWith('date', '2026-09-28');
        expect(workoutsChain.lte).toHaveBeenCalledWith('date', '2026-10-04');
      });
    });
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
    expect(setsInsertChain.insert).toHaveBeenCalledTimes(1);
    expect(setsInsertChain.insert).toHaveBeenCalledWith([1, 2, 3].map((setNumber) => ({
      workout_id: 'workout-1',
      exercise_id: 'exercise-b',
      set_number: setNumber,
      completed: false,
    })));

    const updatedPlan = useAppStore.getState().currentWorkoutDayPlan;
    const groupIds = new Set((updatedPlan?.items || []).map((item) => item.superset_group_id).filter(Boolean));
    expect(groupIds.size).toBe(1);
  });

  it('reuses an existing GPS session when a tracked-run save is retried', async () => {
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });

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
      custom_type: null,
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

// Set-count edits and exercise removal, live and in History. These pin the end
// state (which rows survive, what the plan says), not how many calls it takes,
// so batching the writes later (F28) keeps them green.
describe('set-count edits never delete finished sets and superset partners follow', () => {
  const planActions = {
    ensureWorkoutDayPlan: useAppStore.getState().ensureWorkoutDayPlan,
    updateWorkoutDayPlanItems: useAppStore.getState().updateWorkoutDayPlanItems,
    fetchWorkoutDayPlanByWorkoutId: useAppStore.getState().fetchWorkoutDayPlanByWorkoutId,
  };
  afterEach(() => useAppStore.setState(planActions));

  const set = (id: string, exerciseId: string, setNumber: number, completed: boolean): WorkoutSet => ({
    id, workout_id: 'workout-1', exercise_id: exerciseId, set_number: setNumber,
    weight: completed ? 100 : null, reps: completed ? 8 : null, rpe: null,
    completed, completed_at: completed ? '2026-02-21T12:00:00.000Z' : null,
  });
  const item = (exerciseId: string, order: number, overrides: Partial<FlexiblePlanItem> = {}): FlexiblePlanItem => ({
    exercise_id: exerciseId, exercise_name: exerciseId, order, target_sets: 4,
    target_reps_min: 8, target_reps_max: 12, notes: null, hidden: false, superset_group_id: null, ...overrides,
  });
  const flexWorkout = (sets: WorkoutSet[]): Workout => ({
    id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-02-21', notes: null, completed: false, sets,
  });

  // An in-memory `sets` table: inserts add rows (insert().select() with the
  // exercise embed returns them), delete().eq/in('id') removes them (honoring
  // other eq filters set first; a following select('id') returns them), and
  // select(...).eq(...).order() reads them back filtered.
  function createSetsTable(initial: WorkoutSet[]) {
    const rows = initial.map((row) => ({ ...row }));
    const deletedIds: string[] = [];
    let inserted = 0;
    let lastInserted: WorkoutSet[] = [];
    let deleting = false;
    let deleteFilters: Record<string, unknown> = {};
    let justDeleted: string[] | null = null;
    let filters: Record<string, unknown> = {};
    const remove = (ids: string[]) => {
      justDeleted = [];
      for (const id of ids) {
        const index = rows.findIndex((row) => row.id === id);
        if (index < 0) continue;
        const matches = Object.entries(deleteFilters)
          .every(([key, value]) => rows[index][key as keyof WorkoutSet] === value);
        if (!matches) continue;
        rows.splice(index, 1);
        deletedIds.push(id);
        justDeleted.push(id);
      }
      deleting = false;
      deleteFilters = {};
    };
    const chain = createChain();
    chain.insert.mockImplementation((payload: Partial<WorkoutSet> | Partial<WorkoutSet>[]) => {
      lastInserted = [];
      for (const row of [payload].flat()) {
        const created = { weight: null, reps: null, rpe: null, completed_at: null, ...row, id: `inserted-${++inserted}` } as WorkoutSet;
        rows.push(created);
        lastInserted.push({ ...created });
      }
      return chain;
    });
    chain.delete.mockImplementation(() => { deleting = true; justDeleted = null; return chain; });
    chain.select.mockImplementation((columns?: string) => {
      if (columns?.includes('exercise:')) return Promise.resolve({ data: lastInserted, error: null });
      const deleted = justDeleted;
      justDeleted = null;
      if (deleted && columns === 'id') return Promise.resolve({ data: deleted.map((id) => ({ id })), error: null });
      filters = {};
      return chain;
    });
    chain.eq.mockImplementation((column: string, value: unknown) => {
      if (deleting && column === 'id') remove([value as string]);
      else if (deleting) deleteFilters[column] = value;
      else filters[column] = value;
      return chain;
    });
    chain.in.mockImplementation((column: string, values: string[]) => {
      if (deleting && column === 'id') remove(values);
      return chain;
    });
    chain.order.mockImplementation(async () => ({
      data: rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key as keyof WorkoutSet] === value)),
      error: null,
    }));
    const numbersFor = (exerciseId: string) => rows
      .filter((row) => row.exercise_id === exerciseId)
      .map((row) => row.set_number)
      .sort((a, b) => a - b);
    return { chain, rows, deletedIds, numbersFor };
  }

  // The live plan row echoes back whatever items were written; the workout
  // refetch returns the current `sets` table.
  function routeLiveWorkout(table: ReturnType<typeof createSetsTable>) {
    const plansChain = createChain();
    let written: FlexiblePlanItem[] = [];
    plansChain.update.mockImplementation((payload: { items: FlexiblePlanItem[] }) => { written = payload.items; return plansChain; });
    plansChain.single.mockImplementation(async () => ({
      data: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: written }, error: null,
    }));
    const workoutsChain = createChain({
      maybeSingle: vi.fn(async () => ({ data: flexWorkout(table.rows.map((row) => ({ ...row }))), error: null })),
    });
    supabaseMock.from.mockImplementation((name: string) => {
      if (name === 'workout_day_plans') return plansChain;
      if (name === 'sets') return table.chain;
      if (name === 'workouts') return workoutsChain;
      throw new Error(`Unexpected table: ${name}`);
    });
  }

  const planItem = (exerciseId: string) => useAppStore.getState().currentWorkoutDayPlan?.items
    .find((row) => row.exercise_id === exerciseId);

  it('live: lowering target sets deletes only unfinished sets above the target', async () => {
    const sets = [set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, false), set('a3', 'ex-a', 3, true), set('a4', 'ex-a', 4, false)];
    const table = createSetsTable(sets);
    routeLiveWorkout(table);
    useAppStore.setState({
      currentWorkout: flexWorkout(sets),
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [item('ex-a', 0)] },
    });

    await useAppStore.getState().updateFlexibleExerciseMeta('ex-a', { target_sets: 2 });

    expect(table.deletedIds).toEqual(['a4']);
    expect(table.rows.map((row) => row.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(planItem('ex-a')?.target_sets).toBe(2);
    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('live: a set logged while target sets are lowered is not deleted', async () => {
    const sets = [set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, false), set('a3', 'ex-a', 3, false), set('a4', 'ex-a', 4, false)];
    const table = createSetsTable(sets);
    routeLiveWorkout(table);
    useAppStore.setState({
      currentWorkout: flexWorkout(sets),
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [item('ex-a', 0)] },
    });
    // The user logs a3 (saved on the server and on screen) while the plan
    // update is in flight, after the store took its snapshot of the sets.
    const route = supabaseMock.from.getMockImplementation()!;
    supabaseMock.from.mockImplementation((name: string) => {
      if (name === 'workout_day_plans') {
        Object.assign(table.rows.find((row) => row.id === 'a3')!, { completed: true, reps: 8, weight: 100 });
        const current = useAppStore.getState().currentWorkout!;
        useAppStore.setState({
          currentWorkout: { ...current, sets: current.sets.map((row) => (row.id === 'a3' ? { ...row, completed: true } : row)) },
        });
      }
      return route(name);
    });

    await useAppStore.getState().updateFlexibleExerciseMeta('ex-a', { target_sets: 2 });

    expect(table.deletedIds).toEqual(['a4']);
    expect(table.rows.map((row) => row.id).sort()).toEqual(['a1', 'a2', 'a3']);
    const liveSets = useAppStore.getState().currentWorkout!.sets;
    expect(liveSets.map((row) => row.id).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(liveSets.find((row) => row.id === 'a3')?.completed).toBe(true);
  });

  it('live: raising target sets adds the missing sets after the existing ones', async () => {
    const sets = [set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, false)];
    const table = createSetsTable(sets);
    routeLiveWorkout(table);
    useAppStore.setState({
      currentWorkout: flexWorkout(sets),
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [item('ex-a', 0, { target_sets: 2 })] },
    });

    await useAppStore.getState().updateFlexibleExerciseMeta('ex-a', { target_sets: 4 });

    expect(table.numbersFor('ex-a')).toEqual([1, 2, 3, 4]);
    expect(table.rows.filter((row) => row.set_number > 2).every((row) => !row.completed)).toBe(true);
    expect(planItem('ex-a')?.target_sets).toBe(4);
    expect(table.chain.insert).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.set_number)).toEqual([1, 2, 3, 4]);
  });

  it('live: a set logged while target sets change stays logged (no whole-workout refetch)', async () => {
    const sets = [set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, false)];
    const table = createSetsTable(sets);
    routeLiveWorkout(table);
    useAppStore.setState({
      currentWorkout: flexWorkout(sets),
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [item('ex-a', 0, { target_sets: 2 })] },
    });
    // The user logs a2 while the insert request is in flight.
    const insert = table.chain.insert.getMockImplementation()!;
    table.chain.insert.mockImplementationOnce((payload: Partial<WorkoutSet>[]) => {
      const current = useAppStore.getState().currentWorkout!;
      useAppStore.setState({
        currentWorkout: { ...current, sets: current.sets.map((row) => (row.id === 'a2' ? { ...row, completed: true } : row)) },
      });
      return insert(payload);
    });

    await useAppStore.getState().updateFlexibleExerciseMeta('ex-a', { target_sets: 3 });

    const liveSets = useAppStore.getState().currentWorkout!.sets;
    expect(liveSets.find((row) => row.id === 'a2')?.completed).toBe(true);
    expect(liveSets.map((row) => row.set_number)).toEqual([1, 2, 3]);
    expect(supabaseMock.from.mock.calls.map(([name]) => name)).not.toContain('workouts');
  });

  it('live: a superset partner takes the same target and keeps its finished sets', async () => {
    const sets = [
      set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, false), set('a3', 'ex-a', 3, false),
      set('b1', 'ex-b', 1, true), set('b2', 'ex-b', 2, false), set('b3', 'ex-b', 3, true),
    ];
    const table = createSetsTable(sets);
    routeLiveWorkout(table);
    useAppStore.setState({
      currentWorkout: flexWorkout(sets),
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [
        item('ex-a', 0, { target_sets: 3, superset_group_id: 'group-1' }),
        item('ex-b', 1, { target_sets: 3, superset_group_id: 'group-1' }),
        item('ex-c', 2, { target_sets: 3 }),
      ] },
    });

    await useAppStore.getState().updateFlexibleExerciseMeta('ex-a', { target_sets: 2 });

    expect(planItem('ex-a')?.target_sets).toBe(2);
    expect(planItem('ex-b')?.target_sets).toBe(2);
    expect(planItem('ex-c')?.target_sets).toBe(3);
    expect(table.numbersFor('ex-a')).toEqual([1, 2]);
    // b3 is finished, so it survives even though it is above the new target
    expect(table.rows.filter((row) => row.exercise_id === 'ex-b').map((row) => row.id).sort()).toEqual(['b1', 'b2', 'b3']);
    expect(table.deletedIds).toEqual(['a3']);
  });

  it('live: editing only notes writes the plan and never touches sets or refetches the workout', async () => {
    const sets = [set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, false)];
    const table = createSetsTable(sets);
    routeLiveWorkout(table);
    const workout = flexWorkout(sets);
    useAppStore.setState({
      currentWorkout: workout,
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [item('ex-a', 0, { target_sets: 2 })] },
    });

    await useAppStore.getState().updateFlexibleExerciseMeta('ex-a', { notes: 'Pause at the bottom' });

    expect(planItem('ex-a')).toMatchObject({ notes: 'Pause at the bottom', target_sets: 2 });
    expect(supabaseMock.from.mock.calls.map(([name]) => name)).not.toContain('sets');
    expect(supabaseMock.from.mock.calls.map(([name]) => name)).not.toContain('workouts');
    expect(table.rows).toEqual(sets);
    expect(useAppStore.getState().currentWorkout).toBe(workout);
  });

  it('live: removing an exercise hides it, breaks its superset and deletes only its unfinished sets', async () => {
    const sets = [
      set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, false), set('a3', 'ex-a', 3, false),
      set('b1', 'ex-b', 1, false),
    ];
    const table = createSetsTable(sets);
    routeLiveWorkout(table);
    useAppStore.setState({
      currentWorkout: flexWorkout(sets),
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [
        item('ex-a', 0, { superset_group_id: 'group-1' }),
        item('ex-b', 1, { superset_group_id: 'group-1' }),
        item('ex-c', 2, { superset_group_id: 'group-2' }),
      ] },
    });

    await useAppStore.getState().removeFlexibleExerciseFromPlan('ex-a');

    expect(planItem('ex-a')).toMatchObject({ hidden: true, superset_group_id: null });
    expect(planItem('ex-b')).toMatchObject({ hidden: false, superset_group_id: null });
    expect(planItem('ex-c')).toMatchObject({ hidden: false, superset_group_id: 'group-2' });
    expect(table.deletedIds.sort()).toEqual(['a2', 'a3']);
    expect(table.rows.map((row) => row.id).sort()).toEqual(['a1', 'b1']);
    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id).sort()).toEqual(['a1', 'b1']);
  });

  it('live: re-adding a removed exercise as a superset partner keeps its finished set and adds no duplicate set 1', async () => {
    const sets = [
      set('a1', 'ex-a', 1, false), set('a2', 'ex-a', 2, false), set('a3', 'ex-a', 3, false),
      set('b1', 'ex-b', 1, true), set('b2', 'ex-b', 2, false), set('b3', 'ex-b', 3, false),
    ];
    const table = createSetsTable(sets);
    routeLiveWorkout(table);
    useAppStore.setState({
      currentWorkout: flexWorkout(sets),
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [
        item('ex-a', 0, { target_sets: 3 }),
        item('ex-b', 1, { target_sets: 3 }),
      ] },
    });

    await useAppStore.getState().removeFlexibleExerciseFromPlan('ex-b');
    expect(table.numbersFor('ex-b')).toEqual([1]);

    await useAppStore.getState().addFlexibleSuperset('ex-a', {
      id: 'ex-b', name: 'ex-b', muscle_group: 'back', muscle_group_secondary: null, equipment: 'barbell', is_compound: true,
    });

    expect(table.chain.insert).not.toHaveBeenCalled();
    expect(table.numbersFor('ex-b')).toEqual([1]);
    expect(useAppStore.getState().currentWorkout?.sets.filter((row) => row.exercise_id === 'ex-b').map((row) => row.id)).toEqual(['b1']);
    const visible = useAppStore.getState().currentWorkoutDayPlan?.items.filter((row) => !row.hidden);
    expect(visible?.map((row) => [row.exercise_id, row.superset_group_id !== null])).toEqual([['ex-a', true], ['ex-b', true]]);
  });

  // History edits go through ensureWorkoutDayPlan/updateWorkoutDayPlanItems and
  // read the sets fresh from the table.
  function stubHistoryPlan(items: FlexiblePlanItem[]) {
    const plan: WorkoutDayPlan = { id: 'plan-1', workout_id: 'workout-1', day_label: 'Past', items };
    let written: FlexiblePlanItem[] | null = null;
    useAppStore.setState({
      ensureWorkoutDayPlan: vi.fn(async () => plan),
      fetchWorkoutDayPlanByWorkoutId: vi.fn(async () => plan),
      updateWorkoutDayPlanItems: vi.fn(async (_workoutId: string, next: FlexiblePlanItem[]) => {
        written = next;
        return { ...plan, items: next };
      }),
    });
    return { writtenItem: (exerciseId: string) => written?.find((row) => row.exercise_id === exerciseId), written: () => written };
  }

  it('History: raising target sets adds numbered sets for the exercise and its superset partner', async () => {
    const table = createSetsTable([
      set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, true),
      set('b1', 'ex-b', 1, true), set('b2', 'ex-b', 2, false),
      set('c1', 'ex-c', 1, true),
    ]);
    supabaseMock.from.mockImplementation((name: string) => {
      if (name === 'sets') return table.chain;
      throw new Error(`Unexpected table: ${name}`);
    });
    const plan = stubHistoryPlan([
      item('ex-a', 0, { target_sets: 2, superset_group_id: 'group-1' }),
      item('ex-b', 1, { target_sets: 2, superset_group_id: 'group-1' }),
      item('ex-c', 2, { target_sets: 1 }),
    ]);

    await useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'ex-a', 4);

    expect(table.numbersFor('ex-a')).toEqual([1, 2, 3, 4]);
    expect(table.numbersFor('ex-b')).toEqual([1, 2, 3, 4]);
    expect(table.numbersFor('ex-c')).toEqual([1]);
    expect(plan.writtenItem('ex-a')?.target_sets).toBe(4);
    expect(plan.writtenItem('ex-b')?.target_sets).toBe(4);
    expect(plan.writtenItem('ex-c')?.target_sets).toBe(1);
  });

  it('History: lowering target sets keeps finished sets and removes only unfinished ones above the target', async () => {
    const table = createSetsTable([
      set('a1', 'ex-a', 1, true), set('a2', 'ex-a', 2, false), set('a3', 'ex-a', 3, true), set('a4', 'ex-a', 4, false),
      set('b1', 'ex-b', 1, true), set('b2', 'ex-b', 2, true), set('b3', 'ex-b', 3, false), set('b4', 'ex-b', 4, true),
    ]);
    supabaseMock.from.mockImplementation((name: string) => {
      if (name === 'sets') return table.chain;
      throw new Error(`Unexpected table: ${name}`);
    });
    const plan = stubHistoryPlan([
      item('ex-a', 0, { superset_group_id: 'group-1' }),
      item('ex-b', 1, { superset_group_id: 'group-1' }),
    ]);

    await useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'ex-a', 2);

    expect(table.deletedIds.sort()).toEqual(['a4', 'b3']);
    expect(table.rows.map((row) => row.id).sort()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b4']);
    expect(plan.writtenItem('ex-a')?.target_sets).toBe(2);
    expect(plan.writtenItem('ex-b')?.target_sets).toBe(2);
  });

  // Both paths share planSetCountChange, so added sets are numbered after the
  // highest existing number and a gap never produces a duplicate.
  it('numbers added sets from the highest set number in both live and History when numbers have gaps', async () => {
    const gapped = () => [set('a1', 'ex-a', 1, true), set('a3', 'ex-a', 3, false)];

    const liveTable = createSetsTable(gapped());
    routeLiveWorkout(liveTable);
    useAppStore.setState({
      currentWorkout: flexWorkout(gapped()),
      currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [item('ex-a', 0, { target_sets: 2 })] },
    });
    await useAppStore.getState().updateFlexibleExerciseMeta('ex-a', { target_sets: 4 });
    expect(liveTable.numbersFor('ex-a')).toEqual([1, 3, 4, 5]);
    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.set_number)).toEqual([1, 3, 4, 5]);

    const historyTable = createSetsTable(gapped());
    supabaseMock.from.mockImplementation((name: string) => {
      if (name === 'sets') return historyTable.chain;
      throw new Error(`Unexpected table: ${name}`);
    });
    stubHistoryPlan([item('ex-a', 0, { target_sets: 2 })]);
    await useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'ex-a', 4);
    expect(historyTable.numbersFor('ex-a')).toEqual([1, 3, 4, 5]);
  });

  it('History: clearing a superset ungroups every member and leaves other items alone', async () => {
    supabaseMock.from.mockImplementation((name: string) => { throw new Error(`Unexpected table: ${name}`); });
    const plan = stubHistoryPlan([
      item('ex-a', 0, { superset_group_id: 'group-1' }),
      item('ex-b', 1, { superset_group_id: 'group-1' }),
      item('ex-c', 2, { superset_group_id: 'group-2' }),
      item('ex-d', 3, { superset_group_id: 'group-2' }),
      item('ex-e', 4),
    ]);

    await useAppStore.getState().clearWorkoutSuperset('workout-1', 'ex-b');

    expect(plan.written()?.map((row) => [row.exercise_id, row.superset_group_id])).toEqual([
      ['ex-a', null], ['ex-b', null], ['ex-c', 'group-2'], ['ex-d', 'group-2'], ['ex-e', null],
    ]);
  });
});

describe('History plan edits read the plan once and write it once', () => {
  const realPlanActions = {
    ensureWorkoutDayPlan: useAppStore.getState().ensureWorkoutDayPlan,
    updateWorkoutDayPlanItems: useAppStore.getState().updateWorkoutDayPlanItems,
    fetchWorkoutDayPlanByWorkoutId: useAppStore.getState().fetchWorkoutDayPlanByWorkoutId,
  };
  beforeEach(() => useAppStore.setState(realPlanActions));

  const item = (exerciseId: string, order: number, overrides: Partial<FlexiblePlanItem> = {}): FlexiblePlanItem => ({
    exercise_id: exerciseId, exercise_name: exerciseId, order, target_sets: 2,
    target_reps_min: 8, target_reps_max: 12, notes: null, hidden: false, superset_group_id: null, ...overrides,
  });
  const exercise = (id: string): Exercise => ({
    id, name: id, muscle_group: 'chest', muscle_group_secondary: null, equipment: 'barbell', is_compound: true,
  });

  // The plan table answers every read with the stored row and every write
  // with the written items; `sets` is any chain the edit needs.
  function routePlan(items: FlexiblePlanItem[], setsChain: Chain) {
    const row = { id: 'plan-1', workout_id: 'workout-1', day_label: 'Past', items };
    const plansChain = createChain({ maybeSingle: vi.fn(async () => ({ data: { ...row }, error: null })) });
    plansChain.update.mockImplementation((payload: { items: FlexiblePlanItem[] }) => { row.items = payload.items; return plansChain; });
    plansChain.single.mockImplementation(async () => ({ data: { ...row }, error: null }));
    supabaseMock.from.mockImplementation((name: string) => {
      if (name === 'workout_day_plans') return plansChain;
      if (name === 'sets') return setsChain;
      throw new Error(`Unexpected table: ${name}`);
    });
    return { reads: () => plansChain.maybeSingle.mock.calls.length, writes: () => plansChain.update.mock.calls.length, row };
  }

  it('adding an exercise', async () => {
    const created: WorkoutSet = {
      id: 'set-9', workout_id: 'workout-1', exercise_id: 'ex-b', set_number: 1,
      weight: null, reps: null, rpe: null, completed: false, completed_at: null,
    };
    const plan = routePlan([item('ex-a', 0)], createChain({
      order: vi.fn(async () => ({ data: [], error: null })),
      single: vi.fn(async () => ({ data: created, error: null })),
    }));

    await useAppStore.getState().addExerciseToWorkout('workout-1', exercise('ex-b'));

    expect([plan.reads(), plan.writes()]).toEqual([1, 1]);
    expect(plan.row.items.map((row) => [row.exercise_id, row.target_sets])).toEqual([['ex-a', 2], ['ex-b', 1]]);
  });

  it('removing an exercise', async () => {
    const plan = routePlan([item('ex-a', 0), item('ex-b', 1)], createChain());

    await useAppStore.getState().removeExerciseFromWorkout('workout-1', 'ex-b');

    expect([plan.reads(), plan.writes()]).toEqual([1, 1]);
    expect(plan.row.items.find((row) => row.exercise_id === 'ex-b')?.hidden).toBe(true);
  });

  it('adding and clearing a superset', async () => {
    const plan = routePlan([item('ex-a', 0)], createChain());

    await useAppStore.getState().addSupersetToWorkout('workout-1', 'ex-a', exercise('ex-b'));
    expect([plan.reads(), plan.writes()]).toEqual([1, 1]);
    expect(plan.row.items.map((row) => row.exercise_id)).toEqual(['ex-a', 'ex-b']);

    await useAppStore.getState().clearWorkoutSuperset('workout-1', 'ex-b');
    expect([plan.reads(), plan.writes()]).toEqual([2, 2]);
    expect(plan.row.items.every((row) => row.superset_group_id === null)).toBe(true);
  });

  it('changing target sets', async () => {
    const plan = routePlan([item('ex-a', 0)], createChain({
      order: vi.fn(async () => ({ data: [{ id: 'a1', set_number: 1, completed: true }, { id: 'a2', set_number: 2, completed: false }], error: null })),
    }));

    await useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'ex-a', 3);

    expect([plan.reads(), plan.writes()]).toEqual([1, 1]);
    expect(plan.row.items[0].target_sets).toBe(3);
  });
});

describe('fetchSplits reference stability', () => {
  type SplitRow = {
    id: string;
    name: string;
    is_active: boolean;
    days: Array<{ id: string; day_name: string; day_order: number; exercises: Array<{ id: string; exercise_id: string; exercise_order: number }> }>;
  };

  const baseSplits = (): SplitRow[] => [
    {
      id: 'split-a',
      name: 'Upper / Lower',
      is_active: true,
      days: [
        {
          id: 'day-2', day_name: 'Lower', day_order: 1, exercises: [
            { id: 'se-3', exercise_id: 'squat', exercise_order: 0 },
          ],
        },
        {
          id: 'day-1', day_name: 'Upper', day_order: 0, exercises: [
            { id: 'se-2', exercise_id: 'row', exercise_order: 1 },
            { id: 'se-1', exercise_id: 'bench', exercise_order: 0 },
          ],
        },
      ],
    },
    { id: 'split-b', name: 'Full body', is_active: false, days: [] },
  ];

  let payload: SplitRow[] = [];

  beforeEach(() => {
    payload = baseSplits();
    useAppStore.setState({ fetchSplits: realFetchSplits, splits: [], activeSplit: null });
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table !== 'splits') throw new Error(`Unexpected table: ${table}`);
      // Every response is freshly parsed, like a real network round trip.
      const response = { data: structuredClone(payload), error: null };
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
      };
      return query;
    });
  });

  async function refetch() {
    await useAppStore.getState().fetchSplits();
    const { splits, activeSplit } = useAppStore.getState();
    return { splits, activeSplit };
  }

  it('keeps the same splits and activeSplit references for an identical payload', async () => {
    const first = await refetch();
    expect(first.activeSplit?.id).toBe('split-a');
    expect(first.activeSplit?.days.map((day) => day.id)).toEqual(['day-1', 'day-2']);
    expect(first.activeSplit?.days[0].exercises.map((exercise) => exercise.exercise_id)).toEqual(['bench', 'row']);

    const second = await refetch();
    expect(second.splits).toBe(first.splits);
    expect(second.activeSplit).toBe(first.activeSplit);
  });

  it.each([
    ['renaming a day', (splits: SplitRow[]) => { splits[0].days[1].day_name = 'Upper (heavy)'; }],
    ['adding a day', (splits: SplitRow[]) => { splits[0].days.push({ id: 'day-3', day_name: 'Arms', day_order: 2, exercises: [] }); }],
    ['removing a day', (splits: SplitRow[]) => { splits[0].days.splice(0, 1); }],
    ['reordering exercises', (splits: SplitRow[]) => {
      splits[0].days[1].exercises[0].exercise_order = 0;
      splits[0].days[1].exercises[1].exercise_order = 1;
    }],
    ['switching the active split', (splits: SplitRow[]) => { splits[0].is_active = false; splits[1].is_active = true; }],
    ['deleting a split', (splits: SplitRow[]) => { splits.splice(1, 1); }],
  ])('publishes new references after %s', async (_label, edit) => {
    const first = await refetch();
    edit(payload);
    const second = await refetch();

    expect(second.splits).not.toBe(first.splits);
    expect(second.activeSplit).not.toBe(first.activeSplit);
    expect(second.splits).toEqual(payload.map((split) => ({
      ...split,
      days: [...split.days]
        .map((day) => ({ ...day, exercises: [...day.exercises].sort((a, b) => a.exercise_order - b.exercise_order) }))
        .sort((a, b) => a.day_order - b.day_order),
    })));
    expect(second.activeSplit?.id).toBe(payload.find((split) => split.is_active)?.id);
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
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
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
    // one lookup for the sync and one for the status refresh, none per write
    expect(supabaseMock.auth.getSession).toHaveBeenCalledTimes(2);
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it('reports a sync with a failed segment link instead of calling it unavailable', async () => {
    const db = installRecordingSupabase((query) => {
      const kind = whoopReadKind(query);
      if (kind === 'watermark') return { data: null, error: null };
      if (kind === 'segmentsWindow') return { data: [makeWhoopSegment({ id: 'seg-new' })], error: null };
      if (query.table === 'activity_sessions' && query.action === 'insert') {
        return { data: { ...(query.payload as object), id: 'created-session' }, error: null };
      }
      if (query.table === 'activity_segments' && query.action === 'update') {
        return { data: null, error: { message: 'timeout' } };
      }
      return undefined;
    });

    const result = await useAppStore.getState().syncWhoop();

    expect(result).toMatchObject({ created: 0, deleted: 0 });
    expect(db.writes().filter((q) => q.table === 'activity_sessions')).toHaveLength(1);
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
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
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
