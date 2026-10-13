import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exercise, Split } from '@/types';
import { memoryStorage } from './memoryStorage';

const backend = vi.hoisted(() => ({
  library: [] as Array<{ id: string; name: string; muscle_group: string }>,
  inserts: [] as Array<Array<{ name: string; muscle_group: string }>>,
  insertError: null as { code?: string; message: string } | null,
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (rows: Array<{ name: string; muscle_group: string }>) => ({
        select: async () => {
          backend.inserts.push(rows);
          if (backend.insertError) return { data: null, error: backend.insertError };
          const created = rows.map((row, index) => ({ id: `db-${backend.library.length + index}`, name: row.name }));
          backend.library.push(...rows.map((row, index) => ({ ...row, id: created[index].id })));
          return { data: created, error: null };
        },
      }),
    }),
    rpc: backend.rpc,
  },
}));
vi.mock('@/lib/exerciseLibrary', () => ({
  getExerciseLibrary: vi.fn(async () => backend.library.map((row) => ({ ...row }))),
  invalidateExerciseLibrary: vi.fn(),
}));

import { useSplitEditStore, type CreateSplitFn } from '@/stores/splitEditStore';
import { blankSplitDraft } from '@/lib/splitDraftSeed';
import { customExercise } from '@/lib/customExercises';
import { readSplitDraft, writeSplitDraft, splitDraftKey } from '@/lib/splitDraftStorage';

const store = () => useSplitEditStore.getState();

function exercise(id: string, name = id): Exercise {
  return { id, name, muscle_group: 'chest', muscle_group_secondary: null, equipment: null, is_compound: false };
}

const split: Split = {
  id: 'split-1',
  user_id: 'user-1',
  name: 'Upper / Lower',
  description: null,
  days_per_week: 1,
  is_active: true,
  days: [{
    id: 'day-1', split_id: 'split-1', day_name: 'Upper', day_order: 0,
    exercises: [{
      id: 'row-1', split_day_id: 'day-1', exercise_id: 'bench', exercise: exercise('bench', 'Bench Press'),
      target_sets: 3, target_reps_min: 8, target_reps_max: 12, exercise_order: 0, notes: null, superset_group_id: null,
    }],
  }],
};

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  backend.library = [{ id: 'bench', name: 'Bench Press', muscle_group: 'chest' }];
  backend.inserts = [];
  backend.insertError = null;
  backend.rpc.mockReset().mockResolvedValue({ error: null });
  store().cancelEdit();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('creating a program from the shared editor', () => {
  it('creates a seeded draft through createSplit, active, with its order and set ranges', async () => {
    store().startNew(blankSplitDraft(2), { userId: 'user-1' });
    expect(store().isDirty).toBe(true);
    store().renameSplit('  My plan ');
    const [first, second] = store().draft!.days;
    store().addExercises(first.id, [exercise('bench', 'Bench Press')]);
    store().addExercises(second.id, [exercise('row', 'Row'), exercise('curl', 'Curl')]);
    const [row, curl] = store().draft!.days[1].exercises;
    store().updateExerciseTargets(second.id, row.id, { target_sets_min: 2, target_sets: 3, target_sets_max: 4 });
    store().moveExerciseTo(second.id, curl.id, row.id);

    const createSplit = vi.fn<CreateSplitFn>(async () => ({ id: 'created-1', name: 'My plan' }));
    const saved = await store().saveEdit({ createSplit });

    expect(saved).toEqual({ id: 'created-1', name: 'My plan', created: true });
    expect(backend.rpc).not.toHaveBeenCalled();
    expect(createSplit).toHaveBeenCalledOnce();
    const payload = createSplit.mock.calls[0][0];
    expect(payload).toMatchObject({ name: 'My plan', description: null, days_per_week: 2, is_active: true });
    expect(payload.days.map((day) => day.exercises.map((ex) => [ex.exercise_id, ex.exercise_order]))).toEqual([
      [['bench', 0]],
      [['curl', 0], ['row', 1]],
    ]);
    expect(payload.days[1].exercises[1].notes).toContain('[set-range]');
    expect(store().draft).toBeNull();
  });

  it('requires a name and keeps the draft when creation fails', async () => {
    store().startNew(blankSplitDraft(1), { userId: 'user-1' });
    const createSplit = vi.fn<CreateSplitFn>(async () => null);
    expect(await store().saveEdit({ createSplit })).toBeNull();
    expect(store().error).toMatch(/name/i);
    expect(createSplit).not.toHaveBeenCalled();

    store().renameSplit('Plan');
    expect(await store().saveEdit({ createSplit })).toBeNull();
    expect(store().error).toMatch(/could not create/i);
    expect(store().draft?.name).toBe('Plan');
    expect(store().saving).toBe(false);
  });
});

describe('custom exercises are inserted in one batch on save', () => {
  it('inserts each new name once, reuses library names and saves the real ids', async () => {
    store().startEdit(split, { userId: 'user-1' });
    const dayId = 'day-1';
    const library = backend.library as unknown as Exercise[];
    const landmine = customExercise('Landmine Press', 'shoulders', library);
    const again = customExercise('landmine  press', 'shoulders', library);
    const sissy = customExercise('Sissy Squat', 'quads', library);
    const bench = customExercise('bench press', 'chest', library);
    expect(bench.id).toBe('bench');
    expect(again.id).toBe(landmine.id);
    store().addExercises(dayId, [landmine, sissy]);
    store().addSupersetExercise(dayId, 'row-1', again);

    expect(await store().saveEdit()).toEqual({ id: 'split-1', name: 'Upper / Lower', created: false });
    expect(backend.inserts).toHaveLength(1);
    expect(backend.inserts[0].map((row) => [row.name, row.muscle_group])).toEqual([
      ['Landmine Press', 'shoulders'],
      ['Sissy Squat', 'quads'],
    ]);
    const days = backend.rpc.mock.calls[0][1].p_days as Array<{ exercises: Array<{ exercise_id: string }> }>;
    expect(days[0].exercises.map((ex) => ex.exercise_id)).toEqual(['bench', 'db-1', 'db-2']);
  });

  it('keeps the inserted ids in the draft so a retry after a failed save inserts nothing again', async () => {
    store().startEdit(split, { userId: 'user-1' });
    store().addExercises('day-1', [customExercise('Sissy Squat', 'quads', [])]);
    backend.rpc.mockResolvedValueOnce({ error: { message: 'offline' } });
    expect(await store().saveEdit()).toBeNull();
    expect(store().error).toBe('offline');
    expect(await store().saveEdit()).not.toBeNull();
    expect(backend.inserts).toHaveLength(1);
  });

  it('rereads the library when another device added the same name first', async () => {
    store().startEdit(split, { userId: 'user-1' });
    store().addExercises('day-1', [customExercise('Sissy Squat', 'quads', [])]);
    backend.insertError = { code: '23505', message: 'duplicate' };
    const { getExerciseLibrary } = await import('@/lib/exerciseLibrary');
    vi.mocked(getExerciseLibrary).mockImplementationOnce(async () => []).mockImplementationOnce(async () => [
      exercise('bench', 'Bench Press'), exercise('theirs', 'Sissy squat'),
    ]);
    expect(await store().saveEdit()).not.toBeNull();
    expect(backend.inserts).toHaveLength(1);
    const days = backend.rpc.mock.calls[0][1].p_days as Array<{ exercises: Array<{ exercise_id: string }> }>;
    expect(days[0].exercises.map((ex) => ex.exercise_id)).toEqual(['bench', 'theirs']);
  });
});

describe('device copy of the draft', () => {
  it('offers stored edits back when the program is opened again, and restores them', () => {
    store().startEdit(split, { userId: 'user-1' });
    store().renameSplit('Renamed elsewhere');
    writeSplitDraft('user-1', store().draft!, store().baseSignature);
    store().cancelEdit();

    store().startEdit(split, { userId: 'user-1' });
    expect(store().restorable?.draft.name).toBe('Renamed elsewhere');
    expect(store().draft?.name).toBe('Upper / Lower');
    store().restoreSaved();
    expect(store().draft?.name).toBe('Renamed elsewhere');
    expect(store().isDirty).toBe(true);
    expect(store().restorable).toBeNull();
  });

  it('keeps copies per account and forgets one on dismiss, discard or save', async () => {
    store().startEdit(split, { userId: 'user-1' });
    writeSplitDraft('user-1', store().draft!, null);
    store().startEdit(split, { userId: 'user-2' });
    expect(store().restorable).toBeNull();

    store().startEdit(split, { userId: 'user-1' });
    store().dismissRestore();
    expect(readSplitDraft('user-1', 'split-1')).toBeNull();

    writeSplitDraft('user-1', store().draft!, null);
    store().discardEdit();
    expect(readSplitDraft('user-1', 'split-1')).toBeNull();

    store().startEdit(split, { userId: 'user-1' });
    store().renameSplit('Saved name');
    writeSplitDraft('user-1', store().draft!, null);
    await store().saveEdit();
    expect(localStorage.getItem(splitDraftKey('user-1', 'split-1'))).toBeNull();
  });

  it('stores a new program under its own key and restores it as new', () => {
    store().startNew(blankSplitDraft(3), { userId: 'user-1' });
    writeSplitDraft('user-1', store().draft!, null);
    expect(readSplitDraft('user-1', 'new')?.draft.days).toHaveLength(3);
    store().cancelEdit();
    store().restoreDraft(readSplitDraft('user-1', 'new')!, { userId: 'user-1' });
    expect(store().draft?._isNew).toBe(true);
    store().discardEdit();
    expect(readSplitDraft('user-1', 'new')).toBeNull();
  });
});
