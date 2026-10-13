/**
 * Exercises typed in by hand while a program is edited. They live in the draft
 * with a placeholder id and reach the shared library only when the program is
 * saved, all in one insert.
 */
import type { DraftSplit } from '@/lib/splitDraft';
import type { Exercise, MuscleGroup } from '@/types';

const PENDING_PREFIX = 'pending-exercise-';

export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPendingExerciseId(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

/** A library match for the name when there is one, otherwise a placeholder to insert on save. */
export function customExercise(name: string, muscleGroup: MuscleGroup, library: readonly Exercise[]): Exercise {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const key = normalizeExerciseName(trimmed);
  const existing = library.find((exercise) => normalizeExerciseName(exercise.name) === key);
  if (existing) return existing;
  return {
    id: `${PENDING_PREFIX}${key.replace(/ /g, '-')}`,
    name: trimmed,
    muscle_group: muscleGroup,
    muscle_group_secondary: null,
    equipment: null,
    is_compound: false,
  };
}

export function pendingExercises(draft: DraftSplit): Exercise[] {
  const byId = new Map<string, Exercise>();
  for (const day of draft.days) {
    for (const entry of day.exercises) {
      if (isPendingExerciseId(entry.exercise_id) && !byId.has(entry.exercise_id)) byId.set(entry.exercise_id, entry.exercise);
    }
  }
  return Array.from(byId.values());
}

type InsertError = { code?: string; message: string } | null;

/** The slice of the Supabase client this needs; tests pass a fake. */
export interface ExerciseInsertClient {
  from(table: 'exercises'): {
    insert(rows: Array<Omit<Exercise, 'id'>>): {
      select(columns: string): PromiseLike<{ data: Array<{ id: string; name: string }> | null; error: InsertError }>;
    };
  };
}

/**
 * Gives every placeholder a real library id. Names already in the library
 * (compared loosely, like the picker) reuse that row; the rest go in a single
 * insert. If someone else added one of the names meanwhile, the unique name
 * rejects the insert, so the library is read again and only what is still
 * missing is inserted.
 */
export async function insertPendingExercises(
  pending: readonly Exercise[],
  { client, loadLibrary }: { client: ExerciseInsertClient; loadLibrary: () => Promise<Exercise[]> },
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (pending.length === 0) return resolved;

  const idsByName = new Map<string, string>();
  const remember = (rows: ReadonlyArray<{ id: string; name: string }>) => {
    for (const row of rows) idsByName.set(normalizeExerciseName(row.name), row.id);
  };

  const missing = () => {
    const seen = new Set<string>();
    return pending.filter((exercise) => {
      const key = normalizeExerciseName(exercise.name);
      if (idsByName.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const insert = async (rows: Exercise[]) => {
    const { data, error } = await client
      .from('exercises')
      .insert(rows.map(({ name, muscle_group, muscle_group_secondary, equipment, is_compound }) => ({
        name, muscle_group, muscle_group_secondary, equipment, is_compound,
      })))
      .select('id, name');
    if (!error && data) remember(data);
    return error;
  };

  remember(await loadLibrary());
  let toInsert = missing();
  if (toInsert.length > 0) {
    const error = await insert(toInsert);
    if (error?.code === '23505') {
      remember(await loadLibrary());
      toInsert = missing();
      if (toInsert.length > 0 && await insert(toInsert)) {
        throw new Error(`Could not create exercise: ${toInsert[0].name}`);
      }
    } else if (error) {
      throw new Error(`Could not create exercise: ${toInsert[0].name}`);
    }
  }

  for (const exercise of pending) {
    const id = idsByName.get(normalizeExerciseName(exercise.name));
    if (!id) throw new Error(`Could not create exercise: ${exercise.name}`);
    resolved.set(exercise.id, id);
  }
  return resolved;
}

/** The draft with placeholder exercise ids replaced by the saved ones. */
export function applyExerciseIds(draft: DraftSplit, ids: ReadonlyMap<string, string>): DraftSplit {
  if (ids.size === 0) return draft;
  return {
    ...draft,
    days: draft.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((entry) => {
        const id = ids.get(entry.exercise_id);
        return id ? { ...entry, exercise_id: id, exercise: { ...entry.exercise, id } } : entry;
      }),
    })),
  };
}
