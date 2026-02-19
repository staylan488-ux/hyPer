import { create } from 'zustand';
import { normalizeSetRange, parseSetRangeNotes } from '@/lib/setRangeNotes';
import { supabase } from '@/lib/supabase';
import type { Split, SplitDay, Workout, WorkoutSet, MacroTarget, VolumeLandmark, MuscleVolume, MuscleGroup } from '@/types';
import { startOfWeek, endOfWeek, format, startOfMonth, endOfMonth } from 'date-fns';

interface WorkoutSetOverrides {
  [splitExerciseId: string]: number;
}

interface AppState {
  activeSplit: Split | null;
  splits: Split[];
  currentWorkout: Workout | null;
  macroTarget: MacroTarget | null;
  volumeLandmarks: VolumeLandmark[];
  weeklyVolume: MuscleVolume[];
  loading: boolean;

  // Split actions
  fetchSplits: () => Promise<void>;
  createSplit: (split: Omit<Split, 'id' | 'user_id' | 'days'> & { days: { day_name: string; day_order: number; exercises?: { exercise_id: string; target_sets: number; target_reps_min: number; target_reps_max: number; exercise_order: number; notes?: string | null }[] }[] }) => Promise<Split | null>;
  updateSplit: (id: string, updates: Partial<Split>) => Promise<void>;
  deleteSplit: (id: string) => Promise<void>;
  setActiveSplit: (splitId: string) => Promise<void>;

  // Workout actions
  startWorkout: (splitDayId: string, overrides?: WorkoutSetOverrides) => Promise<Workout | null>;
  fetchCurrentWorkout: () => Promise<void>;
  logSet: (exerciseId: string, setNumber: number, weight: number, reps: number, rpe?: number) => Promise<void>;
  updateSet: (setId: string, updates: Partial<WorkoutSet>) => Promise<void>;
  completeWorkout: () => Promise<void>;
  fetchWorkoutsByMonth: (month: Date) => Promise<Workout[]>;
  fetchWorkoutById: (workoutId: string) => Promise<Workout | null>;
  deleteWorkout: (workoutId: string) => Promise<void>;

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

  createSplit: async (splitData: Omit<Split, 'id' | 'user_id' | 'days'> & { days: { day_name: string; day_order: number; exercises?: { exercise_id: string; target_sets: number; target_reps_min: number; target_reps_max: number; exercise_order: number; notes?: string | null }[] }[] }) => {
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

  startWorkout: async (splitDayId, overrides) => {
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
      set({ currentWorkout: existing as Workout });
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
        const parsedRange = parseSetRangeNotes(se.notes, se.target_sets);
        const normalizedRange = normalizeSetRange(parsedRange.minSets, parsedRange.targetSets, parsedRange.maxSets);

        const overrideSetCount = overrides?.[se.id];
        const safeOverride = typeof overrideSetCount === 'number' && Number.isFinite(overrideSetCount)
          ? Math.round(overrideSetCount)
          : null;

        const finalSetCount = safeOverride === null
          ? normalizedRange.targetSets
          : Math.max(normalizedRange.minSets, Math.min(normalizedRange.maxSets, safeOverride));

        for (let i = 1; i <= finalSetCount; i++) {
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
      set({ currentWorkout: completeWorkout as Workout });
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
      set({ currentWorkout: workout as Workout });
    } else if (!currentWorkout) {
      set({ currentWorkout: null });
    }
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

    set({ currentWorkout: null });
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
