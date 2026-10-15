import { create } from 'zustand';
import { normalizeSetRange, serializeSetRangeNotes } from '@/lib/setRangeNotes';
import { supabase } from '@/lib/supabase';
import { getExerciseLibrary, invalidateExerciseLibrary } from '@/lib/exerciseLibrary';
import { applyExerciseIds, insertPendingExercises, pendingExercises, type ExerciseInsertClient } from '@/lib/customExercises';
import {
  createSupersetGroupId,
  fixDayOrders,
  moveDayTo,
  moveExercise,
  moveExerciseBlock,
  newDraftDay,
  newDraftExercise,
  splitToDraft,
  type DraftExercise,
  type DraftSplit,
} from '@/lib/splitDraft';
import {
  clearSplitDraft,
  readSplitDraft,
  splitDraftId,
  splitSignature,
  type StoredSplitDraft,
} from '@/lib/splitDraftStorage';
import type { Split, Exercise, MuscleGroup } from '@/types';

export type { DraftDay, DraftExercise, DraftSplit } from '@/lib/splitDraft';
export { moveExercise, moveExerciseBlock } from '@/lib/splitDraft';

/** The fields program creation needs; `useAppStore.getState().createSplit` in the app. */
export type CreateSplitFn = (split: {
  name: string;
  description: string | null;
  days_per_week: number;
  is_active: boolean;
  days: Array<{
    day_name: string;
    day_order: number;
    exercises: Array<{
      exercise_id: string;
      target_sets: number;
      target_reps_min: number;
      target_reps_max: number;
      exercise_order: number;
      notes: string | null;
      superset_group_id: string | null;
    }>;
  }>;
}) => Promise<{ id: string; name: string } | null>;

export interface SavedSplit {
  id: string;
  name: string;
  created: boolean;
}

const CREATE_FAILED_MESSAGE = 'Could not create the program. Check your connection and try again.';

// ═══════════════════════════════════
// STORE STATE
// ═══════════════════════════════════

interface SplitEditState {
  draft: DraftSplit | null;
  isDirty: boolean;
  saving: boolean;
  error: string | null;
  /** The draft before the latest removal, until the next edit. */
  undo: { label: string; draft: DraftSplit } | null;
  /** Account whose device copy of the draft is kept; null keeps none. */
  storageScope: string | null;
  /** Fingerprint of the saved program the edit started from. */
  baseSignature: string | null;
  /** Unsaved edits found on this device when the edit opened, until restored or dismissed. */
  restorable: StoredSplitDraft | null;

  // Lifecycle
  startEdit: (split: Split, options?: { userId?: string | null }) => void;
  /** Opens a seeded, not yet created program in the editor. */
  startNew: (draft: DraftSplit, options?: { userId?: string | null }) => void;
  /** Reopens a stored device copy. */
  restoreDraft: (stored: StoredSplitDraft, options?: { userId?: string | null }) => void;
  restoreSaved: () => void;
  dismissRestore: () => void;
  cancelEdit: () => void;
  /** Closes the edit and forgets its device copy. */
  discardEdit: () => void;
  saveEdit: (options?: { createSplit?: CreateSplitFn }) => Promise<SavedSplit | null>;
  undoRemoval: () => void;
  dismissUndo: () => void;

  // Split-level
  renameSplit: (name: string) => void;
  updateDescription: (description: string) => void;

  // Day-level
  renameDay: (dayId: string, name: string) => void;
  reorderDays: (dayId: string, direction: -1 | 1) => void;
  moveDay: (dayId: string, overDayId: string) => void;
  addDay: (dayName: string) => void;
  removeDay: (dayId: string) => void;

  // Exercise-level
  reorderExercise: (dayId: string, exerciseId: string, direction: -1 | 1) => void;
  moveExerciseTo: (dayId: string, exerciseId: string, overExerciseId: string) => void;
  updateExerciseTargets: (dayId: string, exerciseId: string, updates: Partial<Pick<DraftExercise, 'target_sets' | 'target_sets_min' | 'target_sets_max' | 'target_reps_min' | 'target_reps_max'>>) => void;
  swapExercise: (dayId: string, exerciseId: string, newExercise: Exercise) => void;
  addExercise: (dayId: string, exercise: Exercise) => void;
  addExercises: (dayId: string, exercises: Exercise[]) => void;
  addSupersetExercise: (dayId: string, sourceExerciseId: string, exercise: Exercise) => void;
  clearExerciseSuperset: (dayId: string, exerciseId: string) => void;
  removeExercise: (dayId: string, exerciseId: string) => void;
  updateExerciseNotes: (dayId: string, exerciseId: string, notes: string | null) => void;
}

// ═══════════════════════════════════
// HELPERS
// ═══════════════════════════════════

function inferSecondaryMuscleGroup(primary: MuscleGroup): MuscleGroup | null {
  if (primary === 'chest') return 'triceps';
  if (primary === 'triceps') return 'chest';
  if (primary === 'back') return 'biceps';
  if (primary === 'biceps') return 'back';
  if (primary === 'quads') return 'hamstrings';
  if (primary === 'hamstrings') return 'quads';
  if (primary === 'shoulders') return 'triceps';
  return null;
}

const TARGET_FIELDS = [
  'target_sets_min',
  'target_sets',
  'target_sets_max',
  'target_reps_min',
  'target_reps_max',
] as const;

const CLOSED: Pick<SplitEditState, 'draft' | 'isDirty' | 'saving' | 'error' | 'undo' | 'storageScope' | 'baseSignature' | 'restorable'> = {
  draft: null,
  isDirty: false,
  saving: false,
  error: null,
  undo: null,
  storageScope: null,
  baseSignature: null,
  restorable: null,
};

function updateDraft(state: SplitEditState, updater: (draft: DraftSplit) => DraftSplit): Partial<SplitEditState> {
  if (!state.draft) return {};
  const draft = updater(state.draft);
  if (draft === state.draft) return {};
  return { draft, isDirty: true, error: null, undo: null, restorable: null };
}

/** Like updateDraft, but keeps the previous draft so the removal can be undone. */
function removeFromDraft(
  state: SplitEditState,
  label: string,
  updater: (draft: DraftSplit) => DraftSplit
): Partial<SplitEditState> {
  if (!state.draft) return {};
  const update = updateDraft(state, updater);
  return update.draft ? { ...update, undo: { label, draft: state.draft } } : {};
}

function updateDay(draft: DraftSplit, dayId: string, updater: (exercises: DraftExercise[]) => DraftExercise[]): DraftSplit {
  let changed = false;
  const days = draft.days.map((day) => {
    if (day.id !== dayId) return day;
    const exercises = updater(day.exercises);
    if (exercises === day.exercises) return day;
    changed = true;
    return { ...day, exercises };
  });
  return changed ? { ...draft, days } : draft;
}

function forgetStoredDraft(state: Pick<SplitEditState, 'draft' | 'storageScope'>) {
  if (state.draft && state.storageScope) clearSplitDraft(state.storageScope, splitDraftId(state.draft));
}

function validationError(draft: DraftSplit): string | null {
  if (!draft.name.trim()) return 'Give the program a name.';
  if (draft.days.length === 0) return 'Add at least one training day.';
  return null;
}

/** Days and exercises in save order; saved rows keep their ids so the snapshot updates them. */
function snapshotDays(draft: DraftSplit) {
  return draft.days.map((day, dayIndex) => ({
    id: day._isNew ? undefined : day.id,
    day_name: day.day_name.trim() || `Day ${dayIndex + 1}`,
    day_order: dayIndex,
    exercises: day.exercises.map((ex, exerciseIndex) => {
      const normalizedRange = normalizeSetRange(ex.target_sets_min, ex.target_sets, ex.target_sets_max);
      return {
        id: ex._isNew ? undefined : ex.id,
        exercise_id: ex.exercise_id,
        target_sets: normalizedRange.targetSets,
        target_reps_min: ex.target_reps_min,
        target_reps_max: ex.target_reps_max,
        exercise_order: exerciseIndex,
        notes: serializeSetRangeNotes(ex.notes, normalizedRange.minSets, normalizedRange.targetSets, normalizedRange.maxSets),
        superset_group_id: ex.superset_group_id,
      };
    }),
  }));
}

// ═══════════════════════════════════
// STORE
// ═══════════════════════════════════

export const useSplitEditStore = create<SplitEditState>((set, get) => ({
  ...CLOSED,

  startEdit: (split, { userId = null } = {}) => {
    const baseSignature = splitSignature(split);
    const stored = userId ? readSplitDraft(userId, split.id) : null;
    set({
      ...CLOSED,
      draft: splitToDraft(split),
      storageScope: userId,
      baseSignature,
      restorable: stored,
    });
  },

  startNew: (draft, { userId = null } = {}) => {
    set({
      ...CLOSED,
      draft: { ...draft, _isNew: true },
      // A seeded program is unsaved work from the start.
      isDirty: true,
      storageScope: userId,
    });
  },

  restoreDraft: (stored, { userId = null } = {}) => {
    set({
      ...CLOSED,
      draft: stored.draft,
      isDirty: true,
      storageScope: userId,
      baseSignature: stored.baseSignature,
    });
  },

  restoreSaved: () => {
    const { restorable } = get();
    if (!restorable) return;
    set({ draft: restorable.draft, isDirty: true, error: null, undo: null, restorable: null });
  },

  dismissRestore: () => {
    const state = get();
    if (!state.restorable) return;
    forgetStoredDraft(state);
    set({ restorable: null });
  },

  cancelEdit: () => {
    set(CLOSED);
  },

  discardEdit: () => {
    forgetStoredDraft(get());
    set(CLOSED);
  },

  undoRemoval: () => {
    const { undo } = get();
    if (!undo) return;
    set({ draft: undo.draft, isDirty: true, error: null, undo: null });
  },

  dismissUndo: () => {
    if (get().undo) set({ undo: null });
  },

  saveEdit: async ({ createSplit } = {}) => {
    const { draft } = get();
    if (!draft) return null;

    const invalid = validationError(draft);
    if (invalid) {
      set({ error: invalid });
      return null;
    }
    if (draft._isNew && !createSplit) {
      set({ error: CREATE_FAILED_MESSAGE });
      return null;
    }

    set({ saving: true, error: null });

    try {
      // Exercises typed in by hand join the library first, in one insert.
      const pending = pendingExercises(draft);
      const exerciseIds = await insertPendingExercises(pending, {
        client: supabase as unknown as ExerciseInsertClient,
        loadLibrary: () => getExerciseLibrary({ force: true }),
      });
      if (pending.length > 0) invalidateExerciseLibrary();
      const saving = applyExerciseIds(draft, exerciseIds);
      // A retry after a later failure must not insert them again.
      if (saving !== draft && get().draft === draft) set({ draft: saving });

      const name = saving.name.trim();
      const description = saving.description?.trim() || null;
      let saved: SavedSplit;

      if (saving._isNew) {
        const created = await createSplit!({
          name,
          description,
          days_per_week: saving.days.length,
          is_active: true,
          // Everything in a new program is new, so no row carries an id.
          days: snapshotDays(saving).map(({ day_name, day_order, exercises }) => ({ day_name, day_order, exercises })),
        });
        if (!created) {
          set({ saving: false, error: CREATE_FAILED_MESSAGE });
          return null;
        }
        saved = { id: created.id, name, created: true };
      } else {
        const { error } = await supabase.rpc('save_split_snapshot', {
          p_split_id: saving.id,
          p_name: name,
          p_description: description,
          p_days_per_week: saving.days.length,
          p_days: snapshotDays(saving),
        });

        if (error) {
          set({ saving: false, error: error.message });
          return null;
        }
        saved = { id: saving.id, name, created: false };
      }

      forgetStoredDraft(get());
      set(CLOSED);
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save changes';
      set({ saving: false, error: message });
      return null;
    }
  },

  // ─── Split-level ───────────────────

  renameSplit: (name) => {
    set((state) => updateDraft(state, (d) => ({ ...d, name })));
  },

  updateDescription: (description) => {
    set((state) => updateDraft(state, (d) => ({ ...d, description })));
  },

  // ─── Day-level ─────────────────────

  renameDay: (dayId, name) => {
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: d.days.map((day) =>
          day.id === dayId ? { ...day, day_name: name } : day
        ),
      }))
    );
  },

  reorderDays: (dayId, direction) => {
    set((state) =>
      updateDraft(state, (d) => {
        const neighbour = d.days[d.days.findIndex((day) => day.id === dayId) + direction];
        return neighbour ? { ...d, days: moveDayTo(d.days, dayId, neighbour.id) } : d;
      })
    );
  },

  moveDay: (dayId, overDayId) => {
    set((state) =>
      updateDraft(state, (d) => {
        const days = moveDayTo(d.days, dayId, overDayId);
        return days === d.days ? d : { ...d, days };
      })
    );
  },

  addDay: (dayName) => {
    set((state) =>
      updateDraft(state, (d) => ({ ...d, days: [...d.days, newDraftDay(dayName, d.days.length)] }))
    );
  },

  removeDay: (dayId) => {
    set((state) =>
      removeFromDraft(state, `Removed ${state.draft?.days.find((day) => day.id === dayId)?.day_name.trim() || 'day'}`, (d) => ({
        ...d,
        days: fixDayOrders(d.days.filter((day) => day.id !== dayId)),
      }))
    );
  },

  // ─── Exercise-level ────────────────

  reorderExercise: (dayId, exerciseId, direction) => {
    set((state) =>
      updateDraft(state, (d) => updateDay(d, dayId, (exercises) => moveExercise(exercises, exerciseId, direction)))
    );
  },

  moveExerciseTo: (dayId, exerciseId, overExerciseId) => {
    set((state) =>
      updateDraft(state, (d) => updateDay(d, dayId, (exercises) => moveExerciseBlock(exercises, exerciseId, overExerciseId)))
    );
  },

  updateExerciseTargets: (dayId, exerciseId, updates) => {
    set((state) => {
      if (!state.draft) return {};
      const days = state.draft.days.map((day) => {
        if (day.id !== dayId) return day;

        const source = day.exercises.find((entry) => entry.id === exerciseId);
        const sourceGroupId = source?.superset_group_id || null;
        const setsUpdated = (
          typeof updates.target_sets === 'number'
          || typeof updates.target_sets_min === 'number'
          || typeof updates.target_sets_max === 'number'
        );

        const normalizedSource = source
          ? normalizeSetRange(
              typeof updates.target_sets_min === 'number' ? updates.target_sets_min : source.target_sets_min,
              typeof updates.target_sets === 'number' ? updates.target_sets : source.target_sets,
              typeof updates.target_sets_max === 'number' ? updates.target_sets_max : source.target_sets_max,
            )
          : null;

        return {
          ...day,
          exercises: day.exercises.map((ex) => {
            if (ex.id !== exerciseId) {
              if (!setsUpdated || !sourceGroupId || ex.superset_group_id !== sourceGroupId || !normalizedSource) {
                return ex;
              }

              return {
                ...ex,
                target_sets: normalizedSource.targetSets,
                target_sets_min: normalizedSource.minSets,
                target_sets_max: normalizedSource.maxSets,
              };
            }

            const next = { ...ex, ...updates };
            const normalized = normalizeSetRange(next.target_sets_min, next.target_sets, next.target_sets_max);

            return {
              ...next,
              target_sets: normalized.targetSets,
              target_sets_min: normalized.minSets,
              target_sets_max: normalized.maxSets,
            };
          }),
        };
      });

      // A blur that changes nothing must not mark the draft dirty (which
      // enables Save and the discard prompt), so keep the state untouched.
      const previousDays = state.draft.days;
      const changed = days.some((day, dayIndex) =>
        day !== previousDays[dayIndex]
        && day.exercises.some((ex, exIndex) =>
          TARGET_FIELDS.some((field) => ex[field] !== previousDays[dayIndex].exercises[exIndex][field])
        )
      );
      if (!changed) return state;

      return updateDraft(state, (d) => ({ ...d, days }));
    });
  },

  swapExercise: (dayId, exerciseId, newExercise) => {
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: d.days.map((day) => {
          if (day.id !== dayId) return day;
          return {
            ...day,
            exercises: day.exercises.map((ex) =>
              ex.id === exerciseId
                ? {
                    ...ex,
                    exercise_id: newExercise.id,
                    exercise: newExercise,
                    superset_group_id: ex.superset_group_id,
                  }
                : ex
            ),
          };
        }),
      }))
    );
  },

  addExercise: (dayId, exercise) => {
    get().addExercises(dayId, [exercise]);
  },

  addExercises: (dayId, exercises) => {
    set((state) =>
      updateDraft(state, (d) => updateDay(d, dayId, (current) => {
        const present = new Set(current.map((entry) => entry.exercise_id));
        const adding = exercises.filter((exercise) => {
          if (present.has(exercise.id)) return false;
          present.add(exercise.id);
          return true;
        });
        if (adding.length === 0) return current;
        return [...current, ...adding.map((exercise, index) => newDraftExercise(exercise, current.length + index))];
      }))
    );
  },

  addSupersetExercise: (dayId, sourceExerciseId, exercise) => {
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: d.days.map((day) => {
          if (day.id !== dayId) return day;

          const sourceIndex = day.exercises.findIndex((entry) => entry.id === sourceExerciseId);
          if (sourceIndex < 0) return day;

          if (day.exercises.some((entry) => entry.exercise_id === exercise.id)) return day;

          const source = day.exercises[sourceIndex];

          if (source.superset_group_id) {
            const existingMembers = day.exercises.filter((entry) => entry.superset_group_id === source.superset_group_id);
            if (existingMembers.length >= 2) return day;
          }

          const groupId = source.superset_group_id || createSupersetGroupId();

          const nextExercises = day.exercises.map((entry) => {
            if (entry.id === source.id) {
              return { ...entry, superset_group_id: groupId };
            }
            return entry;
          });

          const partnerExercise = newDraftExercise({
            ...exercise,
            muscle_group_secondary: exercise.muscle_group_secondary ?? inferSecondaryMuscleGroup(source.exercise.muscle_group),
          }, source.exercise_order + 1, {
            target_sets: source.target_sets,
            target_sets_min: source.target_sets_min,
            target_sets_max: source.target_sets_max,
            target_reps_min: source.target_reps_min,
            target_reps_max: source.target_reps_max,
            superset_group_id: groupId,
          });

          nextExercises.splice(sourceIndex + 1, 0, partnerExercise);

          return {
            ...day,
            exercises: nextExercises.map((entry, index) => ({ ...entry, exercise_order: index })),
          };
        }),
      }))
    );
  },

  clearExerciseSuperset: (dayId, exerciseId) => {
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: d.days.map((day) => {
          if (day.id !== dayId) return day;

          const target = day.exercises.find((entry) => entry.id === exerciseId);
          if (!target?.superset_group_id) return day;

          const groupId = target.superset_group_id;
          return {
            ...day,
            exercises: day.exercises.map((entry) => (
              entry.superset_group_id === groupId
                ? { ...entry, superset_group_id: null }
                : entry
            )),
          };
        }),
      }))
    );
  },

  removeExercise: (dayId, exerciseId) => {
    set((state) =>
      removeFromDraft(state, `Removed ${
        state.draft?.days.find((day) => day.id === dayId)?.exercises.find((ex) => ex.id === exerciseId)?.exercise.name ?? 'exercise'
      }`, (d) => ({
        ...d,
        days: d.days.map((day) => {
          if (day.id !== dayId) return day;

          const removing = day.exercises.find((entry) => entry.id === exerciseId);
          const removingGroupId = removing?.superset_group_id || null;

          const sameGroupCount = removingGroupId
            ? day.exercises.filter((item) => item.superset_group_id === removingGroupId).length
            : 0;

          const filtered = day.exercises
            .filter((ex) => ex.id !== exerciseId)
            .map((entry) => {
              if (!removingGroupId || sameGroupCount <= 1) return entry;

              if (entry.superset_group_id === removingGroupId) {
                return { ...entry, superset_group_id: null };
              }

              return entry;
            });

          return {
            ...day,
            exercises: filtered.map((ex, i) => ({ ...ex, exercise_order: i })),
          };
        }),
      }))
    );
  },

  updateExerciseNotes: (dayId, exerciseId, notes) => {
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: d.days.map((day) => {
          if (day.id !== dayId) return day;
          return {
            ...day,
            exercises: day.exercises.map((ex) =>
              ex.id === exerciseId ? { ...ex, notes } : ex
            ),
          };
        }),
      }))
    );
  },
}));
