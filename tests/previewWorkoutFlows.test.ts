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
import { blankSplitDraft } from '@/lib/splitDraftSeed';
import { buildSessionModel } from '../native/src/lib/sessionModel';

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

  it('creates a program from the shared editor through the real createSplit path', async () => {
    await useAppStore.getState().fetchSplits();
    const existing = useAppStore.getState().activeSplit!;
    const [first, second] = existing.days[0].exercises;
    const draft = blankSplitDraft(2);
    useSplitEditStore.getState().startNew(draft);
    useSplitEditStore.getState().renameSplit('Fresh plan');
    useSplitEditStore.getState().renameDay(draft.days[0].id, 'Push');
    useSplitEditStore.getState().addExercises(draft.days[0].id, [first.exercise, second.exercise]);
    useSplitEditStore.getState().addExercises(draft.days[1].id, [first.exercise]);
    const pushIds = useSplitEditStore.getState().draft!.days[0].exercises.map((ex) => ex.id);
    useSplitEditStore.getState().moveExerciseTo(draft.days[0].id, pushIds[1], pushIds[0]);

    const saved = await useSplitEditStore.getState().saveEdit({ createSplit: useAppStore.getState().createSplit });

    expect(saved).toMatchObject({ name: 'Fresh plan', created: true });
    const created = useAppStore.getState().splits.find((split) => split.id === saved!.id)!;
    expect(created.is_active).toBe(true);
    expect(created.days.map((day) => day.day_name)).toEqual(['Push', 'Day 2']);
    expect(created.days[0].exercises.map((ex) => ex.exercise_id)).toEqual([second.exercise_id, first.exercise_id]);
    expect(useSplitEditStore.getState().draft).toBeNull();
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
    expect(await useSplitEditStore.getState().saveEdit()).toEqual({ id: original.id, name: 'Upper / Lower Studio', created: false });
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

  it('preserves 5/9 initial state, completes it, starts real placeholder sets and resumes them', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    const initial = useAppStore.getState().currentWorkout!;
    expect(initial.sets).toHaveLength(9);
    expect(initial.sets.filter((set) => set.completed)).toHaveLength(5);
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
    await expect(useAppStore.getState().logSet(original.id, 82.5, 10, 7)).rejects.toMatchObject({ code: 'PREVIEW_FAILURE' });
    expect(previewTables.sets.find((set) => set.id === original.id)?.completed).toBe(false);
    await useAppStore.getState().logSet(original.id, 82.5, 10, 7);
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

  it('shows a movement removed from a flexible session again when it comes back as a superset partner', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    await useAppStore.getState().completeWorkout();
    await useAppStore.getState().setWorkoutMode('flexible');
    const started = await useAppStore.getState().startFlexibleWorkout('Pull');
    const row = (await client.from('exercises').select('*').eq('id', 'ex_row').single()).data;
    const curl = (await client.from('exercises').select('*').eq('id', 'ex_curl').single()).data;
    await useAppStore.getState().addFlexibleExercise(row);
    await useAppStore.getState().addFlexibleExercise(curl);
    await useAppStore.getState().removeFlexibleExerciseFromPlan('ex_curl');
    await useAppStore.getState().addFlexibleSuperset('ex_row', curl);

    const plan = useAppStore.getState().currentWorkoutDayPlan!;
    expect(plan.items.map((item) => [item.exercise_id, item.order, item.hidden])).toEqual([['ex_row', 0, false], ['ex_curl', 1, false]]);
    expect(plan.items[1].superset_group_id).toBe(plan.items[0].superset_group_id);
    const model = buildSessionModel(useAppStore.getState().currentWorkout, { split: null, plan }, null);
    expect(model?.movements.map((movement) => [movement.exerciseId, movement.superset?.role])).toEqual([['ex_row', 'A'], ['ex_curl', 'B']]);
    expect(started?.id).toBe(plan.workout_id);
  });

  it('keeps one plan item for a movement removed in History and added back as a superset partner', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    const workout = useAppStore.getState().currentWorkout!;
    const plan = await useAppStore.getState().ensureWorkoutDayPlan(workout.id);
    const [base, partner] = plan!.items.filter((item) => !item.superset_group_id).map((item) => item.exercise_id);
    const partnerRow = (await client.from('exercises').select('*').eq('id', partner).single()).data;
    await useAppStore.getState().removeExerciseFromWorkout(workout.id, partner);
    await useAppStore.getState().addSupersetToWorkout(workout.id, base, partnerRow);

    const stored = await useAppStore.getState().fetchWorkoutDayPlanByWorkoutId(workout.id);
    const copies = stored!.items.filter((item) => item.exercise_id === partner);
    expect(copies).toHaveLength(1);
    expect(copies[0].hidden).toBe(false);
    const baseItem = stored!.items.find((item) => item.exercise_id === base)!;
    expect(copies[0].superset_group_id).toBe(baseItem.superset_group_id);
    expect(copies[0].order).toBe(baseItem.order + 1);
    expect(stored!.items.map((item) => item.order)).toEqual(stored!.items.map((_, index) => index));
  });

  it('pairs a superset added in History to the live program workout on Train at once', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    await useAppStore.getState().fetchSplits();
    const workout = useAppStore.getState().currentWorkout!;
    // A plain program session: no swap, skip or reorder yet, so no plan.
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
    const base = workout.sets.at(-1)!.exercise_id;
    const partner = (await client.from('exercises').select('*').eq('id', 'ex_pullup').single()).data;

    await useAppStore.getState().addSupersetToWorkout(workout.id, base, partner);

    const plan = useAppStore.getState().currentWorkoutDayPlan;
    expect(plan?.workout_id).toBe(workout.id);
    const model = buildSessionModel(useAppStore.getState().currentWorkout, { split: useAppStore.getState().activeSplit, plan }, null);
    const paired = model?.movements.filter((movement) => movement.superset).map((movement) => [movement.exerciseId, movement.superset?.role]);
    expect(paired).toContainEqual([base, 'A']);
    expect(paired).toContainEqual(['ex_pullup', 'B']);
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

  it('skips a movement for this workout only, brings it back, and keeps the program and sets', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    const workout = useAppStore.getState().currentWorkout!;
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
    const sets = structuredClone(previewTables.sets);
    const program = structuredClone(previewTables.split_exercises);
    const skippedId = workout.sets.find((set) => !set.completed)!.exercise_id;

    // A program session gets its own plan the first time, in the store too.
    await useAppStore.getState().skipWorkoutExercise(workout.id, skippedId, true);
    const plan = useAppStore.getState().currentWorkoutDayPlan!;
    expect(plan.workout_id).toBe(workout.id);
    expect(plan.items.filter((item) => item.skipped).map((item) => item.exercise_id)).toEqual([skippedId]);
    const stored = await useAppStore.getState().fetchWorkoutDayPlanByWorkoutId(workout.id);
    expect(stored!.items.find((item) => item.exercise_id === skippedId)?.skipped).toBe(true);

    await useAppStore.getState().skipWorkoutExercise(workout.id, skippedId, false);
    const back = useAppStore.getState().currentWorkoutDayPlan!.items.find((item) => item.exercise_id === skippedId)!;
    expect('skipped' in back).toBe(false);
    expect(previewTables.sets).toEqual(sets);
    expect(previewTables.split_exercises).toEqual(program);
  });

  it('drops only the unlogged sets of skipped movements once finished', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    const workout = useAppStore.getState().currentWorkout!;
    const ofWorkout = () => previewTables.sets.filter((set) => set.workout_id === workout.id);
    const logged = workout.sets.find((set) => set.completed)!.exercise_id;
    const open = workout.sets.find((set) => !set.completed && set.exercise_id !== logged)!.exercise_id;
    const skipped = new Set([logged, open]);
    const untouched = structuredClone(ofWorkout().filter((set) => !skipped.has(set.exercise_id as string)));
    const loggedSets = structuredClone(ofWorkout().filter((set) => skipped.has(set.exercise_id as string) && set.completed));
    expect(loggedSets.length).toBeGreaterThan(0);

    await useAppStore.getState().completeWorkout();
    await useAppStore.getState().removeUnloggedSets(workout.id, [...skipped]);
    expect(ofWorkout().filter((set) => skipped.has(set.exercise_id as string))).toEqual(loggedSets);
    expect(ofWorkout().filter((set) => !skipped.has(set.exercise_id as string))).toEqual(untouched);
  });

  it('saves a quick start with a skipped movement left in, unskipped', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    await useAppStore.getState().completeWorkout();
    await useAppStore.getState().setWorkoutMode('flexible');
    const started = await useAppStore.getState().startFlexibleWorkout('Pull');
    const exercise = (await client.from('exercises').select('*').eq('id', 'ex_row').single()).data;
    await useAppStore.getState().addFlexibleExercise(exercise);
    await useAppStore.getState().skipWorkoutExercise(started!.id, 'ex_row', true);
    expect(useAppStore.getState().currentWorkoutDayPlan?.items[0].skipped).toBe(true);
    await useAppStore.getState().saveFlexibleTemplateFromCurrentWorkout();
    await useAppStore.getState().fetchFlexTemplates({ force: true });
    const template = useAppStore.getState().flexTemplates.find((entry) => entry.label === 'Pull');
    expect(template?.items.map((item) => item.exercise_id)).toEqual(['ex_row']);
    expect(template?.items[0].skipped).toBeUndefined();
  });

  it('takes an unlogged set off a program movement in the store and the sample database', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    const workout = useAppStore.getState().currentWorkout!;
    expect(workout.split_day_id).toBe('d1');
    const exerciseId = workout.sets.find((set) => !set.completed)!.exercise_id;
    const removed = workout.sets
      .filter((set) => set.exercise_id === exerciseId && !set.completed)
      .sort((a, b) => b.set_number - a.set_number)[0];

    await useAppStore.getState().removeLastUncompletedSet(exerciseId);

    expect(previewTables.sets.some((set) => set.id === removed.id)).toBe(false);
    const sets = useAppStore.getState().currentWorkout!.sets;
    expect(sets.some((set) => set.id === removed.id)).toBe(false);
    expect(sets).toHaveLength(workout.sets.length - 1);
  });

  it('drops the sets a lower set count removed from the live workout', async () => {
    await useAppStore.getState().fetchCurrentWorkout();
    const workout = useAppStore.getState().currentWorkout!;
    // A movement with nothing logged yet, so every set past the first can go.
    const untouched = (id: string) => workout.sets.every((set) => set.exercise_id !== id || !set.completed);
    const exerciseId = workout.sets.find((set) => untouched(set.exercise_id))!.exercise_id;

    await useAppStore.getState().updateWorkoutExerciseTargetSets(workout.id, exerciseId, 1);

    const left = (rows: Array<{ workout_id?: unknown; exercise_id?: unknown }>) =>
      rows.filter((set) => set.workout_id === workout.id && set.exercise_id === exerciseId).length;
    expect(left(previewTables.sets)).toBe(1);
    expect(left(useAppStore.getState().currentWorkout!.sets)).toBe(1);
  });

  it('gives back the WHOOP activity when a workout with its stats is deleted', async () => {
    const activity = (await client.from('activity_sessions').select('*').eq('id', 'act_intervals').single()).data;
    const workout = (await useAppStore.getState().fetchWorkoutById('wh1'))!;
    expect(workout.date).toBe(activity.date);
    const month = new Date(`${activity.date}T12:00:00`);
    const listed = async () => (await useAppStore.getState().fetchActivitySessionsByMonth(month)).some((entry) => entry.id === 'act_intervals');

    await useAppStore.getState().attachWhoopToWorkout(workout, activity);
    expect(await listed()).toBe(false);
    await useAppStore.getState().deleteWorkout('wh1');

    expect(previewTables.workouts.some((row) => row.id === 'wh1')).toBe(false);
    expect(await listed()).toBe(true);
  });

  it('answers a delete with its rows only when asked to return them', async () => {
    const plain = await client.from('sets').delete().eq('id', 'cs9');
    expect(plain).toMatchObject({ data: null, error: null, count: 1 });
    const returned = await client.from('sets').delete().eq('id', 'cs8').select('id');
    expect(returned.data).toEqual([expect.objectContaining({ id: 'cs8' })]);
    const one = await client.from('workouts').delete().eq('id', 'wh2').select('id, user_id').single();
    expect(one.data).toMatchObject({ id: 'wh2', user_id: expect.any(String) });
    expect((await client.from('sets').delete().eq('id', 'missing').select('id')).data).toEqual([]);
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
