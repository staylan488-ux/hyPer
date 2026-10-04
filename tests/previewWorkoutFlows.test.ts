import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '@/preview/mockSupabase';
import { previewTables } from '@/preview/previewData';

vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: () => client.auth.getUser(), getSession: () => client.auth.getSession() },
  from: (table: string) => client.from(table),
  rpc: (name: string, params: Record<string, unknown>) => client.rpc(name, params),
} }));
vi.mock('@/preview/flag', () => ({ isPreviewActive: () => true, isAppSandboxActive: () => false }));

import { useAppStore } from '@/stores/appStore';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { maybeSeedPreview } from '@/preview/previewSeed';
import { serializeSetRangeNotes } from '@/lib/setRangeNotes';

let client = createMockClient();
const fixture = structuredClone(previewTables);
const initialStore = useAppStore.getState();

beforeEach(() => {
  for (const key of Object.keys(previewTables)) delete previewTables[key];
  Object.assign(previewTables, structuredClone(fixture));
  client = createMockClient();
  useAppStore.setState(initialStore, true);
  useSplitEditStore.getState().cancelEdit();
});

describe('preview uses real program and workout store paths', () => {
  it('keeps the real mutable-flow actions when seeding the visual preview', () => {
    maybeSeedPreview();
    expect(useAppStore.getState().fetchSplits).toBe(initialStore.fetchSplits);
    expect(useAppStore.getState().fetchCurrentWorkout).toBe(initialStore.fetchCurrentWorkout);
    expect(useAppStore.getState().fetchWorkoutById).toBe(initialStore.fetchWorkoutById);
    expect(useAppStore.getState().ensureWorkoutDayPlan).toBe(initialStore.ensureWorkoutDayPlan);
  });

  it('refetches renamed programs, child edits and created programs through nested joins', async () => {
    await useAppStore.getState().fetchSplits();
    expect(useAppStore.getState().activeSplit?.days[0].exercises[0].exercise?.name).toBeTruthy();
    await useAppStore.getState().updateSplit('split1', { name: 'Studio test plan' });
    expect(useAppStore.getState().activeSplit?.name).toBe('Studio test plan');
    await client.from('split_days').update({ day_name: 'Upper revised' }).eq('id', 'd1');
    await useAppStore.getState().fetchSplits();
    expect(useAppStore.getState().activeSplit?.days[0].day_name).toBe('Upper revised');
    const created = await useAppStore.getState().createSplit({ name: 'New plan', description: null, days_per_week: 1, is_active: false,
      days: [{ day_name: 'Day one', day_order: 0, exercises: [{ exercise_id: 'ex_row', target_sets: 2, target_reps_min: 8, target_reps_max: 12, exercise_order: 0 }] }] });
    const refreshed = useAppStore.getState().splits.find((split) => split.id === created?.id);
    expect(refreshed?.days[0].exercises[0].exercise?.name).toBe('Barbell Row');
    expect(refreshed?.is_active).toBe(false);
    expect(useAppStore.getState().activeSplit?.id).toBe('split1');
  });

  it('creates an active program in one snapshot and leaves exactly one program active', async () => {
    await useAppStore.getState().fetchSplits();
    const rangeNotes = serializeSetRangeNotes(null, 2, 3, 4);
    const created = await useAppStore.getState().createSplit({ name: 'Second plan', description: 'Two days', days_per_week: 3, is_active: true,
      days: [
        { day_name: 'Push', day_order: 7, exercises: [
          { exercise_id: 'ex_bench', target_sets: 3, target_reps_min: 6, target_reps_max: 10, exercise_order: 5, notes: rangeNotes },
          { exercise_id: 'ex_lateral', target_sets: 3, target_reps_min: 12, target_reps_max: 15, exercise_order: 9, superset_group_id: 'group-a' },
          { exercise_id: 'ex_pushdown', target_sets: 3, target_reps_min: 10, target_reps_max: 12, exercise_order: 1, superset_group_id: 'group-a' },
        ] },
        { day_name: 'Pull', day_order: 3, exercises: [
          { exercise_id: 'ex_row', target_sets: 4, target_reps_min: 8, target_reps_max: 12, exercise_order: 0 },
          { exercise_id: 'ex_curl', target_sets: 2, target_reps_min: 10, target_reps_max: 15, exercise_order: 0 },
        ] },
      ] });
    expect(created).not.toBeNull();
    const { splits, activeSplit } = useAppStore.getState();
    expect(splits.filter((split) => split.is_active).map((split) => split.id)).toEqual([created!.id]);
    expect(activeSplit?.id).toBe(created!.id);
    expect(activeSplit?.days_per_week).toBe(3);
    expect(activeSplit?.days.map((day) => [day.day_name, day.day_order])).toEqual([['Push', 0], ['Pull', 1]]);
    expect(activeSplit?.days[0].exercises.map((ex) => [ex.exercise_id, ex.exercise_order, ex.superset_group_id ?? null, ex.notes ?? null])).toEqual([
      ['ex_bench', 0, null, rangeNotes],
      ['ex_lateral', 1, 'group-a', null],
      ['ex_pushdown', 2, 'group-a', null],
    ]);
    expect(activeSplit?.days[1].exercises.map((ex) => [ex.exercise_id, ex.exercise_order])).toEqual([['ex_row', 0], ['ex_curl', 1]]);
    expect(splits.find((split) => split.id === 'split1')?.is_active).toBe(false);
  });

  it('removes the half-made program and keeps the current one active when the snapshot fails', async () => {
    await useAppStore.getState().fetchSplits();
    const splitCount = previewTables.splits.length;
    const dayCount = previewTables.split_days.length;
    vi.spyOn(client, 'rpc').mockResolvedValueOnce({ data: null, error: { message: 'connection lost' } } as never);
    const created = await useAppStore.getState().createSplit({ name: 'Doomed plan', description: null, days_per_week: 1, is_active: true,
      days: [{ day_name: 'Only day', day_order: 0, exercises: [{ exercise_id: 'ex_row', target_sets: 3, target_reps_min: 8, target_reps_max: 12, exercise_order: 0 }] }] });
    expect(created).toBeNull();
    expect(previewTables.splits).toHaveLength(splitCount);
    expect(previewTables.split_days).toHaveLength(dayCount);
    expect(previewTables.splits.find((split) => split.id === 'split1')?.is_active).toBe(true);
    await useAppStore.getState().fetchSplits();
    expect(useAppStore.getState().activeSplit?.id).toBe('split1');
  });

  it('saves the actual program editor snapshot, retaining IDs and removing omitted rows', async () => {
    await useAppStore.getState().fetchSplits();
    const original = useAppStore.getState().activeSplit!;
    const firstDay = original.days[0];
    const removedExercise = firstDay.exercises[0];
    const retainedExercise = firstDay.exercises[1];
    const removedDay = original.days.at(-1)!;
    useSplitEditStore.getState().startEdit(original);
    useSplitEditStore.getState().renameSplit('Upper / Lower Studio');
    useSplitEditStore.getState().renameDay(firstDay.id, 'Upper studio');
    useSplitEditStore.getState().removeExercise(firstDay.id, removedExercise.id);
    useSplitEditStore.getState().updateExerciseTargets(firstDay.id, retainedExercise.id, { target_reps_min: 9 });
    useSplitEditStore.getState().removeDay(removedDay.id);
    useSplitEditStore.getState().addDay('New studio day');
    const newDay = useSplitEditStore.getState().draft!.days.at(-1)!;
    useSplitEditStore.getState().addExercise(newDay.id, removedExercise.exercise);
    expect(await useSplitEditStore.getState().saveEdit()).toBe(true);
    await useAppStore.getState().fetchSplits();
    const updated = useAppStore.getState().activeSplit!;
    expect(updated.name).toBe('Upper / Lower Studio');
    expect(updated.days[0]).toMatchObject({ id: firstDay.id, day_name: 'Upper studio' });
    expect(updated.days[0].exercises.some((exercise) => exercise.id === removedExercise.id)).toBe(false);
    expect(updated.days[0].exercises.find((exercise) => exercise.id === retainedExercise.id)?.target_reps_min).toBe(9);
    expect(updated.days.some((day) => day.id === removedDay.id)).toBe(false);
    expect(updated.days.at(-1)?.exercises[0].exercise.name).toBe(removedExercise.exercise.name);
    expect(previewTables.workouts.find((workout) => workout.id === 'w_current')?.split_day_id).toBe(firstDay.id);
  });

  it('preserves 3/9 initial state, completes it, starts real placeholder sets and resumes them', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    const initial = useAppStore.getState().currentWorkout!;
    expect(initial.sets).toHaveLength(9);
    expect(initial.sets.filter((set) => set.completed)).toHaveLength(3);
    await useAppStore.getState().completeWorkout();
    const started = await useAppStore.getState().startWorkout('d1');
    expect(started?.id).not.toBe(initial.id);
    const plannedCount = previewTables.split_exercises.filter((row) => row.split_day_id === 'd1').reduce((sum, row) => sum + Number(row.target_sets), 0);
    expect(started?.sets).toHaveLength(plannedCount);
    expect(started?.sets.every((set) => !set.completed && set.exercise?.name)).toBe(true);
    await useAppStore.getState().fetchCurrentWorkout();
    expect(useAppStore.getState().currentWorkout?.id).toBe(started?.id);
  });

  it('persists past-set edits on refetch and constructs the editable history day plan', async () => {
    const previous = previewTables.workouts.find((workout) => workout.completed === true)!;
    const before = await useAppStore.getState().fetchWorkoutById(String(previous.id));
    const originalId = before!.sets[0].id;
    await useAppStore.getState().updateSet(originalId, { weight: 123, reps: 7 });
    const after = await useAppStore.getState().fetchWorkoutById(String(previous.id));
    expect(after?.sets.find((set) => set.id === originalId)).toMatchObject({ weight: 123, reps: 7 });
    const plan = await useAppStore.getState().ensureWorkoutDayPlan(String(previous.id));
    expect(plan?.items.length).toBeGreaterThan(0);
    expect(plan?.items.every((item) => item.exercise_name)).toBe(true);
  });

  it('fails both automatic save attempts without mutation, then Retry saves the same row', async () => {
    client = createMockClient({ setSaveFailures: 2 });
    await useAppStore.getState().fetchCurrentWorkout();
    const original = useAppStore.getState().currentWorkout!.sets.find((set) => !set.completed)!;
    await expect(useAppStore.getState().logSet(original.exercise_id, original.set_number, 82.5, 10, 7)).rejects.toMatchObject({ code: 'PREVIEW_FAILURE' });
    expect(previewTables.sets.find((set) => set.id === original.id)?.completed).toBe(false);
    await useAppStore.getState().logSet(original.exercise_id, original.set_number, 82.5, 10, 7);
    const updated = useAppStore.getState().currentWorkout!.sets;
    expect(updated).toHaveLength(9);
    expect(updated.find((set) => set.id === original.id)).toMatchObject({ weight: 82.5, reps: 10, completed: true });
  });

  it('starts a flexible session and refetches added movement sets with names', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    await useAppStore.getState().completeWorkout();
    await useAppStore.getState().setWorkoutMode('flexible');
    const started = await useAppStore.getState().startFlexibleWorkout('Pull');
    expect(started?.sets).toEqual([]);
    const exercise = (await client.from('exercises').select('*').eq('id', 'ex_row').single()).data;
    await useAppStore.getState().addFlexibleExercise(exercise);
    const current = useAppStore.getState().currentWorkout;
    expect(current?.sets).toHaveLength(3);
    expect(current?.sets.every((set) => set.exercise?.name === 'Barbell Row')).toBe(true);
    expect(useAppStore.getState().currentWorkoutDayPlan?.items[0].exercise_id).toBe('ex_row');
  });

  it('persists movement order without changing sets, targets or the source program', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    const workout = useAppStore.getState().currentWorkout!;
    const plan = await useAppStore.getState().ensureWorkoutDayPlan(workout.id);
    const sets = structuredClone(previewTables.sets);
    const program = structuredClone(previewTables.split_exercises);
    const ids = plan!.items.map((item) => item.exercise_id).reverse();
    await useAppStore.getState().reorderWorkoutExercises(workout.id, ids);
    const refreshed = await useAppStore.getState().fetchWorkoutDayPlanByWorkoutId(workout.id);
    expect(refreshed!.items.map((item) => item.exercise_id)).toEqual(ids);
    for (const item of refreshed!.items) {
      expect(item).toEqual({ ...plan!.items.find((entry) => entry.exercise_id === item.exercise_id), order: item.order });
    }
    expect(previewTables.sets).toEqual(sets);
    expect(previewTables.split_exercises).toEqual(program);
  });

  it('deleting a program cascades its days and preserves workouts with an unlinked day', async () => {
    await useAppStore.getState().deleteSplit('split1');
    expect(useAppStore.getState().splits).toHaveLength(0);
    expect(previewTables.split_days).toHaveLength(0);
    expect(previewTables.split_exercises).toHaveLength(0);
    expect(previewTables.workouts.length).toBeGreaterThan(0);
    expect(previewTables.workouts.every((workout) => workout.split_day_id === null)).toBe(true);
  });
});
