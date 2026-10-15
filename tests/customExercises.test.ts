import { describe, expect, it, vi } from 'vitest';
import { customExercise, insertPendingExercises, isPendingExerciseId, type ExerciseInsertClient } from '@/lib/customExercises';
import type { Exercise } from '@/types';

const exercise = (id: string, name: string): Exercise => ({
  id, name, muscle_group: 'chest', muscle_group_secondary: null, equipment: null, is_compound: false,
});

function fakeClient(results: Array<{ code?: string; message: string } | null>) {
  const calls: Array<Array<{ name: string }>> = [];
  const client: ExerciseInsertClient = {
    from: () => ({
      insert: (rows) => ({
        select: async () => {
          calls.push(rows);
          const error = results.shift() ?? null;
          return error ? { data: null, error } : { data: rows.map((row) => ({ id: `id:${row.name}`, name: row.name })), error: null };
        },
      }),
    }),
  };
  return { client, calls };
}

describe('custom exercises', () => {
  it('reuses a library row for a typed name and otherwise makes a placeholder', () => {
    const library = [exercise('bench', 'Bench Press')];
    expect(customExercise('  bench   PRESS ', 'back', library).id).toBe('bench');
    const pending = customExercise('Zercher  Squat', 'quads', library);
    expect(isPendingExerciseId(pending.id)).toBe(true);
    expect(pending).toMatchObject({ name: 'Zercher Squat', muscle_group: 'quads' });
  });

  it('inserts every missing name in one call, once per name', async () => {
    const { client, calls } = fakeClient([]);
    const a = customExercise('Zercher Squat', 'quads', []);
    const b = customExercise('Jefferson Curl', 'hamstrings', []);
    const existing = customExercise('Bench Press', 'chest', []);
    const ids = await insertPendingExercises([a, b, { ...a }, existing], {
      client, loadLibrary: async () => [exercise('bench', 'bench press')],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].map((row) => row.name)).toEqual(['Zercher Squat', 'Jefferson Curl']);
    expect(calls[0][0]).not.toHaveProperty('id');
    expect(ids.get(a.id)).toBe('id:Zercher Squat');
    expect(ids.get(b.id)).toBe('id:Jefferson Curl');
    expect(ids.get(existing.id)).toBe('bench');
  });

  it('makes no call when nothing is pending', async () => {
    const loadLibrary = vi.fn(async () => []);
    const { client, calls } = fakeClient([]);
    expect((await insertPendingExercises([], { client, loadLibrary })).size).toBe(0);
    expect(loadLibrary).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('after a name conflict inserts only what is still missing, and fails loudly otherwise', async () => {
    const a = customExercise('Zercher Squat', 'quads', []);
    const b = customExercise('Jefferson Curl', 'hamstrings', []);
    const conflict = fakeClient([{ code: '23505', message: 'duplicate' }]);
    const libraries = [[], [exercise('theirs', 'zercher squat')]];
    const ids = await insertPendingExercises([a, b], { client: conflict.client, loadLibrary: async () => libraries.shift() ?? [] });
    expect(conflict.calls.map((rows) => rows.map((row) => row.name))).toEqual([['Zercher Squat', 'Jefferson Curl'], ['Jefferson Curl']]);
    expect(ids.get(a.id)).toBe('theirs');

    const failing = fakeClient([{ message: 'permission denied' }]);
    await expect(insertPendingExercises([a], { client: failing.client, loadLibrary: async () => [] }))
      .rejects.toThrow('Could not create exercise: Zercher Squat');
  });
});
