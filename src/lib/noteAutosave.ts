// Debounced movement-note autosave shared by the Workout and History pages.
// Only the timers and the "already saved" comparison live here; each page
// supplies its own save function and keeps its own note state and UI.
//
// A save always goes to the workout id captured when it was scheduled, and its
// payload is built synchronously when the save fires, so a flush during a
// workout change, month change or unmount still saves what the user typed.

import type { Workout, WorkoutDayPlan } from '@/types';

export type NoteSaveResult = 'saved' | 'failed' | 'unchanged' | 'skipped';

/** Builds the serialized notes for a workout, or null when there is nothing to save. */
export type BuildNotesPayload = () => string | null;

export interface NoteAutosaverOptions {
  debounceMs: number;
  /** Persists the payload; resolves true on success. */
  save: (workoutId: string, payload: string, exerciseId: string) => Promise<boolean>;
  /** Runs synchronously on every flush, whether or not the payload changed. */
  onFlush?: (workoutId: string, exerciseId: string) => Promise<unknown> | void;
}

export interface NoteAutosaver {
  /** (Re)starts the debounce for one exercise's note. */
  schedule: (workoutId: string, exerciseId: string, buildPayload: BuildNotesPayload) => void;
  /** Cancels any pending debounce for the note and saves right away (blur). */
  saveNow: (workoutId: string, exerciseId: string, buildPayload: BuildNotesPayload) => Promise<NoteSaveResult>;
  /** Drops a pending save without sending it. */
  cancel: (workoutId: string, exerciseId: string) => void;
  /** Sends every pending save now; resolves once all in-flight saves settle. */
  flushAll: () => Promise<void>;
  /** Records what the server already holds so an unchanged payload is not re-sent. */
  markPersisted: (workoutId: string, payload: string) => void;
}

interface PendingSave {
  workoutId: string;
  exerciseId: string;
  buildPayload: BuildNotesPayload;
  timer: ReturnType<typeof setTimeout>;
}

export function createNoteAutosaver({ debounceMs, save, onFlush }: NoteAutosaverOptions): NoteAutosaver {
  const pending = new Map<string, PendingSave>();
  const lastPersisted = new Map<string, string>();
  const inFlight = new Set<Promise<unknown>>();

  const keyOf = (workoutId: string, exerciseId: string) => `${workoutId}:${exerciseId}`;

  const track = (work: Promise<unknown>) => {
    const settled = work.then(() => undefined, () => undefined);
    inFlight.add(settled);
    void settled.then(() => inFlight.delete(settled));
  };

  const persist = async (workoutId: string, exerciseId: string, payload: string | null): Promise<NoteSaveResult> => {
    if (payload === null) return 'skipped';
    if (lastPersisted.get(workoutId) === payload) return 'unchanged';

    let ok = false;
    try {
      ok = await save(workoutId, payload, exerciseId);
    } catch (error) {
      console.error('Error saving movement note:', error);
    }

    // a failed save leaves lastPersisted alone so the next edit or blur retries
    if (ok) lastPersisted.set(workoutId, payload);
    return ok ? 'saved' : 'failed';
  };

  const run = (workoutId: string, exerciseId: string, buildPayload: BuildNotesPayload): Promise<NoteSaveResult> => {
    const payload = buildPayload();

    if (onFlush) {
      try {
        const extra = onFlush(workoutId, exerciseId);
        if (extra) track(extra);
      } catch (error) {
        console.error('Error flushing movement note:', error);
      }
    }

    const result = persist(workoutId, exerciseId, payload);
    track(result);
    return result;
  };

  const cancel = (workoutId: string, exerciseId: string) => {
    const key = keyOf(workoutId, exerciseId);
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(key);
  };

  return {
    schedule(workoutId, exerciseId, buildPayload) {
      cancel(workoutId, exerciseId);
      const key = keyOf(workoutId, exerciseId);
      const timer = setTimeout(() => {
        pending.delete(key);
        void run(workoutId, exerciseId, buildPayload);
      }, debounceMs);
      pending.set(key, { workoutId, exerciseId, buildPayload, timer });
    },

    saveNow(workoutId, exerciseId, buildPayload) {
      cancel(workoutId, exerciseId);
      return run(workoutId, exerciseId, buildPayload);
    },

    cancel,

    async flushAll() {
      const entries = [...pending.values()];
      pending.clear();
      entries.forEach((entry) => {
        clearTimeout(entry.timer);
        void run(entry.workoutId, entry.exerciseId, entry.buildPayload);
      });
      await Promise.all([...inFlight]);
    },

    markPersisted(workoutId, payload) {
      lastPersisted.set(workoutId, payload);
    },
  };
}

interface PlanNoteContext {
  workoutId: string;
  exerciseId: string;
  /** The on-screen notes, or null when they belong to another workout. */
  movementNotes: Record<string, string> | null;
  workout: Pick<Workout, 'id' | 'split_day_id'> | null;
  plan: Pick<WorkoutDayPlan, 'workout_id' | 'items'> | null;
}

// A flexible session also keeps each note on its plan item, which templates and
// History read. Returns the trimmed note to write there ('' clears it), or null
// when there is nothing to write: a split workout, another workout's plan, a
// note the user never touched, or a plan item that already matches.
export function flexiblePlanNoteToWrite({ workoutId, exerciseId, movementNotes, workout, plan }: PlanNoteContext): string | null {
  if (!movementNotes || !(exerciseId in movementNotes)) return null;
  if (workout?.id !== workoutId || workout.split_day_id !== null) return null;
  if (plan?.workout_id !== workoutId) return null;

  const item = plan.items.find((entry) => entry.exercise_id === exerciseId);
  if (!item) return null;

  const nextNote = movementNotes[exerciseId].trim();
  return (item.notes ?? '').trim() === nextNote ? null : nextNote;
}
