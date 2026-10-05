// Debounced movement-note autosave shared by the Workout and History pages.
// Pages supply their save functions and keep their own note state and UI.
// Whole-workout writes share a queue across navigation, including plan patches.
//
// A save always goes to the workout id captured when it was scheduled, and its
// payload is built synchronously when the save fires, so a flush during a
// workout change, month change or unmount still saves what the user typed.

import type { Workout, WorkoutDayPlan } from '@/types';
import { parseWorkoutNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';

// A page can unmount while its save is pending. The next page/saver shares
// the same workout queue, including plan edits, until those writes settle.
const workoutQueues = new Map<string, Promise<unknown>>();
const queuedPayloads = new Map<string, string>();

function queueWorkoutWrite<T>(workoutId: string, write: () => Promise<T>): Promise<T> {
  const previous = workoutQueues.get(workoutId);
  const result = previous ? previous.then(write, write) : write();
  const settled = result.then(() => undefined, () => undefined);
  workoutQueues.set(workoutId, settled);
  void settled.then(() => {
    if (workoutQueues.get(workoutId) === settled) {
      workoutQueues.delete(workoutId);
      queuedPayloads.delete(workoutId);
    }
  });
  return result;
}

export type NoteSaveResult = 'saved' | 'failed' | 'unchanged' | 'skipped';

/** Builds the serialized notes for a workout, or null when there is nothing to save. */
export type BuildNotesPayload = () => string | null;

export interface NoteAutosaverOptions {
  debounceMs: number;
  /** Persists the payload; resolves true on success. */
  save: (workoutId: string, payload: string, exerciseId: string) => Promise<boolean>;
  /** Capture any extra write now; execute it in the workout's save queue. */
  prepareFlush?: (workoutId: string, exerciseId: string) => (() => Promise<unknown>) | void;
  onSaved?: (workoutId: string, payload: string, exerciseId: string) => void;
  onFailure?: (workoutId: string, exerciseId: string) => void;
  /** Merge a newly edited field with another saver's still-pending payload. */
  mergePayload?: (previous: string, next: string, exerciseId: string) => string;
  /** Captured when the owning account/page is established, before queuing. */
  isCurrent?: () => boolean;
}

export interface NoteAutosaver {
  /** (Re)starts the debounce for one exercise's note. */
  schedule: (workoutId: string, exerciseId: string, buildPayload: BuildNotesPayload) => void;
  /** Cancels any pending debounce for the note and saves right away (blur). */
  saveNow: (workoutId: string, exerciseId: string, buildPayload: BuildNotesPayload) => Promise<NoteSaveResult>;
  /** Drops a pending save without sending it. */
  cancel: (workoutId: string, exerciseId: string) => void;
  /** Sends every pending save now; resolves once all in-flight saves settle. */
  flushAll: () => Promise<boolean>;
  /** Serialize a plan edit with notes typed before or during that edit. */
  runAfterFlush: <T>(workoutId: string, write: () => Promise<T>) => Promise<T>;
  /** Records what the server already holds so an unchanged payload is not re-sent. */
  markPersisted: (workoutId: string, payload: string) => void;
}

interface PendingSave {
  workoutId: string;
  exerciseId: string;
  buildPayload: BuildNotesPayload;
  timer: ReturnType<typeof setTimeout>;
}

interface CapturedSave {
  workoutId: string;
  exerciseId: string;
  payload: string | null;
  extra?: () => Promise<unknown>;
}

export function createNoteAutosaver({ debounceMs, save, prepareFlush, onSaved, onFailure, mergePayload, isCurrent = () => true }: NoteAutosaverOptions): NoteAutosaver {
  const pending = new Map<string, PendingSave>();
  const lastPersisted = new Map<string, string>();
  const inFlight = new Set<Promise<NoteSaveResult>>();
  const failures = new Map<string, CapturedSave>();
  const latest = new Map<string, CapturedSave>();
  const latestPayload = new Map<string, string | null>();

  const keyOf = (workoutId: string, exerciseId: string) => `${workoutId}:${exerciseId}`;

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

  const enqueue = (task: CapturedSave): Promise<NoteSaveResult> => {
    const { workoutId, exerciseId, payload, extra } = task;
    const key = keyOf(workoutId, exerciseId);
    latest.set(key, task);
    failures.delete(key);
    const execute = async (): Promise<NoteSaveResult> => {
      let result: NoteSaveResult;
      try {
        if (!isCurrent()) return 'skipped';
        await extra?.();
        if (!isCurrent()) return 'skipped';
        const nextPayload = queuedPayloads.get(workoutId) ?? latestPayload.get(workoutId) ?? payload;
        result = await persist(workoutId, exerciseId, nextPayload);
        if (nextPayload !== null && (result === 'saved' || result === 'unchanged')) onSaved?.(workoutId, nextPayload, exerciseId);
      } catch (error) {
        console.error('Error flushing movement note:', error);
        result = 'failed';
      }
      if (result === 'failed') {
        if (latest.get(key) === task) failures.set(key, task);
        onFailure?.(workoutId, exerciseId);
      } else {
        failures.delete(key);
      }
      return result;
    };
    const result = queueWorkoutWrite(workoutId, execute);
    inFlight.add(result);
    void result.then(() => {
      inFlight.delete(result);
    });
    return result;
  };

  const run = (workoutId: string, exerciseId: string, buildPayload: BuildNotesPayload): Promise<NoteSaveResult> => {
    // Capture before a page/workout switch replaces its refs. Writes for this
    // workout run in order, including plan-note patches, so an old whole-row
    // payload can never land after a newer one.
    const captured = buildPayload();
    if (captured === null) return Promise.resolve('skipped');
    const previous = queuedPayloads.get(workoutId);
    const payload = previous !== undefined && mergePayload ? mergePayload(previous, captured, exerciseId) : captured;
    queuedPayloads.set(workoutId, payload);
    latestPayload.set(workoutId, payload);
    const extra = prepareFlush?.(workoutId, exerciseId) || undefined;
    return enqueue({ workoutId, exerciseId, payload, extra });
  };

  const cancel = (workoutId: string, exerciseId: string) => {
    const key = keyOf(workoutId, exerciseId);
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(key);
  };

  const flushAll = async () => {
    const entries = [...pending.values()];
    const pendingKeys = new Set(entries.map((entry) => keyOf(entry.workoutId, entry.exerciseId)));
    for (const [key, task] of failures) {
      if (!pendingKeys.has(key)) void enqueue(task);
    }
    pending.clear();
    entries.forEach((entry) => {
      clearTimeout(entry.timer);
      void run(entry.workoutId, entry.exerciseId, entry.buildPayload);
    });
    while (inFlight.size > 0) await Promise.all([...inFlight]);
    return failures.size === 0;
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

    flushAll,

    async runAfterFlush(workoutId, write) {
      if (!await flushAll()) throw new Error('Note not saved. Check your connection and retry.');
      return queueWorkoutWrite(workoutId, async () => {
        if (!isCurrent()) throw new Error('The signed-in account changed.');
        return write();
      });
    },

    markPersisted(workoutId, payload) {
      lastPersisted.set(workoutId, payload);
    },
  };
}

export function mergeQueuedMovementNotePayload(previous: string, next: string, exerciseId: string): string {
  const before = parseWorkoutNotes(previous);
  const after = parseWorkoutNotes(next);
  return serializeWorkoutNotes({
    ...before.movementNotes,
    [exerciseId]: after.movementNotes[exerciseId] ?? '',
  }, after.legacyNote);
}

/** A background refresh may update untouched fields, never an unsaved draft. */
export function mergeMovementNoteDrafts(saved: Record<string, string>, drafts: Record<string, string>): Record<string, string> {
  return { ...saved, ...drafts };
}

/** A slow save only acknowledges values it actually sent; later typing stays dirty. */
export function remainingMovementNoteDrafts(drafts: Record<string, string>, saved: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(drafts).filter(([id, value]) => value.trim() !== (saved[id] ?? '')));
}

interface PlanNoteContext {
  workoutId: string;
  exerciseId: string;
  /** The on-screen notes, or null when they belong to another workout. */
  movementNotes: Record<string, string> | null;
  workout: Pick<Workout, 'id' | 'split_day_id'> | null;
  plan: Pick<WorkoutDayPlan, 'workout_id' | 'items'> | null;
  /** A typed revert must follow an older queued write even if the store matches. */
  force?: boolean;
}

// A flexible session also keeps each note on its plan item, which templates and
// History read. Returns the trimmed note to write there ('' clears it), or null
// when there is nothing to write: a split workout, another workout's plan, a
// note the user never touched, or a plan item that already matches.
export function flexiblePlanNoteToWrite({ workoutId, exerciseId, movementNotes, workout, plan, force = false }: PlanNoteContext): string | null {
  if (!movementNotes || !(exerciseId in movementNotes)) return null;
  if (workout?.id !== workoutId || workout.split_day_id !== null) return null;
  if (plan?.workout_id !== workoutId) return null;

  const item = plan.items.find((entry) => entry.exercise_id === exerciseId);
  if (!item) return null;

  const nextNote = movementNotes[exerciseId].trim();
  return !force && (item.notes ?? '').trim() === nextNote ? null : nextNote;
}
