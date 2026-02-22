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
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
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
    neq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
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
  chain.neq.mockImplementation(() => chain);
  chain.in.mockImplementation(() => chain);
  chain.gte.mockImplementation(() => chain);
  chain.lte.mockImplementation(() => chain);
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
    workoutMode: 'split',
    currentWorkoutDayPlan: null,
    flexTemplates: [],
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
});
