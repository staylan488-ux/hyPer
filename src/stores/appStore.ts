import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type {
  Split,
  SplitDay,
  Workout,
  WorkoutSet,
  MacroTarget,
  VolumeLandmark,
  MuscleVolume,
  MuscleGroup,
  WorkoutMode,
  WorkoutDayPlan,
  FlexDayTemplate,
  FlexiblePlanItem,
  Exercise,
} from '@/types';
import { startOfWeek, endOfWeek, format, startOfMonth, endOfMonth } from 'date-fns';

const WORKOUT_MODE_STORAGE_KEY = 'program:workout-mode';

function readWorkoutModeFallback(): WorkoutMode {
  try {
    const stored = globalThis.localStorage?.getItem(WORKOUT_MODE_STORAGE_KEY);
    return stored === 'flexible' ? 'flexible' : 'split';
  } catch {
    return 'split';
  }
}

function writeWorkoutModeFallback(mode: WorkoutMode): void {
  try {
    globalThis.localStorage?.setItem(WORKOUT_MODE_STORAGE_KEY, mode);
  } catch {
    // no-op
  }
}

function normalizeFlexiblePlanItems(raw: unknown): FlexiblePlanItem[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const value = item as Record<string, unknown>;
      const exerciseId = typeof value.exercise_id === 'string' ? value.exercise_id : null;
      if (!exerciseId) return null;

      const order = typeof value.order === 'number' && Number.isFinite(value.order)
        ? value.order
        : index;

      return {
        exercise_id: exerciseId,
        order,
        exercise_name: typeof value.exercise_name === 'string' ? value.exercise_name : null,
        target_sets: typeof value.target_sets === 'number' ? value.target_sets : null,
        target_reps_min: typeof value.target_reps_min === 'number' ? value.target_reps_min : null,
        target_reps_max: typeof value.target_reps_max === 'number' ? value.target_reps_max : null,
        notes: typeof value.notes === 'string' ? value.notes : null,
        hidden: Boolean(value.hidden),
        superset_group_id: typeof value.superset_group_id === 'string' ? value.superset_group_id : null,
      } as FlexiblePlanItem;
    })
    .filter((item): item is FlexiblePlanItem => Boolean(item))
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
}

function normalizeTargetSets(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(12, Math.round(value)));
}

function parseMovementNotesMap(raw: string | null): Record<string, string> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> & { movementNotes?: Record<string, unknown> };
    const source = parsed?.movementNotes && typeof parsed.movementNotes === 'object'
      ? parsed.movementNotes
      : parsed;

    const next: Record<string, string> = {};
    for (const [exerciseId, value] of Object.entries(source || {})) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      next[exerciseId] = trimmed.slice(0, 200);
    }
    return next;
  } catch {
    return {};
  }
}

interface AppState {
  activeSplit: Split | null;
  splits: Split[];
  currentWorkout: Workout | null;
  workoutMode: WorkoutMode;
  currentWorkoutDayPlan: WorkoutDayPlan | null;
  flexTemplates: FlexDayTemplate[];
  macroTarget: MacroTarget | null;
  volumeLandmarks: VolumeLandmark[];
  weeklyVolume: MuscleVolume[];
  loading: boolean;

  // Split actions
  fetchSplits: () => Promise<void>;
  createSplit: (split: Omit<Split, 'id' | 'user_id' | 'days'> & { days: { day_name: string; day_order: number; exercises?: { exercise_id: string; target_sets: number; target_reps_min: number; target_reps_max: number; exercise_order: number; notes?: string | null; superset_group_id?: string | null }[] }[] }) => Promise<Split | null>;
  updateSplit: (id: string, updates: Partial<Split>) => Promise<void>;
  deleteSplit: (id: string) => Promise<void>;
  setActiveSplit: (splitId: string) => Promise<void>;

  // Workout actions
  startWorkout: (splitDayId: string) => Promise<Workout | null>;
  startFlexibleWorkout: (dayLabel: string, templateLabel?: string | null) => Promise<Workout | null>;
  fetchCurrentWorkout: () => Promise<void>;
  addWorkoutSet: (exerciseId: string) => Promise<void>;
  removeLastUncompletedSet: (exerciseId: string) => Promise<void>;
  logSet: (exerciseId: string, setNumber: number, weight: number, reps: number, rpe?: number) => Promise<void>;
  updateSet: (setId: string, updates: Partial<WorkoutSet>) => Promise<void>;
  completeWorkout: () => Promise<void>;
  fetchWorkoutsByMonth: (month: Date) => Promise<Workout[]>;
  fetchWorkoutById: (workoutId: string) => Promise<Workout | null>;
  deleteWorkout: (workoutId: string) => Promise<void>;

  // Flexible programming
  fetchWorkoutMode: () => Promise<void>;
  setWorkoutMode: (mode: WorkoutMode) => Promise<{ ok: boolean; reason?: string }>;
  fetchCurrentWorkoutDayPlan: (workoutId?: string) => Promise<void>;
  setFlexibleWorkoutLabel: (label: string) => Promise<void>;
  addFlexibleExercise: (exercise: Exercise) => Promise<void>;
  addFlexibleSuperset: (baseExerciseId: string, partner: Exercise) => Promise<void>;
  clearFlexibleSuperset: (exerciseId: string) => Promise<void>;
  updateFlexibleExerciseMeta: (exerciseId: string, updates: Partial<FlexiblePlanItem>) => Promise<void>;
  removeFlexibleExerciseFromPlan: (exerciseId: string) => Promise<void>;
  reorderFlexibleExercises: (exerciseIds: string[]) => Promise<void>;
  fetchFlexTemplates: () => Promise<void>;
  startFlexibleWorkoutFromTemplate: (label: string) => Promise<Workout | null>;
  renameFlexTemplate: (templateId: string, nextLabel: string, allowOverwrite?: boolean) => Promise<{ ok: boolean; conflictLabel?: string; reason?: string }>;
  deleteFlexTemplate: (templateId: string) => Promise<void>;
  saveFlexibleTemplateFromCurrentWorkout: () => Promise<void>;

  // Macro targets
  fetchMacroTarget: () => Promise<void>;
  updateMacroTarget: (target: Partial<MacroTarget>) => Promise<void>;

  // Volume
  fetchVolumeLandmarks: () => Promise<void>;
  updateVolumeLandmark: (muscleGroup: MuscleGroup, updates: Partial<VolumeLandmark>) => Promise<void>;
  calculateWeeklyVolume: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeSplit: null,
  splits: [],
  currentWorkout: null,
  workoutMode: 'split',
  currentWorkoutDayPlan: null,
  flexTemplates: [],
  macroTarget: null,
  volumeLandmarks: [],
  weeklyVolume: [],
  loading: false,

  fetchSplits: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: splits } = await supabase
      .from('splits')
      .select(`
        *,
        days:split_days (
          *,
          exercises:split_exercises (
            *,
            exercise:exercises (*)
          )
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (splits) {
      const formattedSplits = splits.map((split) => ({
        ...split,
        days: split.days
          .map((day: SplitDay) => ({
            ...day,
            exercises: [...(day.exercises || [])].sort((a, b) => a.exercise_order - b.exercise_order),
          }))
          .sort((a: SplitDay, b: SplitDay) => a.day_order - b.day_order),
      }));
      
      const active = formattedSplits.find((s: Split) => s.is_active);
      set({ 
        splits: formattedSplits, 
        activeSplit: active || null 
      });
    }
  },

  createSplit: async (splitData: Omit<Split, 'id' | 'user_id' | 'days'> & { days: { day_name: string; day_order: number; exercises?: { exercise_id: string; target_sets: number; target_reps_min: number; target_reps_max: number; exercise_order: number; notes?: string | null; superset_group_id?: string | null }[] }[] }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: split, error } = await supabase
      .from('splits')
      .insert({
        user_id: user.id,
        name: splitData.name,
        description: splitData.description,
        days_per_week: splitData.days_per_week,
        is_active: splitData.is_active,
      })
      .select()
      .single();

    if (error || !split) return null;

    // Create split days and exercises
    for (let i = 0; i < splitData.days.length; i++) {
      const day = splitData.days[i];
      const { data: splitDay } = await supabase
        .from('split_days')
        .insert({
          split_id: split.id,
          day_name: day.day_name,
          day_order: i,
        })
        .select()
        .single();

      if (splitDay && day.exercises) {
        for (let j = 0; j < day.exercises.length; j++) {
          const ex = day.exercises[j];
          await supabase.from('split_exercises').insert({
            split_day_id: splitDay.id,
            exercise_id: ex.exercise_id,
            target_sets: ex.target_sets,
            target_reps_min: ex.target_reps_min,
            target_reps_max: ex.target_reps_max,
            exercise_order: j,
            notes: ex.notes,
            superset_group_id: ex.superset_group_id ?? null,
          });
        }
      }
    }

    await get().fetchSplits();
    return split as Split;
  },

  updateSplit: async (id, updates) => {
    await supabase.from('splits').update(updates).eq('id', id);
    await get().fetchSplits();
  },

  deleteSplit: async (id) => {
    await supabase.from('splits').delete().eq('id', id);
    await get().fetchSplits();
  },

  setActiveSplit: async (splitId) => {
    const { splits } = get();
    
    // Set all splits to inactive
    for (const split of splits) {
      await supabase.from('splits').update({ is_active: false }).eq('id', split.id);
    }
    
    // Set selected split to active
    await supabase.from('splits').update({ is_active: true }).eq('id', splitId);
    await get().fetchSplits();
  },

  fetchWorkoutMode: async () => {
    const fallbackMode = readWorkoutModeFallback();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ workoutMode: fallbackMode });
      return;
    }

    const { data, error } = await supabase
      .from('program_preferences')
      .select('workout_mode')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching workout mode, using local fallback:', error);
      set({ workoutMode: fallbackMode });
      return;
    }

    const mode = (data?.workout_mode as WorkoutMode) || fallbackMode;
    set({ workoutMode: mode });
    writeWorkoutModeFallback(mode);
  },

  setWorkoutMode: async (mode) => {
    const { currentWorkout } = get();

    if (currentWorkout && !currentWorkout.completed) {
      return { ok: false, reason: 'Finish current workout before switching modes.' };
    }

    set({ workoutMode: mode });
    writeWorkoutModeFallback(mode);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: true };

    const { error } = await supabase
      .from('program_preferences')
      .upsert({
        user_id: user.id,
        workout_mode: mode,
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('Error saving workout mode remotely, kept local mode:', error);
      return { ok: true };
    }

    return { ok: true };
  },

  fetchFlexTemplates: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('flex_day_templates')
      .select('id, user_id, label, items')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching flex templates:', error);
      return;
    }

    const templates = (data || []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      label: row.label,
      items: normalizeFlexiblePlanItems(row.items),
    } as FlexDayTemplate));

    set({ flexTemplates: templates });
  },

  startFlexibleWorkoutFromTemplate: async (label) => {
    const trimmed = label.trim();
    if (!trimmed) return null;

    return get().startFlexibleWorkout(trimmed, trimmed);
  },

  renameFlexTemplate: async (templateId, nextLabel, allowOverwrite = false) => {
    const trimmed = nextLabel.trim();
    if (!trimmed) return { ok: false, reason: 'Template label is required.' };

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, reason: 'Not signed in.' };

    const { flexTemplates } = get();
    const sourceTemplate = flexTemplates.find((template) => template.id === templateId);
    if (!sourceTemplate) return { ok: false, reason: 'Template not found.' };

    if (sourceTemplate.label === trimmed) {
      return { ok: true };
    }

    const lowered = trimmed.toLowerCase();
    const conflictTemplate = flexTemplates.find((template) => (
      template.id !== templateId && template.label.trim().toLowerCase() === lowered
    ));

    if (conflictTemplate && !allowOverwrite) {
      return { ok: false, conflictLabel: conflictTemplate.label };
    }

    if (conflictTemplate && allowOverwrite) {
      const { error: overwriteError } = await supabase
        .from('flex_day_templates')
        .upsert({
          user_id: user.id,
          label: trimmed,
          items: sourceTemplate.items,
        }, {
          onConflict: 'user_id,label',
        });

      if (overwriteError) {
        console.error('Error overwriting flexible template label:', overwriteError);
        return { ok: false, reason: 'Could not overwrite existing template.' };
      }

      const { error: cleanupError } = await supabase
        .from('flex_day_templates')
        .delete()
        .eq('id', templateId);

      if (cleanupError) {
        console.error('Error removing original template after overwrite:', cleanupError);
        return { ok: false, reason: 'Template overwrite partially failed.' };
      }

      await get().fetchFlexTemplates();
      return { ok: true };
    }

    const { error } = await supabase
      .from('flex_day_templates')
      .update({ label: trimmed })
      .eq('id', templateId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error renaming flexible template:', error);
      return { ok: false, reason: 'Could not rename template.' };
    }

    await get().fetchFlexTemplates();
    return { ok: true };
  },

  deleteFlexTemplate: async (templateId) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('flex_day_templates')
      .delete()
      .eq('id', templateId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error deleting flexible template:', error);
      return;
    }

    await get().fetchFlexTemplates();
  },

  fetchCurrentWorkoutDayPlan: async (workoutId) => {
    const targetWorkoutId = workoutId || get().currentWorkout?.id;
    if (!targetWorkoutId) {
      set({ currentWorkoutDayPlan: null });
      return;
    }

    const { data, error } = await supabase
      .from('workout_day_plans')
      .select('id, workout_id, day_label, items')
      .eq('workout_id', targetWorkoutId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching workout day plan:', error);
      return;
    }

    if (!data) {
      set({ currentWorkoutDayPlan: null });
      return;
    }

    set({
      currentWorkoutDayPlan: {
        id: data.id,
        workout_id: data.workout_id,
        day_label: data.day_label,
        items: normalizeFlexiblePlanItems(data.items),
      },
    });
  },

  startWorkout: async (splitDayId) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const today = format(new Date(), 'yyyy-MM-dd');

    // Check if workout already exists for today with exercise data
    const { data: existing, error: existingError } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('user_id', user.id)
      .eq('date', today)
      .eq('completed', false)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking existing workout:', existingError);
    }

    if (existing) {
      set({ currentWorkout: existing as Workout, currentWorkoutDayPlan: null });
      return existing as Workout;
    }

    const { data: workout, error } = await supabase
      .from('workouts')
      .insert({
        user_id: user.id,
        split_day_id: splitDayId,
        date: today,
        completed: false,
      })
      .select()
      .single();

    if (error || !workout) return null;

    // Get split day exercises and create placeholder sets
    const { data: splitExercises } = await supabase
      .from('split_exercises')
      .select('*, exercise:exercises(*)')
      .eq('split_day_id', splitDayId)
      .order('exercise_order');

    if (splitExercises) {
      for (const se of splitExercises) {
        for (let i = 1; i <= se.target_sets; i++) {
          await supabase.from('sets').insert({
            workout_id: workout.id,
            exercise_id: se.exercise_id,
            set_number: i,
            completed: false,
          });
        }
      }
    }

    // Fetch the complete workout with sets
    const { data: completeWorkout, error: fetchError } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('id', workout.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching complete workout:', fetchError);
    }

    if (completeWorkout) {
      set({ currentWorkout: completeWorkout as Workout, currentWorkoutDayPlan: null });
      return completeWorkout as Workout;
    }

    return null;
  },

  startFlexibleWorkout: async (dayLabel, templateLabel) => {
    const label = dayLabel.trim();
    if (!label) return null;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const today = format(new Date(), 'yyyy-MM-dd');

    const { data: existing, error: existingError } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('user_id', user.id)
      .eq('date', today)
      .eq('completed', false)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking existing workout:', existingError);
    }

    if (existing) {
      if (existing.split_day_id !== null) {
        return null;
      }

      await get().fetchCurrentWorkoutDayPlan(existing.id);
      set({ currentWorkout: existing as Workout });
      return existing as Workout;
    }

    const { data: workout, error } = await supabase
      .from('workouts')
      .insert({
        user_id: user.id,
        split_day_id: null,
        date: today,
        completed: false,
      })
      .select()
      .single();

    if (error || !workout) return null;

    let templateItems: FlexiblePlanItem[] = [];

    if (templateLabel?.trim()) {
      const { data: template } = await supabase
        .from('flex_day_templates')
        .select('items')
        .eq('user_id', user.id)
        .eq('label', templateLabel.trim())
        .maybeSingle();

      templateItems = normalizeFlexiblePlanItems(template?.items);
    }

    const { data: createdPlan, error: planError } = await supabase
      .from('workout_day_plans')
      .insert({
        workout_id: workout.id,
        day_label: label,
        items: templateItems,
      })
      .select('id, workout_id, day_label, items')
      .single();

    if (planError) {
      console.error('Error creating flexible workout plan:', planError);
    }

    if (templateItems.length > 0) {
      for (const item of templateItems) {
        if (item.hidden) continue;
        const targetSets = normalizeTargetSets(item.target_sets);
        for (let setNumber = 1; setNumber <= targetSets; setNumber += 1) {
          await supabase.from('sets').insert({
            workout_id: workout.id,
            exercise_id: item.exercise_id,
            set_number: setNumber,
            completed: false,
          });
        }
      }
    }

    const { data: completeWorkout, error: fetchError } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('id', workout.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching flexible workout:', fetchError);
    }

    if (completeWorkout) {
      set({
        currentWorkout: completeWorkout as Workout,
        currentWorkoutDayPlan: createdPlan
          ? {
              id: createdPlan.id,
              workout_id: createdPlan.workout_id,
              day_label: createdPlan.day_label,
              items: normalizeFlexiblePlanItems(createdPlan.items),
            }
          : null,
      });
      return completeWorkout as Workout;
    }

    return null;
  },

  fetchCurrentWorkout: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { currentWorkout } = get();
    
    const today = format(new Date(), 'yyyy-MM-dd');

    const { data: workout, error } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle();

    if (error) {
      console.error('Error fetching current workout:', error);
      return;
    }

    if (workout && !workout.completed) {
      const nextWorkout = workout as Workout;
      set({ currentWorkout: nextWorkout });

      if (nextWorkout.split_day_id === null) {
        await get().fetchCurrentWorkoutDayPlan(nextWorkout.id);
      } else {
        set({ currentWorkoutDayPlan: null });
      }
    } else if (!currentWorkout) {
      set({ currentWorkout: null, currentWorkoutDayPlan: null });
    }
  },

  addWorkoutSet: async (exerciseId) => {
    const { currentWorkout } = get();
    if (!currentWorkout) return;

    const existingSets = currentWorkout.sets.filter((set) => set.exercise_id === exerciseId);
    const nextSetNumber = existingSets.length > 0
      ? Math.max(...existingSets.map((set) => set.set_number)) + 1
      : 1;

    const { data: createdSet, error } = await supabase
      .from('sets')
      .insert({
        workout_id: currentWorkout.id,
        exercise_id: exerciseId,
        set_number: nextSetNumber,
        completed: false,
      })
      .select('*, exercise:exercises!exercise_id(*)')
      .single();

    if (error || !createdSet) {
      if (error) console.error('Error adding workout set:', error);
      return;
    }

    const latestWorkout = get().currentWorkout;
    if (!latestWorkout || latestWorkout.id !== currentWorkout.id) return;

    set({
      currentWorkout: {
        ...latestWorkout,
        sets: [...latestWorkout.sets, createdSet as WorkoutSet],
      },
    });
  },

  setFlexibleWorkoutLabel: async (label) => {
    const trimmed = label.trim();
    if (!trimmed) return;

    const { currentWorkout, currentWorkoutDayPlan } = get();
    if (!currentWorkout || currentWorkout.split_day_id !== null || !currentWorkoutDayPlan) return;

    const { data, error } = await supabase
      .from('workout_day_plans')
      .update({ day_label: trimmed })
      .eq('id', currentWorkoutDayPlan.id)
      .select('id, workout_id, day_label, items')
      .single();

    if (error || !data) {
      if (error) console.error('Error updating flexible day label:', error);
      return;
    }

    set({
      currentWorkoutDayPlan: {
        id: data.id,
        workout_id: data.workout_id,
        day_label: data.day_label,
        items: normalizeFlexiblePlanItems(data.items),
      },
    });
  },

  addFlexibleExercise: async (exercise) => {
    const { currentWorkout, currentWorkoutDayPlan } = get();
    if (!currentWorkout || currentWorkout.split_day_id !== null || !currentWorkoutDayPlan) return;

    const existing = currentWorkoutDayPlan.items.find((item) => item.exercise_id === exercise.id);

    const nextItems = existing
      ? currentWorkoutDayPlan.items.map((item) => (
          item.exercise_id === exercise.id
            ? { ...item, hidden: false, exercise_name: exercise.name }
            : item
        ))
      : [
          ...currentWorkoutDayPlan.items,
          {
            exercise_id: exercise.id,
            exercise_name: exercise.name,
            order: currentWorkoutDayPlan.items.length,
            target_sets: 3,
            target_reps_min: 8,
            target_reps_max: 12,
            notes: null,
            hidden: false,
            superset_group_id: null,
          },
        ];

    const normalizedItems = nextItems
      .sort((a, b) => a.order - b.order)
      .map((item, index) => ({ ...item, order: index }));

    const { data: updatedPlan, error: planError } = await supabase
      .from('workout_day_plans')
      .update({ items: normalizedItems })
      .eq('id', currentWorkoutDayPlan.id)
      .select('id, workout_id, day_label, items')
      .single();

    if (planError || !updatedPlan) {
      if (planError) console.error('Error adding flexible exercise:', planError);
      return;
    }

    const existingSetsCount = currentWorkout.sets.filter((set) => set.exercise_id === exercise.id).length;
    if (existingSetsCount === 0) {
      const targetSets = normalizeTargetSets(existing?.target_sets ?? 3);
      for (let setNumber = 1; setNumber <= targetSets; setNumber += 1) {
        await supabase.from('sets').insert({
          workout_id: currentWorkout.id,
          exercise_id: exercise.id,
          set_number: setNumber,
          completed: false,
        });
      }

      const { data: refreshedWorkout } = await supabase
        .from('workouts')
        .select('*, sets(*, exercise:exercises!exercise_id(*))')
        .eq('id', currentWorkout.id)
        .maybeSingle();

      if (refreshedWorkout) {
        set({ currentWorkout: refreshedWorkout as Workout });
      }
    }

    set({
      currentWorkoutDayPlan: {
        id: updatedPlan.id,
        workout_id: updatedPlan.workout_id,
        day_label: updatedPlan.day_label,
        items: normalizeFlexiblePlanItems(updatedPlan.items),
      },
    });
  },

  addFlexibleSuperset: async (baseExerciseId, partner) => {
    const { currentWorkout, currentWorkoutDayPlan } = get();
    if (!currentWorkout || currentWorkout.split_day_id !== null || !currentWorkoutDayPlan) return;

    const baseIndex = currentWorkoutDayPlan.items.findIndex((item) => !item.hidden && item.exercise_id === baseExerciseId);
    if (baseIndex < 0) return;

    if (currentWorkoutDayPlan.items.some((item) => !item.hidden && item.exercise_id === partner.id)) return;

    const baseItem = currentWorkoutDayPlan.items[baseIndex];

    if (baseItem.superset_group_id) {
      const members = currentWorkoutDayPlan.items.filter((item) => item.superset_group_id === baseItem.superset_group_id && !item.hidden);
      if (members.length >= 2) return;
    }

    const groupId = baseItem.superset_group_id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const nextItems = [...currentWorkoutDayPlan.items].map((item) => {
      if (item.exercise_id === baseExerciseId) {
        return { ...item, superset_group_id: groupId };
      }
      return item;
    });

    const partnerItem: FlexiblePlanItem = {
      exercise_id: partner.id,
      exercise_name: partner.name,
      order: (baseItem.order ?? baseIndex) + 1,
      target_sets: baseItem.target_sets ?? 3,
      target_reps_min: baseItem.target_reps_min ?? 8,
      target_reps_max: baseItem.target_reps_max ?? 12,
      notes: null,
      hidden: false,
      superset_group_id: groupId,
    };

    nextItems.splice(baseIndex + 1, 0, partnerItem);

    const normalizedItems = nextItems
      .sort((a, b) => a.order - b.order)
      .map((item, index) => ({ ...item, order: index }));

    const { data: updatedPlan, error: planError } = await supabase
      .from('workout_day_plans')
      .update({ items: normalizedItems })
      .eq('id', currentWorkoutDayPlan.id)
      .select('id, workout_id, day_label, items')
      .single();

    if (planError || !updatedPlan) {
      if (planError) console.error('Error adding flexible superset:', planError);
      return;
    }

    for (let setNumber = 1; setNumber <= normalizeTargetSets(partnerItem.target_sets); setNumber += 1) {
      await supabase.from('sets').insert({
        workout_id: currentWorkout.id,
        exercise_id: partner.id,
        set_number: setNumber,
        completed: false,
      });
    }

    const { data: refreshedWorkout } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('id', currentWorkout.id)
      .maybeSingle();

    if (refreshedWorkout) {
      set({ currentWorkout: refreshedWorkout as Workout });
    }

    set({
      currentWorkoutDayPlan: {
        id: updatedPlan.id,
        workout_id: updatedPlan.workout_id,
        day_label: updatedPlan.day_label,
        items: normalizeFlexiblePlanItems(updatedPlan.items),
      },
    });
  },

  clearFlexibleSuperset: async (exerciseId) => {
    const { currentWorkoutDayPlan } = get();
    if (!currentWorkoutDayPlan) return;

    const target = currentWorkoutDayPlan.items.find((item) => item.exercise_id === exerciseId);
    if (!target?.superset_group_id) return;

    const nextItems = currentWorkoutDayPlan.items.map((item) => (
      item.superset_group_id === target.superset_group_id
        ? { ...item, superset_group_id: null }
        : item
    ));

    const { data: updatedPlan, error: planError } = await supabase
      .from('workout_day_plans')
      .update({ items: nextItems })
      .eq('id', currentWorkoutDayPlan.id)
      .select('id, workout_id, day_label, items')
      .single();

    if (planError || !updatedPlan) {
      if (planError) console.error('Error clearing flexible superset:', planError);
      return;
    }

    set({
      currentWorkoutDayPlan: {
        id: updatedPlan.id,
        workout_id: updatedPlan.workout_id,
        day_label: updatedPlan.day_label,
        items: normalizeFlexiblePlanItems(updatedPlan.items),
      },
    });
  },

  updateFlexibleExerciseMeta: async (exerciseId, updates) => {
    const { currentWorkout, currentWorkoutDayPlan } = get();
    if (!currentWorkout || currentWorkout.split_day_id !== null || !currentWorkoutDayPlan) return;
    const workout = currentWorkout;

    const source = currentWorkoutDayPlan.items.find((item) => item.exercise_id === exerciseId);
    const sourceGroupId = source?.superset_group_id || null;
    const hasSetUpdate = typeof updates.target_sets === 'number' && Number.isFinite(updates.target_sets);

    const nextItems = currentWorkoutDayPlan.items.map((item) => {
      if (item.exercise_id === exerciseId) {
        const next = { ...item, ...updates };
        if (hasSetUpdate) {
          next.target_sets = normalizeTargetSets(updates.target_sets);
        }
        return next;
      }

      if (hasSetUpdate && sourceGroupId && item.superset_group_id === sourceGroupId) {
        return { ...item, target_sets: normalizeTargetSets(updates.target_sets) };
      }

      return item;
    });

    const { data: updatedPlan, error: planError } = await supabase
      .from('workout_day_plans')
      .update({ items: nextItems })
      .eq('id', currentWorkoutDayPlan.id)
      .select('id, workout_id, day_label, items')
      .single();

    if (planError || !updatedPlan) {
      if (planError) console.error('Error updating flexible exercise metadata:', planError);
      return;
    }

    if (hasSetUpdate) {
      const desiredSets = normalizeTargetSets(updates.target_sets);
      const affectedExerciseIds = sourceGroupId
        ? currentWorkoutDayPlan.items
            .filter((item) => item.superset_group_id === sourceGroupId)
            .map((item) => item.exercise_id)
        : [exerciseId];

      for (const affectedExerciseId of affectedExerciseIds) {
        const existingSets = workout.sets
          .filter((set) => set.exercise_id === affectedExerciseId)
          .sort((a, b) => a.set_number - b.set_number);

        if (existingSets.length < desiredSets) {
          for (let setNumber = existingSets.length + 1; setNumber <= desiredSets; setNumber += 1) {
            await supabase.from('sets').insert({
              workout_id: workout.id,
              exercise_id: affectedExerciseId,
              set_number: setNumber,
              completed: false,
            });
          }
        }

        if (existingSets.length > desiredSets) {
          const removable = existingSets
            .filter((set) => !set.completed)
            .sort((a, b) => b.set_number - a.set_number);

          for (const set of removable) {
            if (set.set_number <= desiredSets) break;
            await supabase.from('sets').delete().eq('id', set.id);
          }
        }
      }

      const { data: refreshedWorkout } = await supabase
        .from('workouts')
        .select('*, sets(*, exercise:exercises!exercise_id(*))')
        .eq('id', workout.id)
        .maybeSingle();

      if (refreshedWorkout) {
        set({ currentWorkout: refreshedWorkout as Workout });
      }
    }

    set({
      currentWorkoutDayPlan: {
        id: updatedPlan.id,
        workout_id: updatedPlan.workout_id,
        day_label: updatedPlan.day_label,
        items: normalizeFlexiblePlanItems(updatedPlan.items),
      },
    });
  },

  removeFlexibleExerciseFromPlan: async (exerciseId) => {
    const { currentWorkout, currentWorkoutDayPlan } = get();
    if (!currentWorkout || currentWorkout.split_day_id !== null || !currentWorkoutDayPlan) return;

    const removing = currentWorkoutDayPlan.items.find((item) => item.exercise_id === exerciseId);
    const removingGroupId = removing?.superset_group_id || null;

    const nextItems = currentWorkoutDayPlan.items.map((item) => {
      if (item.exercise_id === exerciseId) {
        return { ...item, hidden: true, superset_group_id: null };
      }

      if (removingGroupId && item.superset_group_id === removingGroupId) {
        return { ...item, superset_group_id: null };
      }

      return item;
    });

    const { data: updatedPlan, error: planError } = await supabase
      .from('workout_day_plans')
      .update({ items: nextItems })
      .eq('id', currentWorkoutDayPlan.id)
      .select('id, workout_id, day_label, items')
      .single();

    if (planError || !updatedPlan) {
      if (planError) console.error('Error removing flexible exercise from plan:', planError);
      return;
    }

    const uncompletedSetIds = currentWorkout.sets
      .filter((set) => set.exercise_id === exerciseId && !set.completed)
      .map((set) => set.id);

    if (uncompletedSetIds.length > 0) {
      await supabase.from('sets').delete().in('id', uncompletedSetIds);

      const { data: refreshedWorkout } = await supabase
        .from('workouts')
        .select('*, sets(*, exercise:exercises!exercise_id(*))')
        .eq('id', currentWorkout.id)
        .maybeSingle();

      if (refreshedWorkout) {
        set({ currentWorkout: refreshedWorkout as Workout });
      }
    }

    set({
      currentWorkoutDayPlan: {
        id: updatedPlan.id,
        workout_id: updatedPlan.workout_id,
        day_label: updatedPlan.day_label,
        items: normalizeFlexiblePlanItems(updatedPlan.items),
      },
    });
  },

  reorderFlexibleExercises: async (exerciseIds) => {
    const { currentWorkout, currentWorkoutDayPlan } = get();
    if (!currentWorkout || currentWorkout.split_day_id !== null || !currentWorkoutDayPlan) return;

    const orderedMap = new Map(exerciseIds.map((id, index) => [id, index]));

    const nextItems = [...currentWorkoutDayPlan.items]
      .sort((a, b) => {
        const orderA = orderedMap.get(a.exercise_id) ?? Number.MAX_SAFE_INTEGER;
        const orderB = orderedMap.get(b.exercise_id) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.order - b.order;
      })
      .map((item, index) => ({ ...item, order: index }));

    const { data: updatedPlan, error: planError } = await supabase
      .from('workout_day_plans')
      .update({ items: nextItems })
      .eq('id', currentWorkoutDayPlan.id)
      .select('id, workout_id, day_label, items')
      .single();

    if (planError || !updatedPlan) {
      if (planError) console.error('Error reordering flexible exercises:', planError);
      return;
    }

    set({
      currentWorkoutDayPlan: {
        id: updatedPlan.id,
        workout_id: updatedPlan.workout_id,
        day_label: updatedPlan.day_label,
        items: normalizeFlexiblePlanItems(updatedPlan.items),
      },
    });
  },

  saveFlexibleTemplateFromCurrentWorkout: async () => {
    const { currentWorkoutDayPlan, currentWorkout } = get();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !currentWorkoutDayPlan) return;

    const label = currentWorkoutDayPlan.day_label.trim();
    if (!label) return;

    const movementNotes = parseMovementNotesMap(currentWorkout?.notes || null);
    const itemsWithNotes = currentWorkoutDayPlan.items.map((item) => ({
      ...item,
      notes: movementNotes[item.exercise_id] ?? item.notes ?? null,
    }));

    const { error } = await supabase
      .from('flex_day_templates')
      .upsert({
        user_id: user.id,
        label,
        items: itemsWithNotes,
      }, {
        onConflict: 'user_id,label',
      });

    if (error) {
      console.error('Error saving flexible template:', error);
      return;
    }

    await get().fetchFlexTemplates();
  },

  removeLastUncompletedSet: async (exerciseId) => {
    const { currentWorkout } = get();
    if (!currentWorkout) return;

    const removableSet = currentWorkout.sets
      .filter((set) => set.exercise_id === exerciseId && !set.completed)
      .sort((a, b) => b.set_number - a.set_number)[0];

    if (!removableSet) return;

    const { error } = await supabase
      .from('sets')
      .delete()
      .eq('id', removableSet.id);

    if (error) {
      console.error('Error removing workout set:', error);
      return;
    }

    const latestWorkout = get().currentWorkout;
    if (!latestWorkout || latestWorkout.id !== currentWorkout.id) return;

    set({
      currentWorkout: {
        ...latestWorkout,
        sets: latestWorkout.sets.filter((set) => set.id !== removableSet.id),
      },
    });
  },

  logSet: async (exerciseId, setNumber, weight, reps, rpe) => {
    const { currentWorkout } = get();
    if (!currentWorkout) return;

    const { data: updatedSet, error } = await supabase
      .from('sets')
      .update({
        weight,
        reps,
        rpe: rpe || null,
        completed: true,
        completed_at: new Date().toISOString(),
      })
      .eq('workout_id', currentWorkout.id)
      .eq('exercise_id', exerciseId)
      .eq('set_number', setNumber)
      .select()
      .single();

    if (error) {
      console.error('Error logging set:', error);
      throw error;
    }

    if (updatedSet) {
      const latestWorkout = get().currentWorkout;
      if (!latestWorkout) return;

      const updatedSets = latestWorkout.sets.map(s =>
        s.exercise_id === exerciseId && s.set_number === setNumber
          ? {
              ...s,
              weight: updatedSet.weight,
              reps: updatedSet.reps,
              rpe: updatedSet.rpe,
              completed: updatedSet.completed,
              completed_at: updatedSet.completed_at,
            }
          : s
      );

      set({ currentWorkout: { ...latestWorkout, sets: updatedSets } });
    }
  },

  updateSet: async (setId, updates) => {
    const { currentWorkout } = get();
    if (!currentWorkout) return;

    await supabase.from('sets').update(updates).eq('id', setId);

    const updatedSets = currentWorkout.sets.map(s =>
      s.id === setId ? { ...s, ...updates } : s
    );
    set({ currentWorkout: { ...currentWorkout, sets: updatedSets } });
  },

  completeWorkout: async () => {
    const { currentWorkout } = get();
    if (!currentWorkout) return;

    await supabase
      .from('workouts')
      .update({ completed: true })
      .eq('id', currentWorkout.id);

    set({ currentWorkout: null, currentWorkoutDayPlan: null });
    await get().calculateWeeklyVolume();
  },

  fetchWorkoutsByMonth: async (month: Date) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const from = format(startOfMonth(month), 'yyyy-MM-dd');
    const to = format(endOfMonth(month), 'yyyy-MM-dd');

    const { data: workouts, error } = await supabase
      .from('workouts')
      .select(`
        *,
        sets (*, exercise:exercises!exercise_id (*))
      `)
      .eq('user_id', user.id)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching workouts by month:', error);
      return [];
    }

    return (workouts || []) as Workout[];
  },

  fetchWorkoutById: async (workoutId: string) => {
    const { data: workout, error } = await supabase
      .from('workouts')
      .select(`
        *,
        sets (*, exercise:exercises!exercise_id (*))
      `)
      .eq('id', workoutId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching workout by id:', error);
      return null;
    }

    return workout as Workout | null;
  },

  deleteWorkout: async (workoutId: string) => {
    // First delete all sets for this workout
    await supabase.from('sets').delete().eq('workout_id', workoutId);
    
    // Then delete the workout
    const { error } = await supabase.from('workouts').delete().eq('id', workoutId);
    
    if (error) {
      console.error('Error deleting workout:', error);
      throw error;
    }
  },

  fetchMacroTarget: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('macro_targets')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (data) {
      set({ macroTarget: data });
    }
  },

  updateMacroTarget: async (target) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('macro_targets')
      .upsert({
        user_id: user.id,
        ...target,
      }, {
        onConflict: 'user_id',
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    if (data) {
      set({ macroTarget: data });
    }
  },

  fetchVolumeLandmarks: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('volume_landmarks')
      .select('*')
      .eq('user_id', user.id);

    if (data) {
      set({ volumeLandmarks: data });
    }
  },

  updateVolumeLandmark: async (muscleGroup, updates) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('volume_landmarks')
      .upsert({
        user_id: user.id,
        muscle_group: muscleGroup,
        ...updates,
      });

    await get().fetchVolumeLandmarks();
    await get().calculateWeeklyVolume();
  },

  calculateWeeklyVolume: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const weekStart = format(startOfWeek(new Date()), 'yyyy-MM-dd');
    const weekEnd = format(endOfWeek(new Date()), 'yyyy-MM-dd');

    // Get all completed sets from this week, regardless of whether
    // the parent workout was explicitly marked complete.
    const { data: workouts } = await supabase
      .from('workouts')
      .select(`
        *,
        sets!inner (
          exercise_id,
          completed,
          exercise:exercises (muscle_group, muscle_group_secondary)
        )
      `)
      .eq('user_id', user.id)
      .eq('sets.completed', true)
      .gte('date', weekStart)
      .lte('date', weekEnd);

    if (!workouts) return;

    // Calculate volume per muscle group
    const volumeMap = new Map<MuscleGroup, number>();
    
    type CompletedSetRow = {
      exercise: {
        muscle_group: MuscleGroup;
        muscle_group_secondary: MuscleGroup | null;
      };
      completed: boolean;
    };

    for (const workout of workouts) {
      const workoutSets = workout.sets as CompletedSetRow[];

      for (const set of workoutSets) {
        if (!set.completed || !set.exercise) continue;

        const primaryMuscle = set.exercise.muscle_group;
        const secondaryMuscle = set.exercise.muscle_group_secondary;

        volumeMap.set(primaryMuscle, (volumeMap.get(primaryMuscle) ?? 0) + 1);
        if (secondaryMuscle) {
          volumeMap.set(secondaryMuscle, (volumeMap.get(secondaryMuscle) ?? 0) + 0.5);
        }
      }
    }

    const { volumeLandmarks } = get();
    const weeklyVolume: MuscleVolume[] = [];

    for (const [muscle_group, weekly_sets] of volumeMap) {
      const landmark = volumeLandmarks.find(l => l.muscle_group === muscle_group);
      
      let status: MuscleVolume['status'] = 'below_mev';
      if (landmark) {
        if (weekly_sets < landmark.mev) status = 'below_mev';
        else if (weekly_sets < landmark.mav_low) status = 'mev_mav';
        else if (weekly_sets <= landmark.mav_high) status = 'mav';
        else if (weekly_sets < landmark.mrv) status = 'approaching_mrv';
        else status = 'above_mrv';
      }

      weeklyVolume.push({ muscle_group, weekly_sets, landmark, status });
    }

    set({ weeklyVolume });
  },
}));
