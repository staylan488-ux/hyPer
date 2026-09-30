/**
 * The exercise library, kept in memory for the session.
 *
 * The table is a shared seeded list that rarely changes, so the picker can show
 * the last good copy straight away (including offline) and refresh it in the
 * background. Failures are never cached: the next call simply tries again.
 */
import { supabase } from '@/lib/supabase';
import type { Exercise } from '@/types';

let cached: Exercise[] | null = null;
let inflight: Promise<Exercise[]> | null = null;
// Bumped on invalidate so a request that started earlier cannot refill the cache.
let generation = 0;

/** Last good rows, or null when nothing has loaded yet. */
export function peekExerciseLibrary(): Exercise[] | null {
  return cached;
}

/**
 * Resolves the library ordered by name. Uses the cached rows unless `force`
 * is set; concurrent calls share one request.
 */
export function getExerciseLibrary({ force = false }: { force?: boolean } = {}): Promise<Exercise[]> {
  if (!force && cached) return Promise.resolve(cached);
  if (inflight) return inflight;

  const requestGeneration = generation;
  const request = (async () => {
    const { data, error } = await supabase.from('exercises').select('*').order('name');
    if (error) throw error;
    if (!data) throw new Error('No exercises returned');

    const rows = data as Exercise[];
    // an empty answer is not worth keeping over a real list
    if (rows.length > 0 && requestGeneration === generation) {
      cached = rows;
    }
    return rows;
  })();

  inflight = request;
  const clear = () => {
    if (inflight === request) inflight = null;
  };
  request.then(clear, clear);
  return request;
}

/** Drops the cached rows, e.g. after exercises were added or on sign-out. */
export function invalidateExerciseLibrary(): void {
  cached = null;
  inflight = null;
  generation += 1;
}
