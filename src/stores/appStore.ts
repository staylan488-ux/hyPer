import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { isPreviewActive } from '@/preview/flag';
import { fetchWhoopFixtureBatch } from '@/preview/whoopFixtures';
import { fetchStravaFixtureBatch } from '@/preview/stravaFixtures';
import { runWhoopSync, type WhoopSyncResult } from '@/lib/whoopSync';
import { runStravaSync, type StravaSyncResult } from '@/lib/stravaSync';
import { disconnectWhoopRemote, fetchWhoopBatchRemote, startWhoopConnect } from '@/lib/whoopClient';
import { disconnectStravaRemote, fetchStravaBatchRemote, startStravaConnect } from '@/lib/stravaClient';
import { findAbsorbableWhoopSession } from '@/lib/whoopImport';
import { finishedRunToActivity, type FinishedRun } from '@/lib/runTracker';
import { parseWorkoutNotes } from '@/lib/workoutNotes';
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
  ActivitySession,
  ActivitySessionInput,
  ActivitySegment,
  ActivitySegmentInput,
  WhoopConnection,
  StravaConnection,
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

function normalizeWorkoutPlanItems(items: FlexiblePlanItem[]): FlexiblePlanItem[] {
  return items
    .map((item, index) => ({
      ...item,
      order: Number.isFinite(item.order) ? item.order : index,
      target_sets: normalizeTargetSets(item.target_sets),
      target_reps_min: typeof item.target_reps_min === 'number' ? item.target_reps_min : 8,
      target_reps_max: typeof item.target_reps_max === 'number' ? item.target_reps_max : 12,
      notes: item.notes ?? null,
      hidden: Boolean(item.hidden),
      superset_group_id: item.superset_group_id ?? null,
    }))
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
}

function randomSupersetGroupId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveWorkoutCompletedAt(
  sets: Array<Pick<WorkoutSet, 'completed' | 'completed_at'>>,
  fallback = new Date().toISOString(),
): string {
  const latestCompletedAt = sets
    .filter((set) => set.completed && typeof set.completed_at === 'string')
    .map((set) => new Date(set.completed_at as string).getTime())
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((a, b) => b - a)[0];

  if (!latestCompletedAt) return fallback;
  return new Date(latestCompletedAt).toISOString();
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
  addSetToWorkout: (workoutId: string, exerciseId: string) => Promise<WorkoutSet | null>;
  removeSetFromWorkout: (workoutId: string, exerciseId: string, setId: string) => Promise<void>;
  addExerciseToWorkout: (workoutId: string, exercise: Exercise) => Promise<WorkoutSet | null>;
  removeExerciseFromWorkout: (workoutId: string, exerciseId: string) => Promise<void>;
  syncWorkoutCompletion: (workoutId: string) => Promise<{ totalSets: number; completedSets: number; completed: boolean }>;
  updateWorkoutNotes: (workoutId: string, notes: string | null) => Promise<void>;
  fetchWorkoutDayPlanByWorkoutId: (workoutId: string) => Promise<WorkoutDayPlan | null>;
  ensureWorkoutDayPlan: (workoutId: string, fallbackLabel?: string) => Promise<WorkoutDayPlan | null>;
  updateWorkoutDayPlanItems: (workoutId: string, items: FlexiblePlanItem[]) => Promise<WorkoutDayPlan | null>;
  addSupersetToWorkout: (workoutId: string, baseExerciseId: string, partner: Exercise) => Promise<void>;
  clearWorkoutSuperset: (workoutId: string, exerciseId: string) => Promise<void>;
  updateWorkoutExerciseTargetSets: (workoutId: string, exerciseId: string, targetSets: number) => Promise<void>;
  reorderWorkoutExercises: (workoutId: string, exerciseIds: string[]) => Promise<void>;

  // Activity actions
  fetchActivitySessionsByMonth: (month: Date) => Promise<ActivitySession[]>;
  createActivitySession: (input: ActivitySessionInput) => Promise<ActivitySession | null>;
  updateActivitySession: (activityId: string, updates: Partial<ActivitySessionInput>) => Promise<ActivitySession | null>;
  deleteActivitySession: (activityId: string) => Promise<void>;
  fetchActivitySegmentsBySessionIds: (sessionIds: string[]) => Promise<ActivitySegment[]>;
  upsertActivitySegments: (inputs: ActivitySegmentInput[]) => Promise<ActivitySegment[]>;
  syncWhoop: () => Promise<WhoopSyncResult | null>;
  whoopConnection: WhoopConnection | null;
  fetchWhoopConnection: () => Promise<WhoopConnection | null>;
  // returns a consent URL to redirect to (production) or null (preview: mock-connects in place)
  connectWhoop: () => Promise<string | null>;
  disconnectWhoop: () => Promise<void>;
  syncStrava: () => Promise<StravaSyncResult | null>;
  stravaConnection: StravaConnection | null;
  fetchStravaConnection: () => Promise<StravaConnection | null>;
  connectStrava: () => Promise<string | null>;
  disconnectStrava: () => Promise<void>;
  saveTrackedRun: (run: FinishedRun) => Promise<ActivitySession | null>;

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
  whoopConnection: null,
  stravaConnection: null,

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

    // Resume the latest in-progress workout even if it started before midnight.
    const { data: existing, error: existingError } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('user_id', user.id)
      .eq('completed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking existing workout:', existingError);
    }

    if (existing) {
      set({ currentWorkout: existing as Workout, currentWorkoutDayPlan: null });
      return existing as Workout;
    }

    const today = format(new Date(), 'yyyy-MM-dd');

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

    const { data: existing, error: existingError } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('user_id', user.id)
      .eq('completed', false)
      .order('created_at', { ascending: false })
      .limit(1)
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

    const today = format(new Date(), 'yyyy-MM-dd');

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

    const { data: workout, error } = await supabase
      .from('workouts')
      .select('*, sets(*, exercise:exercises!exercise_id(*))')
      .eq('user_id', user.id)
      .eq('completed', false)
      .order('created_at', { ascending: false })
      .limit(1)
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

    const movementNotes = parseWorkoutNotes(currentWorkout?.notes || null).movementNotes;
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
    const { error } = await supabase.from('sets').update(updates).eq('id', setId);
    if (error) {
      console.error('Error updating set:', error);
      return;
    }

    const { currentWorkout } = get();
    if (!currentWorkout) return;
    if (!currentWorkout.sets.some((set) => set.id === setId)) return;

    const updatedSets = currentWorkout.sets.map((set) => (
      set.id === setId ? { ...set, ...updates } : set
    ));

    set({ currentWorkout: { ...currentWorkout, sets: updatedSets } });
  },

  completeWorkout: async () => {
    const { currentWorkout } = get();
    if (!currentWorkout) return;

    const completedAt = resolveWorkoutCompletedAt(currentWorkout.sets);

    await supabase
      .from('workouts')
      .update({ completed: true, completed_at: completedAt })
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
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

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

  fetchActivitySessionsByMonth: async (month: Date) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const from = format(startOfMonth(month), 'yyyy-MM-dd');
    const to = format(endOfMonth(month), 'yyyy-MM-dd');

    const { data, error } = await supabase
      .from('activity_sessions')
      .select('*')
      .eq('user_id', user.id)
      .is('dismissed_at', null)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('started_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching activity sessions by month:', error);
      return [];
    }

    return (data || []) as ActivitySession[];
  },

  createActivitySession: async (input) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('activity_sessions')
      .insert({
        user_id: user.id,
        activity_type: input.activity_type,
        title: input.title ?? null,
        date: input.date,
        started_at: input.started_at ?? null,
        ended_at: input.ended_at ?? null,
        duration_seconds: input.duration_seconds ?? null,
        source: input.source ?? 'manual',
        notes: input.notes ?? null,
        strain: input.strain ?? null,
        avg_hr: input.avg_hr ?? null,
        max_hr: input.max_hr ?? null,
        energy_kcal: input.energy_kcal ?? null,
        distance_m: input.distance_m ?? null,
        auto_grouped: input.auto_grouped ?? false,
        user_edited: input.user_edited ?? false,
        dismissed_at: input.dismissed_at ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      if (error) console.error('Error creating activity session:', error);
      return null;
    }

    return data as ActivitySession;
  },

  updateActivitySession: async (activityId, updates) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('activity_sessions')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activityId)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error || !data) {
      if (error) console.error('Error updating activity session:', error);
      return null;
    }

    return data as ActivitySession;
  },

  deleteActivitySession: async (activityId) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('activity_sessions')
      .delete()
      .eq('id', activityId)
      .eq('user_id', user.id);

    if (error) {
      console.error('Error deleting activity session:', error);
      throw error;
    }
  },

  fetchActivitySegmentsBySessionIds: async (sessionIds) => {
    if (sessionIds.length === 0) return [];

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('activity_segments')
      .select('*')
      .eq('user_id', user.id)
      .in('session_id', sessionIds)
      .order('started_at', { ascending: true });

    if (error) {
      console.error('Error fetching activity segments:', error);
      return [];
    }

    return (data || []) as ActivitySegment[];
  },

  upsertActivitySegments: async (inputs) => {
    if (inputs.length === 0) return [];

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // session_id is deliberately omitted: on conflict the upsert would null out
    // existing links and every re-sync would churn sessions. Linkage is owned
    // exclusively by linkSegmentsToSession-style updates
    const rows = inputs.map((input) => ({
      user_id: user.id,
      source: input.source,
      external_id: input.external_id,
      sport: input.sport ?? null,
      started_at: input.started_at,
      ended_at: input.ended_at,
      duration_seconds: input.duration_seconds ?? null,
      strain: input.strain ?? null,
      avg_hr: input.avg_hr ?? null,
      max_hr: input.max_hr ?? null,
      energy_kcal: input.energy_kcal ?? null,
      distance_m: input.distance_m ?? null,
      raw: input.raw ?? null,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('activity_segments')
      .upsert(rows, { onConflict: 'user_id,source,external_id' })
      .select();

    if (error) {
      console.error('Error upserting activity segments:', error);
      return [];
    }

    return (data || []) as ActivitySegment[];
  },

  fetchWhoopConnection: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching whoop connection:', error);
      return null;
    }

    const connection = (data as WhoopConnection | null) ?? null;
    set({ whoopConnection: connection });
    return connection;
  },

  connectWhoop: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    if (isPreviewActive()) {
      // sandbox: connecting just plants a mock metadata row
      const nowIso = new Date().toISOString();
      await supabase.from('whoop_connections').upsert(
        {
          user_id: user.id,
          whoop_user_id: 'preview-whoop-user',
          scopes: 'read:workout offline',
          connected_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' },
      );
      await get().fetchWhoopConnection();
      return null;
    }

    return startWhoopConnect();
  },

  disconnectWhoop: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (isPreviewActive()) {
      await supabase.from('whoop_connections').delete().eq('user_id', user.id);
    } else {
      await disconnectWhoopRemote();
    }
    set({ whoopConnection: null });
  },

  syncWhoop: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // preview drives the identical pipeline from fixture batches; production
    // fetches raw pages through the whoop-sync Edge Function
    const fetchBatch = isPreviewActive() ? fetchWhoopFixtureBatch : fetchWhoopBatchRemote;

    // watermark: newest whoop segment already imported
    const { data: latest } = await supabase
      .from('activity_segments')
      .select('started_at')
      .eq('user_id', user.id)
      .eq('source', 'whoop')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    try {
      const result = await runWhoopSync(
        {
          fetchBatch,
          data: {
            upsertSegments: (inputs) => get().upsertActivitySegments(inputs),
            fetchWhoopSegmentsInWindow: async (fromIso, toIso) => {
              const { data, error } = await supabase
                .from('activity_segments')
                .select('*')
                .eq('user_id', user.id)
                .eq('source', 'whoop')
                .gte('started_at', fromIso)
                .lte('started_at', toIso)
                .order('started_at', { ascending: true });
              if (error) {
                console.error('Error fetching whoop segments:', error);
                return [];
              }
              return (data || []) as ActivitySegment[];
            },
            fetchSessionsInWindow: async (fromIso, toIso) => {
              // deliberately includes dismissed + user-edited rows (tombstones
              // must hold) and ALL sources (whoop metrics enrich gps/strava/
              // manual sessions covering the same time window)
              const { data, error } = await supabase
                .from('activity_sessions')
                .select('*')
                .eq('user_id', user.id)
                .gte('started_at', fromIso)
                .lte('started_at', toIso);
              if (error) {
                console.error('Error fetching sessions in window:', error);
                return [];
              }
              return (data || []) as ActivitySession[];
            },
            createSession: (input) => get().createActivitySession(input),
            updateSession: (sessionId, patch) => get().updateActivitySession(sessionId, patch),
            deleteSession: (sessionId) => get().deleteActivitySession(sessionId),
            linkSegmentsToSession: async (segmentIds, sessionId) => {
              const { error } = await supabase
                .from('activity_segments')
                .update({ session_id: sessionId, updated_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .in('id', segmentIds);
              if (error) console.error('Error linking segments to session:', error);
            },
          },
        },
        { sinceIso: (latest as { started_at?: string } | null)?.started_at ?? null },
      );

      // whoop-sync stamps last_synced_at server-side; refresh the status row
      if (!isPreviewActive()) void get().fetchWhoopConnection();
      return result;
    } catch (error) {
      console.error('Error running whoop sync:', error);
      return null;
    }
  },

  fetchStravaConnection: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('strava_connections')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching strava connection:', error);
      return null;
    }

    const connection = (data as StravaConnection | null) ?? null;
    set({ stravaConnection: connection });
    return connection;
  },

  connectStrava: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    if (isPreviewActive()) {
      const nowIso = new Date().toISOString();
      await supabase.from('strava_connections').upsert(
        {
          user_id: user.id,
          strava_athlete_id: 'preview-strava-athlete',
          scopes: 'read,activity:read_all',
          connected_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' },
      );
      await get().fetchStravaConnection();
      return null;
    }

    return startStravaConnect();
  },

  disconnectStrava: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (isPreviewActive()) {
      await supabase.from('strava_connections').delete().eq('user_id', user.id);
    } else {
      await disconnectStravaRemote();
    }
    set({ stravaConnection: null });
  },

  syncStrava: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const fetchBatch = isPreviewActive() ? fetchStravaFixtureBatch : fetchStravaBatchRemote;

    // watermark: newest strava segment already imported
    const { data: latest } = await supabase
      .from('activity_segments')
      .select('started_at')
      .eq('user_id', user.id)
      .eq('source', 'strava')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    try {
      const result = await runStravaSync(
        {
          fetchBatch,
          data: {
            upsertSegments: (inputs) => get().upsertActivitySegments(inputs),
            fetchStravaSegmentsInWindow: async (fromIso, toIso) => {
              const { data, error } = await supabase
                .from('activity_segments')
                .select('*')
                .eq('user_id', user.id)
                .eq('source', 'strava')
                .gte('started_at', fromIso)
                .lte('started_at', toIso)
                .order('started_at', { ascending: true });
              if (error) {
                console.error('Error fetching strava segments:', error);
                return [];
              }
              return (data || []) as ActivitySegment[];
            },
            fetchSessionsInWindow: async (fromIso, toIso) => {
              const { data, error } = await supabase
                .from('activity_sessions')
                .select('*')
                .eq('user_id', user.id)
                .gte('started_at', fromIso)
                .lte('started_at', toIso);
              if (error) {
                console.error('Error fetching sessions in window:', error);
                return [];
              }
              return (data || []) as ActivitySession[];
            },
            createSession: (input) => get().createActivitySession(input),
            updateSession: (sessionId, patch) => get().updateActivitySession(sessionId, patch),
            deleteSession: (sessionId) => get().deleteActivitySession(sessionId),
            linkSegmentsToSession: async (segmentIds, sessionId) => {
              const { error } = await supabase
                .from('activity_segments')
                .update({ session_id: sessionId, updated_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .in('id', segmentIds);
              if (error) console.error('Error linking segments to session:', error);
            },
            relinkSessionSegments: async (fromSessionId, toSessionId) => {
              const { error } = await supabase
                .from('activity_segments')
                .update({ session_id: toSessionId, updated_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .eq('session_id', fromSessionId);
              if (error) console.error('Error relinking session segments:', error);
            },
          },
        },
        { sinceIso: (latest as { started_at?: string } | null)?.started_at ?? null },
      );

      if (!isPreviewActive()) void get().fetchStravaConnection();
      return result;
    } catch (error) {
      console.error('Error running strava sync:', error);
      return null;
    }
  },

  saveTrackedRun: async (run) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { session: sessionInput, segments: segmentInputs } = finishedRunToActivity(run, run.runId);

    const session = await get().createActivitySession(sessionInput);
    if (!session) return null;

    // segment external_ids are stable per run, so a retried save upserts
    // rather than duplicating splits
    const segments = await get().upsertActivitySegments(segmentInputs);
    if (segments.length > 0) {
      const { error } = await supabase
        .from('activity_segments')
        .update({ session_id: session.id, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .in('id', segments.map((segment) => segment.id));
      if (error) console.error('Error linking run segments:', error);
    }

    // cross-source merge: if WHOOP already auto-imported this same run, absorb
    // it — its segments and strain/HR/kcal move onto the recording we just made
    if (session.started_at && session.ended_at) {
      const { data: windowSessions } = await supabase
        .from('activity_sessions')
        .select('*')
        .eq('user_id', user.id)
        .gte('started_at', new Date(Date.parse(session.started_at) - 6 * 60 * 60 * 1000).toISOString())
        .lte('started_at', session.ended_at);

      const absorbable = findAbsorbableWhoopSession(
        session.started_at,
        session.ended_at,
        (windowSessions || []) as ActivitySession[],
      );

      if (absorbable) {
        await supabase
          .from('activity_segments')
          .update({ session_id: session.id, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .eq('session_id', absorbable.id);

        const enriched = await get().updateActivitySession(session.id, {
          strain: absorbable.strain,
          avg_hr: absorbable.avg_hr,
          max_hr: absorbable.max_hr,
          energy_kcal: absorbable.energy_kcal,
        });
        await get().deleteActivitySession(absorbable.id);
        return enriched ?? session;
      }
    }

    return session;
  },

  addSetToWorkout: async (workoutId, exerciseId) => {
    const { data: existingSets, error: fetchError } = await supabase
      .from('sets')
      .select('set_number')
      .eq('workout_id', workoutId)
      .eq('exercise_id', exerciseId)
      .order('set_number', { ascending: true });

    if (fetchError) {
      console.error('Error fetching existing sets:', fetchError);
      return null;
    }

    const nextSetNumber = existingSets && existingSets.length > 0
      ? Math.max(...existingSets.map((set) => Number(set.set_number) || 0)) + 1
      : 1;

    const { data: createdSet, error } = await supabase
      .from('sets')
      .insert({
        workout_id: workoutId,
        exercise_id: exerciseId,
        set_number: nextSetNumber,
        completed: false,
      })
      .select('*, exercise:exercises!exercise_id(*)')
      .single();

    if (error || !createdSet) {
      if (error) console.error('Error adding set to workout:', error);
      return null;
    }

    const { currentWorkout } = get();
    if (currentWorkout?.id === workoutId) {
      set({
        currentWorkout: {
          ...currentWorkout,
          sets: [...currentWorkout.sets, createdSet as WorkoutSet],
        },
      });
    }

    return createdSet as WorkoutSet;
  },

  removeSetFromWorkout: async (workoutId, exerciseId, setId) => {
    const { error: deleteError } = await supabase
      .from('sets')
      .delete()
      .eq('id', setId)
      .eq('workout_id', workoutId)
      .eq('exercise_id', exerciseId);

    if (deleteError) {
      console.error('Error removing set from workout:', deleteError);
      return;
    }

    const { data: remainingSets, error: remainingError } = await supabase
      .from('sets')
      .select('id, set_number')
      .eq('workout_id', workoutId)
      .eq('exercise_id', exerciseId)
      .order('set_number', { ascending: true });

    if (remainingError) {
      console.error('Error fetching remaining sets for compaction:', remainingError);
      return;
    }

    for (const [index, row] of (remainingSets || []).entries()) {
      const desiredSetNumber = index + 1;
      if ((row.set_number as number) === desiredSetNumber) continue;

      const { error: renumberError } = await supabase
        .from('sets')
        .update({ set_number: desiredSetNumber })
        .eq('id', row.id);

      if (renumberError) {
        console.error('Error compacting set numbers:', renumberError);
      }
    }

    const { currentWorkout } = get();
    if (currentWorkout?.id !== workoutId) return;

    const otherExerciseSets = currentWorkout.sets.filter((set) => set.exercise_id !== exerciseId);
    const compactedExerciseSets = currentWorkout.sets
      .filter((set) => set.exercise_id === exerciseId && set.id !== setId)
      .sort((a, b) => a.set_number - b.set_number)
      .map((set, index) => ({ ...set, set_number: index + 1 }));

    set({
      currentWorkout: {
        ...currentWorkout,
        sets: [...otherExerciseSets, ...compactedExerciseSets],
      },
    });
  },

  addExerciseToWorkout: async (workoutId, exercise) => {
    const createdSet = await get().addSetToWorkout(workoutId, exercise.id);
    if (!createdSet) return null;

    const plan = await get().ensureWorkoutDayPlan(workoutId);
    if (!plan) return createdSet;

    const existing = plan.items.find((item) => item.exercise_id === exercise.id);
    const nextItems = existing
      ? plan.items.map((item) => (
          item.exercise_id === exercise.id
            ? {
                ...item,
                hidden: false,
                exercise_name: exercise.name,
                target_sets: item.target_sets ?? 1,
              }
            : item
        ))
      : [
          ...plan.items,
          {
            exercise_id: exercise.id,
            exercise_name: exercise.name,
            order: plan.items.length,
            target_sets: 1,
            target_reps_min: 8,
            target_reps_max: 12,
            notes: null,
            hidden: false,
            superset_group_id: null,
          },
        ];

    await get().updateWorkoutDayPlanItems(workoutId, nextItems);
    return createdSet;
  },

  removeExerciseFromWorkout: async (workoutId, exerciseId) => {
    const { error } = await supabase
      .from('sets')
      .delete()
      .eq('workout_id', workoutId)
      .eq('exercise_id', exerciseId);

    if (error) {
      console.error('Error removing exercise from workout:', error);
      return;
    }

    const plan = await get().fetchWorkoutDayPlanByWorkoutId(workoutId);
    if (plan) {
      const removing = plan.items.find((item) => item.exercise_id === exerciseId);
      const removingGroupId = removing?.superset_group_id || null;

      const nextItems = plan.items.map((item) => {
        if (item.exercise_id === exerciseId) {
          return { ...item, hidden: true, superset_group_id: null };
        }

        if (removingGroupId && item.superset_group_id === removingGroupId) {
          return { ...item, superset_group_id: null };
        }

        return item;
      });

      await get().updateWorkoutDayPlanItems(workoutId, nextItems);
    }

    const { currentWorkout } = get();
    if (currentWorkout?.id === workoutId) {
      set({
        currentWorkout: {
          ...currentWorkout,
          sets: currentWorkout.sets.filter((set) => set.exercise_id !== exerciseId),
        },
      });
    }
  },

  syncWorkoutCompletion: async (workoutId) => {
    const { data: sets, error } = await supabase
      .from('sets')
      .select('id, completed, completed_at')
      .eq('workout_id', workoutId);

    if (error) {
      console.error('Error syncing workout completion:', error);
      return { totalSets: 0, completedSets: 0, completed: false };
    }

    const totalSets = (sets || []).length;
    const completedSets = (sets || []).filter((set) => Boolean(set.completed)).length;
    const completed = totalSets > 0 && completedSets === totalSets;
    const completedAt = completed
      ? resolveWorkoutCompletedAt((sets || []) as Array<Pick<WorkoutSet, 'completed' | 'completed_at'>>)
      : null;

    const { error: updateError } = await supabase
      .from('workouts')
      .update({ completed, completed_at: completedAt })
      .eq('id', workoutId);

    if (updateError) {
      console.error('Error persisting workout completion state:', updateError);
    }

    const { currentWorkout } = get();
    if (currentWorkout?.id === workoutId) {
      set({ currentWorkout: { ...currentWorkout, completed, completed_at: completedAt } });
    }

    return { totalSets, completedSets, completed };
  },

  updateWorkoutNotes: async (workoutId, notes) => {
    const { error } = await supabase
      .from('workouts')
      .update({ notes })
      .eq('id', workoutId);

    if (error) {
      console.error('Error updating workout notes:', error);
      return;
    }

    const { currentWorkout } = get();
    if (currentWorkout?.id === workoutId) {
      set({ currentWorkout: { ...currentWorkout, notes } });
    }
  },

  fetchWorkoutDayPlanByWorkoutId: async (workoutId) => {
    const { data, error } = await supabase
      .from('workout_day_plans')
      .select('id, workout_id, day_label, items')
      .eq('workout_id', workoutId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching workout day plan by workout id:', error);
      return null;
    }

    if (!data) return null;

    const plan: WorkoutDayPlan = {
      id: data.id,
      workout_id: data.workout_id,
      day_label: data.day_label,
      items: normalizeFlexiblePlanItems(data.items),
    };

    const { currentWorkoutDayPlan, currentWorkout } = get();
    if (currentWorkout?.id === workoutId && currentWorkoutDayPlan?.id !== plan.id) {
      set({ currentWorkoutDayPlan: plan });
    }

    return plan;
  },

  ensureWorkoutDayPlan: async (workoutId, fallbackLabel) => {
    const existing = await get().fetchWorkoutDayPlanByWorkoutId(workoutId);
    if (existing) return existing;

    const { data: workout, error: workoutError } = await supabase
      .from('workouts')
      .select('id, split_day_id')
      .eq('id', workoutId)
      .maybeSingle();

    if (workoutError || !workout) {
      if (workoutError) console.error('Error fetching workout for day plan creation:', workoutError);
      return null;
    }

    const { data: workoutSets, error: setsError } = await supabase
      .from('sets')
      .select('exercise_id, set_number, exercise:exercises!exercise_id(id, name)')
      .eq('workout_id', workoutId)
      .order('set_number', { ascending: true });

    if (setsError) {
      console.error('Error fetching workout sets for day plan creation:', setsError);
      return null;
    }

    const setCountByExercise = new Map<string, number>();
    const setExerciseNames = new Map<string, string>();
    for (const row of workoutSets || []) {
      const exerciseId = row.exercise_id as string;
      setCountByExercise.set(exerciseId, (setCountByExercise.get(exerciseId) || 0) + 1);
      const exercise = row.exercise as { name?: string } | null;
      if (exercise?.name) {
        setExerciseNames.set(exerciseId, exercise.name);
      }
    }

    const splitDayId = (workout.split_day_id as string | null) ?? null;
    let dayLabel = fallbackLabel?.trim() || 'Workout';
    let splitExerciseRows: Array<{
      exercise_id: string;
      target_sets: number | null;
      target_reps_min: number | null;
      target_reps_max: number | null;
      notes: string | null;
      exercise_order: number;
      superset_group_id: string | null;
      exercise: { name?: string } | null;
    }> = [];

    if (splitDayId) {
      const { data: splitDayRow } = await supabase
        .from('split_days')
        .select('day_name')
        .eq('id', splitDayId)
        .maybeSingle();

      if (splitDayRow?.day_name) {
        dayLabel = splitDayRow.day_name;
      }

      const { data: splitExercises, error: splitError } = await supabase
        .from('split_exercises')
        .select('exercise_id, target_sets, target_reps_min, target_reps_max, notes, exercise_order, superset_group_id, exercise:exercises!exercise_id(name)')
        .eq('split_day_id', splitDayId)
        .order('exercise_order', { ascending: true });

      if (splitError) {
        console.error('Error fetching split exercise metadata for day plan creation:', splitError);
      } else {
        splitExerciseRows = (splitExercises || []) as typeof splitExerciseRows;
      }
    }

    const orderedExerciseIds: string[] = [];
    const splitExerciseById = new Map(splitExerciseRows.map((row) => [row.exercise_id, row]));

    for (const row of splitExerciseRows) {
      if (!orderedExerciseIds.includes(row.exercise_id)) {
        orderedExerciseIds.push(row.exercise_id);
      }
    }

    for (const row of workoutSets || []) {
      const exerciseId = row.exercise_id as string;
      if (!orderedExerciseIds.includes(exerciseId)) {
        orderedExerciseIds.push(exerciseId);
      }
    }

    const items: FlexiblePlanItem[] = orderedExerciseIds.map((exerciseId, index) => {
      const splitMeta = splitExerciseById.get(exerciseId);
      const splitExerciseName = splitMeta?.exercise?.name || null;
      const setCount = setCountByExercise.get(exerciseId) || 0;

      return {
        exercise_id: exerciseId,
        exercise_name: splitExerciseName || setExerciseNames.get(exerciseId) || null,
        order: index,
        target_sets: normalizeTargetSets(splitMeta?.target_sets ?? (setCount > 0 ? setCount : 1)),
        target_reps_min: splitMeta?.target_reps_min ?? 8,
        target_reps_max: splitMeta?.target_reps_max ?? 12,
        notes: splitMeta?.notes ?? null,
        hidden: false,
        superset_group_id: splitMeta?.superset_group_id ?? null,
      };
    });

    const { data: createdPlan, error: createError } = await supabase
      .from('workout_day_plans')
      .insert({
        workout_id: workoutId,
        day_label: dayLabel,
        items: normalizeWorkoutPlanItems(items),
      })
      .select('id, workout_id, day_label, items')
      .single();

    if (createError || !createdPlan) {
      if (createError) console.error('Error creating workout day plan:', createError);
      return null;
    }

    return {
      id: createdPlan.id,
      workout_id: createdPlan.workout_id,
      day_label: createdPlan.day_label,
      items: normalizeFlexiblePlanItems(createdPlan.items),
    };
  },

  updateWorkoutDayPlanItems: async (workoutId, items) => {
    const existingPlan = await get().ensureWorkoutDayPlan(workoutId);
    if (!existingPlan) return null;

    const normalizedItems = normalizeWorkoutPlanItems(items);

    const { data: updatedPlan, error } = await supabase
      .from('workout_day_plans')
      .update({ items: normalizedItems })
      .eq('id', existingPlan.id)
      .select('id, workout_id, day_label, items')
      .single();

    if (error || !updatedPlan) {
      if (error) console.error('Error updating workout day plan items:', error);
      return null;
    }

    const nextPlan: WorkoutDayPlan = {
      id: updatedPlan.id,
      workout_id: updatedPlan.workout_id,
      day_label: updatedPlan.day_label,
      items: normalizeFlexiblePlanItems(updatedPlan.items),
    };

    const { currentWorkout, currentWorkoutDayPlan } = get();
    if (currentWorkout?.id === workoutId && currentWorkoutDayPlan?.id === existingPlan.id) {
      set({ currentWorkoutDayPlan: nextPlan });
    }

    return nextPlan;
  },

  addSupersetToWorkout: async (workoutId, baseExerciseId, partner) => {
    const plan = await get().ensureWorkoutDayPlan(workoutId);
    if (!plan) return;

    const baseIndex = plan.items.findIndex((item) => !item.hidden && item.exercise_id === baseExerciseId);
    if (baseIndex < 0) return;
    if (plan.items.some((item) => !item.hidden && item.exercise_id === partner.id)) return;

    const baseItem = plan.items[baseIndex];
    if (baseItem.superset_group_id) {
      const members = plan.items.filter((item) => !item.hidden && item.superset_group_id === baseItem.superset_group_id);
      if (members.length >= 2) return;
    }

    const groupId = baseItem.superset_group_id || randomSupersetGroupId();
    const nextItems = [...plan.items].map((item) => (
      item.exercise_id === baseExerciseId
        ? { ...item, superset_group_id: groupId }
        : item
    ));

    const partnerItem: FlexiblePlanItem = {
      exercise_id: partner.id,
      exercise_name: partner.name,
      order: (baseItem.order ?? baseIndex) + 1,
      target_sets: normalizeTargetSets(baseItem.target_sets ?? 1),
      target_reps_min: baseItem.target_reps_min ?? 8,
      target_reps_max: baseItem.target_reps_max ?? 12,
      notes: null,
      hidden: false,
      superset_group_id: groupId,
    };

    nextItems.splice(baseIndex + 1, 0, partnerItem);
    await get().updateWorkoutDayPlanItems(workoutId, nextItems);

    const { data: existingSets, error: existingError } = await supabase
      .from('sets')
      .select('id')
      .eq('workout_id', workoutId)
      .eq('exercise_id', partner.id);

    if (existingError) {
      console.error('Error checking partner exercise sets:', existingError);
      return;
    }

    if ((existingSets || []).length > 0) return;

    const targetSets = normalizeTargetSets(partnerItem.target_sets);
    const rows = Array.from({ length: targetSets }, (_, index) => ({
      workout_id: workoutId,
      exercise_id: partner.id,
      set_number: index + 1,
      completed: false,
    }));

    const { data: createdSets, error: createSetsError } = await supabase
      .from('sets')
      .insert(rows)
      .select('*, exercise:exercises!exercise_id(*)');

    if (createSetsError) {
      console.error('Error creating partner exercise sets for superset:', createSetsError);
      return;
    }

    const { currentWorkout } = get();
    if (currentWorkout?.id === workoutId && createdSets) {
      set({
        currentWorkout: {
          ...currentWorkout,
          sets: [...currentWorkout.sets, ...(createdSets as WorkoutSet[])],
        },
      });
    }
  },

  clearWorkoutSuperset: async (workoutId, exerciseId) => {
    const plan = await get().fetchWorkoutDayPlanByWorkoutId(workoutId);
    if (!plan) return;

    const target = plan.items.find((item) => item.exercise_id === exerciseId);
    if (!target?.superset_group_id) return;

    const nextItems = plan.items.map((item) => (
      item.superset_group_id === target.superset_group_id
        ? { ...item, superset_group_id: null }
        : item
    ));

    await get().updateWorkoutDayPlanItems(workoutId, nextItems);
  },

  updateWorkoutExerciseTargetSets: async (workoutId, exerciseId, targetSets) => {
    const desiredSets = normalizeTargetSets(targetSets);
    const plan = await get().ensureWorkoutDayPlan(workoutId);
    if (!plan) return;

    const source = plan.items.find((item) => item.exercise_id === exerciseId);
    if (!source) return;

    const sourceGroupId = source.superset_group_id || null;
    const nextItems = plan.items.map((item) => {
      if (item.exercise_id === exerciseId) {
        return { ...item, target_sets: desiredSets };
      }
      if (sourceGroupId && item.superset_group_id === sourceGroupId) {
        return { ...item, target_sets: desiredSets };
      }
      return item;
    });

    await get().updateWorkoutDayPlanItems(workoutId, nextItems);

    const affectedExerciseIds = sourceGroupId
      ? nextItems.filter((item) => !item.hidden && item.superset_group_id === sourceGroupId).map((item) => item.exercise_id)
      : [exerciseId];

    for (const affectedExerciseId of affectedExerciseIds) {
      const { data: existingSets, error: existingError } = await supabase
        .from('sets')
        .select('id, set_number, completed')
        .eq('workout_id', workoutId)
        .eq('exercise_id', affectedExerciseId)
        .order('set_number', { ascending: true });

      if (existingError) {
        console.error('Error fetching sets while updating target sets:', existingError);
        continue;
      }

      const sorted = (existingSets || []).slice().sort((a, b) => Number(a.set_number) - Number(b.set_number));
      if (sorted.length < desiredSets) {
        const currentMaxSetNumber = sorted.length > 0
          ? Math.max(...sorted.map((set) => Number(set.set_number) || 0))
          : 0;

        const rows = Array.from({ length: desiredSets - sorted.length }, (_, index) => ({
          workout_id: workoutId,
          exercise_id: affectedExerciseId,
          set_number: currentMaxSetNumber + index + 1,
          completed: false,
        }));

        const { error: insertError } = await supabase.from('sets').insert(rows);
        if (insertError) {
          console.error('Error adding sets to match target sets:', insertError);
        }
      }

      if (sorted.length > desiredSets) {
        const removable = sorted
          .filter((set) => !set.completed && Number(set.set_number) > desiredSets)
          .sort((a, b) => Number(b.set_number) - Number(a.set_number));

        for (const row of removable) {
          const { error: deleteError } = await supabase
            .from('sets')
            .delete()
            .eq('id', row.id);

          if (deleteError) {
            console.error('Error removing sets to match target sets:', deleteError);
          }
        }
      }
    }
  },

  reorderWorkoutExercises: async (workoutId, exerciseIds) => {
    const plan = await get().ensureWorkoutDayPlan(workoutId);
    if (!plan) return;

    const orderedMap = new Map(exerciseIds.map((id, index) => [id, index]));
    const nextItems = [...plan.items]
      .sort((a, b) => {
        const orderA = orderedMap.get(a.exercise_id) ?? Number.MAX_SAFE_INTEGER;
        const orderB = orderedMap.get(b.exercise_id) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.order - b.order;
      })
      .map((item, index) => ({ ...item, order: index }));

    await get().updateWorkoutDayPlanItems(workoutId, nextItems);
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
