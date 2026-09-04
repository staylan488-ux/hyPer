import { supabase } from '@/lib/supabase';
import type { WorkoutSet } from '@/types';

export const SET_SAVE_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);

class SetSaveTimeoutError extends Error {
  constructor() {
    super('The set save timed out.');
  }
}

// Bound the whole operation, including the SDK's wait before fetch starts.
// Aborting fetch alone cannot release a caller waiting on that earlier work.
async function saveAttempt<T>(request: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new SetSaveTimeoutError());
      controller.abort();
    }, SET_SAVE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([request(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function saveWorkoutSet(
  target: Pick<WorkoutSet, 'id' | 'workout_id'>,
  values: Pick<WorkoutSet, 'weight' | 'reps' | 'rpe'>,
): Promise<WorkoutSet> {
  // Retry the same existing row with the same payload and completion time.
  // A lost response may mean the first write already succeeded.
  const updates = { ...values, completed: true, completed_at: new Date().toISOString() };

  for (let attempt = 1; ; attempt += 1) {
    let result;
    try {
      result = await saveAttempt((signal) => supabase
        .from('sets')
        .update(updates)
        .eq('workout_id', target.workout_id)
        .eq('id', target.id)
        .select()
        .abortSignal(signal)
        .single());
    } catch (error) {
      if (attempt < MAX_ATTEMPTS && (error instanceof SetSaveTimeoutError || error instanceof TypeError)) {
        continue;
      }
      throw error;
    }

    if (result.error) {
      if (attempt < MAX_ATTEMPTS && RETRYABLE_STATUSES.has(result.status)) continue;
      throw result.error;
    }
    if (!result.data) throw new Error('The saved set was not returned.');
    return result.data as WorkoutSet;
  }
}
