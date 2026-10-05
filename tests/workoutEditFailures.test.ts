import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise, FlexiblePlanItem, Workout, WorkoutDayPlan, WorkoutSet } from '@/types';

const backend = vi.hoisted(() => ({ from: vi.fn(), auth: { getSession: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ supabase: backend }));
import { useAppStore } from '@/stores/appStore';
import { runWorkoutEdit } from '@/lib/workoutEdit';

type Result = { data: unknown; error: unknown };
function query(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'insert', 'update', 'delete']) chain[method] = vi.fn(() => chain);
  chain.single = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
const item = (id: string): FlexiblePlanItem => ({ exercise_id: id, order: 0, target_sets: 2, notes: null });
const makeWorkout = (): Workout => ({ id: 'workout', user_id: 'user', split_day_id: null, notes: null, completed: false, date: '2026-10-04', created_at: new Date().toISOString(), sets: [] });
const makePlan = (): WorkoutDayPlan => ({ id: 'plan', workout_id: 'workout', day_label: 'Pull', items: [item('row')] });
const row: Exercise = { id: 'row', name: 'Row', muscle_group: 'back', muscle_group_secondary: null, equipment: 'cable', is_compound: true };
const makeSet = (number: number, completed = true): WorkoutSet => ({ id: `s${number}`, workout_id: 'workout', exercise_id: 'row', set_number: number, weight: completed ? 50 : null, reps: completed ? 8 : null, rpe: null, completed, completed_at: completed ? '2026-10-04T10:00:00Z' : null });
const actions = { ...useAppStore.getState() };

beforeEach(() => {
  backend.from.mockReset();
  backend.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user' } } } });
  useAppStore.setState({ ...actions, currentWorkout: null, currentWorkoutDayPlan: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('History edit failure and retry', () => {
  it('does not finish a workout after failed target growth, and repairs the same target on retry', async () => {
    const workout = makeWorkout();
    workout.sets = [makeSet(1), makeSet(2)];
    const plan = makePlan();
    let failInsert = true;
    backend.from.mockImplementation((table: string) => {
      if (table === 'workout_day_plans') {
        const chain = query({ data: plan, error: null });
        chain.update = vi.fn((patch: { items: FlexiblePlanItem[] }) => { plan.items = patch.items; return chain; });
        return chain;
      }
      if (table === 'sets') {
        const chain = query({ data: workout.sets, error: null });
        chain.insert = vi.fn((rows: Array<{ set_number: number }>) => {
          if (failInsert) return query({ data: null, error: { message: 'offline' } });
          workout.sets.push(...rows.map((entry) => makeSet(entry.set_number, false)));
          return query({ data: null, error: null });
        });
        return chain;
      }
      if (table === 'workouts') {
        const chain = query({ data: workout, error: null });
        chain.update = vi.fn((patch: Partial<Workout>) => { Object.assign(workout, patch); return chain; });
        return chain;
      }
      throw new Error(table);
    });
    const refresh = vi.fn(async (syncCompletion: boolean) => {
      if (syncCompletion) await useAppStore.getState().syncWorkoutCompletion(workout.id);
      await useAppStore.getState().fetchWorkoutById(workout.id);
    });
    const edit = () => useAppStore.getState().updateWorkoutExerciseTargetSets(workout.id, 'row', 3);

    expect(await runWorkoutEdit(edit, refresh)).toBe(false);
    expect(refresh).toHaveBeenLastCalledWith(false);
    expect(plan.items[0].target_sets).toBe(3);
    expect(workout.sets).toHaveLength(2);
    expect(workout.completed).toBe(false);

    failInsert = false;
    expect(await runWorkoutEdit(edit, refresh)).toBe(true);
    expect(refresh).toHaveBeenLastCalledWith(true);
    expect(workout.sets.map((set) => [set.set_number, set.completed])).toEqual([[1, true], [2, true], [3, false]]);
    expect(workout.completed).toBe(false);
  });

  it.each(['updateWorkoutExerciseTargetSets', 'addSupersetToWorkout', 'clearWorkoutSuperset'] as const)('%s rejects a failed plan write before touching sets', async (action) => {
    const plan = makePlan();
    plan.items[0].superset_group_id = action === 'clearWorkoutSuperset' ? 'group' : null;
    const chain = query({ data: plan, error: null });
    chain.single = vi.fn(async () => ({ data: null, error: { message: 'plan update failed' } }));
    backend.from.mockImplementation((table: string) => {
      if (table !== 'workout_day_plans') throw new Error(`Unexpected write/read to ${table}`);
      return chain;
    });
    const store = useAppStore.getState();
    const request = action === 'updateWorkoutExerciseTargetSets'
      ? store.updateWorkoutExerciseTargetSets('workout', 'row', 3)
      : action === 'addSupersetToWorkout'
        ? store.addSupersetToWorkout('workout', 'row', { ...row, id: 'curl', name: 'Curl' })
        : store.clearWorkoutSuperset('workout', 'row');
    await expect(request).rejects.toThrow('Could not save the workout plan');
    expect(backend.from.mock.calls.every(([table]) => table === 'workout_day_plans')).toBe(true);
  });

  it('never constructs a replacement plan from a failed plan read', async () => {
    backend.from.mockReturnValue(query({ data: null, error: { message: 'read failed' } }));
    await expect(useAppStore.getState().ensureWorkoutDayPlan('workout')).rejects.toThrow('Could not load the workout plan');
    expect(backend.from.mock.calls.map(([table]) => table)).toEqual(['workout_day_plans']);
  });
});

describe('flexible start recovery', () => {
  it.each([true, false])('rolls back a missing initial plan (server error: %s)', async (hasError) => {
    const workout = makeWorkout();
    const plans = query({ data: null, error: hasError ? { message: 'plan failed' } : null });
    const cleanup = query({ data: null, error: null });
    let workoutCalls = 0;
    backend.from.mockImplementation((table: string) => {
      if (table === 'workout_day_plans') return plans;
      if (table === 'workouts') {
        workoutCalls++;
        return workoutCalls === 3 ? cleanup : query({ data: workoutCalls === 1 ? null : workout, error: null });
      }
      throw new Error(table);
    });
    await expect(useAppStore.getState().startFlexibleWorkout('Pull')).rejects.toThrow("Couldn't start the workout");
    expect(cleanup.delete).toHaveBeenCalledOnce();
    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
  });

  it('replaces an empty orphan and creates a usable new plan', async () => {
    const orphan = { ...makeWorkout(), id: 'orphan' };
    const created = makeWorkout();
    const plan = makePlan();
    const cleanup = query({ data: null, error: null });
    let workoutCalls = 0;
    let planCalls = 0;
    backend.from.mockImplementation((table: string) => {
      if (table === 'workouts') {
        workoutCalls++;
        if (workoutCalls === 1) return query({ data: orphan, error: null });
        if (workoutCalls === 2) return cleanup;
        return query({ data: created, error: null });
      }
      if (table === 'workout_day_plans') return query({ data: ++planCalls === 1 ? null : plan, error: null });
      throw new Error(table);
    });
    expect(await useAppStore.getState().startFlexibleWorkout('Pull')).toEqual(created);
    expect(cleanup.delete).toHaveBeenCalledOnce();
    expect(useAppStore.getState().currentWorkoutDayPlan?.id).toBe('plan');
  });

  it('repairs an orphan with logged sets without deleting those sets or the workout', async () => {
    const existing = { ...makeWorkout(), sets: [makeSet(1)] };
    let recovered: WorkoutDayPlan | null = null;
    const deletion = vi.fn();
    backend.from.mockImplementation((table: string) => {
      const chain = query({ data: table === 'workouts' ? existing : table === 'sets' ? existing.sets : null, error: null });
      chain.delete = deletion;
      if (table === 'workout_day_plans') {
        chain.insert = vi.fn((input: Omit<WorkoutDayPlan, 'id'>) => {
          recovered = { id: 'repaired', ...input };
          return query({ data: recovered, error: null });
        });
      }
      return chain;
    });
    expect(await useAppStore.getState().startFlexibleWorkout('Recovered')).toEqual(existing);
    expect(deletion).not.toHaveBeenCalled();
    expect(useAppStore.getState().currentWorkout?.sets).toEqual([makeSet(1)]);
    expect(useAppStore.getState().currentWorkoutDayPlan).toMatchObject({ id: 'repaired', day_label: 'Recovered', items: [{ exercise_id: 'row', target_sets: 1 }] });
  });
});
