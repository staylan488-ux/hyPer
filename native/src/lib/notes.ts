// Movement notes on the live workout, with the web Train page's rules. The
// shared autosaver (src/lib/noteAutosave) saves after a 1.2 s pause, at once
// when the editor closes or the app goes to the background, keeps one write
// queue per workout (so a swap lands after the notes typed before it), and
// keeps a failed note to send again with the next edit or flush.
import { AppState } from 'react-native';
import { create } from 'zustand';

import { captureAccountScope } from '@/lib/accountScope';
import {
  createNoteAutosaver,
  flexiblePlanNoteToWrite,
  mergeQueuedMovementNotePayload,
  remainingMovementNoteDrafts,
  type NoteAutosaver,
} from '@/lib/noteAutosave';
import { parseWorkoutNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';
import { useAppStore } from '@/stores/appStore';

/** The web app's limit for one movement note. */
export const NOTE_LIMIT = 200;
const SAVE_PAUSE_MS = 1200;

type NoteStatus = 'saving' | 'saved' | 'failed';

type NotesState = {
  workoutId: string | null;
  /** Edits not yet confirmed saved, by exercise id; '' clears a note. */
  drafts: Record<string, string>;
  /** The workout's notes as last seen, for saves that fire after it ends. */
  base: string | null;
  status: Record<string, NoteStatus>;
};

export const useNotesStore = create<NotesState>(() => ({ workoutId: null, drafts: {}, base: null, status: {} }));

const setStatus = (workoutId: string, exerciseId: string, status: NoteStatus | null) =>
  useNotesStore.setState((state) => {
    if (state.workoutId !== workoutId) return state;
    const next = { ...state.status };
    if (status) next[exerciseId] = status;
    else delete next[exerciseId];
    return { status: next };
  });

/** The workout's saved notes: the store's copy while it is live, else the last one seen. */
function savedNotes(workoutId: string): string | null {
  const workout = useAppStore.getState().currentWorkout;
  return workout?.id === workoutId ? workout.notes : useNotesStore.getState().base;
}

/** Every movement note of the workout as on screen: saved notes with unsaved edits on top. */
function onScreenNotes(workoutId: string): Record<string, string> | null {
  const { workoutId: draftsFor, drafts } = useNotesStore.getState();
  if (draftsFor !== workoutId) return null;
  return { ...parseWorkoutNotes(savedNotes(workoutId)).movementNotes, ...drafts };
}

// Built when the save fires, so a flush after the workout ends still sends
// what was typed; nothing once the notes belong to another workout.
const buildPayload = (workoutId: string) => () => {
  const notes = onScreenNotes(workoutId);
  if (!notes) return null;
  return serializeWorkoutNotes(notes, parseWorkoutNotes(savedNotes(workoutId)).legacyNote ?? undefined);
};

let current: { saver: NoteAutosaver; isCurrent: () => boolean } | null = null;

/** One saver per signed-in account, like the web page's. */
function noteSaver(): NoteAutosaver {
  if (current?.isCurrent()) return current.saver;
  const isCurrent = captureAccountScope();
  const saver = createNoteAutosaver({
    debounceMs: SAVE_PAUSE_MS,
    mergePayload: mergeQueuedMovementNotePayload,
    isCurrent,
    save: async (workoutId, payload, exerciseId) => {
      setStatus(workoutId, exerciseId, 'saving');
      try {
        await useAppStore.getState().updateWorkoutNotes(workoutId, payload);
      } catch {
        return false;
      }
      useNotesStore.setState((state) => (state.workoutId === workoutId ? { base: payload } : state));
      setStatus(workoutId, exerciseId, 'saved');
      setTimeout(() => {
        if (useNotesStore.getState().status[exerciseId] === 'saved') setStatus(workoutId, exerciseId, null);
      }, SAVE_PAUSE_MS);
      return true;
    },
    // A flexible session also keeps each note on its plan item, which
    // templates and History read (the web page does the same).
    prepareFlush: (workoutId, exerciseId) => {
      const store = useAppStore.getState();
      const nextNote = flexiblePlanNoteToWrite({
        workoutId,
        exerciseId,
        movementNotes: onScreenNotes(workoutId),
        workout: store.currentWorkout,
        plan: store.currentWorkoutDayPlan,
        force: exerciseId in useNotesStore.getState().drafts,
      });
      if (nextNote === null) return;
      const isCurrentAccount = captureAccountScope();
      return async () => {
        if (!isCurrentAccount()) throw new Error('The signed-in account changed.');
        const latest = useAppStore.getState();
        const plan = latest.currentWorkoutDayPlan?.workout_id === workoutId
          ? latest.currentWorkoutDayPlan
          : await latest.fetchWorkoutDayPlanByWorkoutId(workoutId, { throwOnError: true });
        if (!isCurrentAccount()) throw new Error('The signed-in account changed.');
        if (!plan) throw new Error('Could not load the workout notes. Try again.');
        await latest.updateWorkoutDayPlanItems(
          workoutId,
          plan.items.map((item) => (item.exercise_id === exerciseId ? { ...item, notes: nextNote } : item)),
          plan,
        );
      };
    },
    onSaved: (workoutId, payload, exerciseId) => {
      useNotesStore.setState((state) => {
        if (state.workoutId !== workoutId || !(exerciseId in state.drafts)) return state;
        const remaining = remainingMovementNoteDrafts(
          { [exerciseId]: state.drafts[exerciseId] },
          parseWorkoutNotes(payload).movementNotes,
        );
        if (exerciseId in remaining) return state;
        const drafts = { ...state.drafts };
        delete drafts[exerciseId];
        return { drafts };
      });
    },
    onFailure: (workoutId, exerciseId) => setStatus(workoutId, exerciseId, 'failed'),
  });
  current = { saver, isCurrent };
  return saver;
}

/** Records a note edit and saves it after a pause. */
export function editNote(workoutId: string, exerciseId: string, text: string) {
  const value = text.slice(0, NOTE_LIMIT);
  useNotesStore.setState((state) => {
    const sameWorkout = state.workoutId === workoutId;
    return {
      workoutId,
      drafts: { ...(sameWorkout ? state.drafts : {}), [exerciseId]: value },
      base: sameWorkout ? state.base : savedNotes(workoutId),
      status: sameWorkout ? state.status : {},
    };
  });
  noteSaver().schedule(workoutId, exerciseId, buildPayload(workoutId));
}

/** Saves a note now (the editor closed). */
export function saveNoteNow(workoutId: string, exerciseId: string) {
  if (useNotesStore.getState().workoutId !== workoutId) return;
  void noteSaver().saveNow(workoutId, exerciseId, buildPayload(workoutId));
}

/** Sends every pending note; false when one could not be saved. */
export function flushNotes(): Promise<boolean> {
  return noteSaver().flushAll();
}

/** Runs a workout change after the notes typed before it have saved. */
export function afterNotes<T>(workoutId: string, write: () => Promise<T>): Promise<T> {
  return noteSaver().runAfterFlush(workoutId, write);
}

/** A movement's note as the person sees it, and how its save is going. */
export function useMovementNote(workoutId: string, exerciseId: string, saved: string) {
  const draft = useNotesStore((state) => (state.workoutId === workoutId ? state.drafts[exerciseId] : undefined));
  const status = useNotesStore((state) => (state.workoutId === workoutId ? state.status[exerciseId] : undefined));
  return { text: draft ?? saved, status: status ?? null };
}

// Going to the background with the keyboard up still saves the note.
AppState.addEventListener('change', (next) => {
  if (next !== 'active' && current?.isCurrent()) void current.saver.flushAll();
});
