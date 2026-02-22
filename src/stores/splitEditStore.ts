import { create } from 'zustand';
import { normalizeSetRange, parseSetRangeNotes, serializeSetRangeNotes } from '@/lib/setRangeNotes';
import { supabase } from '@/lib/supabase';
import type { Split, Exercise, MuscleGroup } from '@/types';

// ═══════════════════════════════════
// DRAFT TYPES
// ═══════════════════════════════════

export interface DraftExercise {
  /** Original DB id or a temp id for new exercises */
  id: string;
  exercise_id: string;
  exercise: Exercise;
  target_sets: number;
  target_sets_min: number;
  target_sets_max: number;
  target_reps_min: number;
  target_reps_max: number;
  exercise_order: number;
  notes: string | null;
  superset_group_id: string | null;
  /** true if this was created during the edit session */
  _isNew?: boolean;
}

export interface DraftDay {
  id: string;
  day_name: string;
  day_order: number;
  exercises: DraftExercise[];
  _isNew?: boolean;
}

export interface DraftSplit {
  id: string;
  name: string;
  description: string | null;
  days_per_week: number;
  days: DraftDay[];
}

// ═══════════════════════════════════
// STORE STATE
// ═══════════════════════════════════

interface SplitEditState {
  draft: DraftSplit | null;
  isDirty: boolean;
  saving: boolean;
  error: string | null;

  // Lifecycle
  startEdit: (split: Split) => void;
  cancelEdit: () => void;
  saveEdit: () => Promise<boolean>;

  // Split-level
  renameSplit: (name: string) => void;
  updateDescription: (description: string) => void;

  // Day-level
  renameDay: (dayId: string, name: string) => void;
  reorderDays: (dayId: string, direction: -1 | 1) => void;
  addDay: (dayName: string) => void;
  removeDay: (dayId: string) => void;

  // Exercise-level
  reorderExercise: (dayId: string, exerciseId: string, direction: -1 | 1) => void;
  updateExerciseTargets: (dayId: string, exerciseId: string, updates: Partial<Pick<DraftExercise, 'target_sets' | 'target_sets_min' | 'target_sets_max' | 'target_reps_min' | 'target_reps_max'>>) => void;
  swapExercise: (dayId: string, exerciseId: string, newExercise: Exercise) => void;
  addExercise: (dayId: string, exercise: Exercise) => void;
  addSupersetExercise: (dayId: string, sourceExerciseId: string, exercise: Exercise) => void;
  clearExerciseSuperset: (dayId: string, exerciseId: string) => void;
  removeExercise: (dayId: string, exerciseId: string) => void;
  updateExerciseNotes: (dayId: string, exerciseId: string, notes: string | null) => void;
}

// ═══════════════════════════════════
// HELPERS
// ═══════════════════════════════════

function createTempId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `new-${globalThis.crypto.randomUUID()}`;
  }
  return `new-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSupersetGroupId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

function splitToDraft(split: Split): DraftSplit {
  return {
    id: split.id,
    name: split.name,
    description: split.description,
    days_per_week: split.days_per_week,
    days: split.days.map((day) => ({
      id: day.id,
      day_name: day.day_name,
      day_order: day.day_order,
      exercises: (day.exercises || []).map((ex) => {
        const parsedRange = parseSetRangeNotes(ex.notes, ex.target_sets);
        return {
          id: ex.id,
          exercise_id: ex.exercise_id,
          exercise: ex.exercise,
          target_sets: parsedRange.targetSets,
          target_sets_min: parsedRange.minSets,
          target_sets_max: parsedRange.maxSets,
          target_reps_min: ex.target_reps_min,
          target_reps_max: ex.target_reps_max,
          exercise_order: ex.exercise_order,
          notes: parsedRange.baseNotes,
          superset_group_id: ex.superset_group_id ?? null,
        };
      }),
    })),
  };
}

function fixDayOrders(days: DraftDay[]): DraftDay[] {
  return days.map((day, index) => ({
    ...day,
    day_order: index,
    exercises: day.exercises.map((ex, exIdx) => ({
      ...ex,
      exercise_order: exIdx,
    })),
  }));
}

function updateDraft(state: SplitEditState, updater: (draft: DraftSplit) => DraftSplit): Partial<SplitEditState> {
  if (!state.draft) return {};
  return { draft: updater(state.draft), isDirty: true, error: null };
}

// ═══════════════════════════════════
// STORE
// ═══════════════════════════════════

export const useSplitEditStore = create<SplitEditState>((set, get) => ({
  draft: null,
  isDirty: false,
  saving: false,
  error: null,

  startEdit: (split) => {
    set({
      draft: splitToDraft(split),
      isDirty: false,
      saving: false,
      error: null,
    });
  },

  cancelEdit: () => {
    set({ draft: null, isDirty: false, saving: false, error: null });
  },

  saveEdit: async () => {
    const { draft } = get();
    if (!draft) return false;

    set({ saving: true, error: null });

    try {
      // Build JSONB payload for the RPC
      const daysPayload = draft.days.map((day) => ({
        id: day._isNew ? undefined : day.id,
        day_name: day.day_name,
        day_order: day.day_order,
        exercises: day.exercises.map((ex) => {
          const normalizedRange = normalizeSetRange(ex.target_sets_min, ex.target_sets, ex.target_sets_max);
          return {
            id: ex._isNew ? undefined : ex.id,
            exercise_id: ex.exercise_id,
            target_sets: normalizedRange.targetSets,
            target_reps_min: ex.target_reps_min,
            target_reps_max: ex.target_reps_max,
            exercise_order: ex.exercise_order,
            notes: serializeSetRangeNotes(ex.notes, normalizedRange.minSets, normalizedRange.targetSets, normalizedRange.maxSets),
            superset_group_id: ex.superset_group_id,
          };
        }),
      }));

      const { error } = await supabase.rpc('save_split_snapshot', {
        p_split_id: draft.id,
        p_name: draft.name,
        p_description: draft.description,
        p_days_per_week: draft.days.length,
        p_days: daysPayload,
      });

      if (error) {
        set({ saving: false, error: error.message });
        return false;
      }

      set({ draft: null, isDirty: false, saving: false, error: null });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save changes';
      set({ saving: false, error: message });
      return false;
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
        const idx = d.days.findIndex((day) => day.id === dayId);
        if (idx < 0) return d;
        const target = idx + direction;
        if (target < 0 || target >= d.days.length) return d;

        const next = [...d.days];
        const [moving] = next.splice(idx, 1);
        next.splice(target, 0, moving);
        return { ...d, days: fixDayOrders(next) };
      })
    );
  },

  addDay: (dayName) => {
    set((state) =>
      updateDraft(state, (d) => {
        const newDay: DraftDay = {
          id: createTempId(),
          day_name: dayName,
          day_order: d.days.length,
          exercises: [],
          _isNew: true,
        };
        return { ...d, days: [...d.days, newDay] };
      })
    );
  },

  removeDay: (dayId) => {
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: fixDayOrders(d.days.filter((day) => day.id !== dayId)),
      }))
    );
  },

  // ─── Exercise-level ────────────────

  reorderExercise: (dayId, exerciseId, direction) => {
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: d.days.map((day) => {
          if (day.id !== dayId) return day;
          const idx = day.exercises.findIndex((ex) => ex.id === exerciseId);
          if (idx < 0) return day;
          const target = idx + direction;
          if (target < 0 || target >= day.exercises.length) return day;

          const next = [...day.exercises];
          const [moving] = next.splice(idx, 1);
          next.splice(target, 0, moving);
          return {
            ...day,
            exercises: next.map((ex, i) => ({ ...ex, exercise_order: i })),
          };
        }),
      }))
    );
  },

  updateExerciseTargets: (dayId, exerciseId, updates) => {
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: d.days.map((day) => {
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
        }),
      }))
    );
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
    set((state) =>
      updateDraft(state, (d) => ({
        ...d,
        days: d.days.map((day) => {
          if (day.id !== dayId) return day;
          const newEx: DraftExercise = {
            id: createTempId(),
            exercise_id: exercise.id,
            exercise,
            target_sets: 3,
            target_sets_min: 3,
            target_sets_max: 3,
            target_reps_min: 8,
            target_reps_max: 12,
            exercise_order: day.exercises.length,
            notes: null,
            superset_group_id: null,
            _isNew: true,
          };
          return { ...day, exercises: [...day.exercises, newEx] };
        }),
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

          const partnerExercise: DraftExercise = {
            id: createTempId(),
            exercise_id: exercise.id,
            exercise: {
              ...exercise,
              muscle_group_secondary: exercise.muscle_group_secondary ?? inferSecondaryMuscleGroup(source.exercise.muscle_group),
            },
            target_sets: source.target_sets,
            target_sets_min: source.target_sets_min,
            target_sets_max: source.target_sets_max,
            target_reps_min: source.target_reps_min,
            target_reps_max: source.target_reps_max,
            exercise_order: source.exercise_order + 1,
            notes: null,
            superset_group_id: groupId,
            _isNew: true,
          };

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
      updateDraft(state, (d) => ({
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
