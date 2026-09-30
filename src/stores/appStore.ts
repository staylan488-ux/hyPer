import { serializeSetRangeNotes } from '@/lib/setRangeNotes';
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { getSessionUserId } from '@/lib/sessionUser';
import { isPreviewActive } from '@/preview/flag';
import { fetchWhoopFixtureBatch } from '@/preview/whoopFixtures';
import { runWhoopSync, type WhoopSyncResult } from '@/lib/whoopSync';
import { createKeyedSingleFlight } from '@/lib/singleFlight';
import { disconnectWhoopRemote, fetchWhoopBatchRemote, startWhoopConnect } from '@/lib/whoopClient';
import { findAbsorbableWhoopSession } from '@/lib/whoopImport';
import { planActivityMerge } from '@/lib/mergeActivities';
import { finishedRunToActivity, type FinishedRun } from '@/lib/runTracker';
import { parseWorkoutNotes } from '@/lib/workoutNotes';
import { canResumeWorkout, isAbandonedSplitStart } from '@/lib/workoutSessions';
import { runSaveWithRetry, saveWorkoutSet } from '@/lib/saveWorkoutSet';
import { computeWeeklyVolume, trainingWeekRange, type WeeklyVolumeWorkoutRow } from '@/lib/weeklyVolume';
import {
  getNutritionProfile,
  isNewPhase,
  macroInputFromProfile,
  saveExpenditure,
  saveNutritionProfile,
  todayIsoDate,
  type NutritionProfile,
  type NutritionProfileInput,
} from '@/lib/nutritionProfile';
import {
  WINDOW_DAYS,
  estimateExpenditure,
  shouldRefreshExpenditure,
} from '@/lib/adaptiveExpenditure';
import { getDailyIntake } from '@/lib/nutritionIntake';
import { getBodyWeightHistorySince, getLatestBodyWeight } from '@/lib/healthWeights';
import { calculateMacroTargets } from '@/lib/nutritionCalculator';
import { localIsoDate } from '@/lib/weightTrend';
import { planSetCountChange } from '@/lib/workoutPlanOps';

/**
 * What an adaptive refresh did: 'skipped' (not due, off, or no weigh-in),
 * 'unchanged' (expenditure saved, target left alone), 'updated' (both
 * written) or 'failed'.
 */
export type AdaptiveRefreshStatus = 'updated' | 'unchanged' | 'skipped' | 'failed';

/** Pull a little more than the estimator's window so its filter has slack. */
const ADAPTIVE_LOOKBACK_DAYS = WINDOW_DAYS + 7;

/**
 * The profile fields a refresh computes from. If any change while it runs,
 * its result was computed for inputs the user has since replaced.
 */
function sameAdaptiveInputs(a: NutritionProfile | null, b: NutritionProfile): boolean {
  return a != null
    && a.adaptive_enabled === b.adaptive_enabled
    && a.sex === b.sex
    && a.birth_year === b.birth_year
    && a.height_cm === b.height_cm
    && a.body_fat_pct === b.body_fat_pct
    && a.activity === b.activity
    && a.goal === b.goal
    && a.rate_pct_per_week === b.rate_pct_per_week
    && a.phase_started_on === b.phase_started_on;
}

/** Whether the stored target is still the one a refresh started from. */
function sameMacroTarget(a: MacroTarget | null, b: MacroTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.source === b.source
    && a.updated_at === b.updated_at
    && a.calories === b.calories
    && a.protein === b.protein
    && a.carbs === b.carbs
    && a.fat === b.fat;
}

/**
 * One adaptive refresh at a time. An unforced call joins the run in flight; a
 * forced one waits for it and then computes afresh.
 */
let adaptiveRefreshInFlight: Promise<AdaptiveRefreshStatus> | null = null;

/**
 * The adaptive loop's own target write. "Never overwrite a hand-typed target"
 * is enforced inside each statement, so it holds even when the in-memory copy
 * is stale (a failed read) or a manual save lands mid-refresh. Returns the
 * stored row, or null when a manual target kept its place.
 */
async function writeAdaptiveMacroTarget(
  userId: string,
  macros: Pick<MacroTarget, 'calories' | 'protein' | 'carbs' | 'fat'>
): Promise<MacroTarget | null> {
  const fields = { ...macros, source: 'adaptive' as const, updated_at: new Date().toISOString() };

  const updated = await supabase
    .from('macro_targets')
    .update(fields)
    .eq('user_id', userId)
    .neq('source', 'manual')
    .select()
    .maybeSingle();
  if (updated.error) throw updated.error;
  if (updated.data) return updated.data;

  // Nothing matched: either no row yet, or a manual one. Insert only if absent
  // (ON CONFLICT DO NOTHING), so a manual row is left alone.
  const inserted = await supabase
    .from('macro_targets')
    .upsert({ user_id: userId, ...fields }, { onConflict: 'user_id', ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (inserted.error) throw inserted.error;
  return inserted.data ?? null;
}
import type {
  Split,
  SplitDay,
  Workout,
  WorkoutSet,
  MacroTarget,
  VolumeLandmark,
  MuscleVolume,
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
} from '@/types';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import {
  CLEARED_WHOOP_STATS,
  whoopStatsFor,
} from '@/lib/workoutWhoop';

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

// The workout row with its sets and each set's exercise.
const WORKOUT_WITH_SETS_SELECT = '*, sets(*, exercise:exercises!exercise_id(*))';

interface DayPlanRow {
  id: string;
  workout_id: string;
  day_label: string;
  items: unknown;
}

function toDayPlan(row: DayPlanRow): WorkoutDayPlan {
  return {
    id: row.id,
    workout_id: row.workout_id,
    day_label: row.day_label,
    items: normalizeFlexiblePlanItems(row.items),
  };
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

const START_WORKOUT_ERROR = "Couldn't start the workout. Check your connection and try again.";

interface PlaceholderSetSpec {
  exerciseId: string;
  from: number;
  to: number;
}

// Creates empty sets in one request. Rows keep plan order, then set_number,
// exactly as the old one-insert-per-set loops did. Callers must check `error`.
async function insertPlaceholderSets(
  workoutId: string,
  specs: PlaceholderSetSpec[],
  withSelect = false,
): Promise<{ data: WorkoutSet[]; error: unknown }> {
  const rows: { workout_id: string; exercise_id: string; set_number: number; completed: boolean }[] = [];
  for (const { exerciseId, from, to } of specs) {
    for (let setNumber = from; setNumber <= to; setNumber += 1) {
      rows.push({ workout_id: workoutId, exercise_id: exerciseId, set_number: setNumber, completed: false });
    }
  }

  if (rows.length === 0) return { data: [], error: null };

  if (withSelect) {
    const { data, error } = await supabase
      .from('sets')
      .insert(rows)
      .select('*, exercise:exercises!exercise_id(*)');
    return { data: (data || []) as WorkoutSet[], error };
  }

  const { error } = await supabase.from('sets').insert(rows);
  return { data: [], error };
}

// Removes the workout row a failed start just created (its plan cascades).
async function discardStartedWorkout(workoutId: string) {
  const { error } = await supabase.from('workouts').delete().eq('id', workoutId);
  if (error) console.error('Error removing workout after a failed start:', error);
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
  nutritionProfile: NutritionProfile | null;
  volumeLandmarks: VolumeLandmark[];
  weeklyVolume: MuscleVolume[];

  // Split actions
  fetchSplits: () => Promise<void>;
  createSplit: (split: Omit<Split, 'id' | 'user_id' | 'days'> & { days: { day_name: string; day_order: number; exercises?: { exercise_id: string; target_sets: number; target_reps_min: number; target_reps_max: number; exercise_order: number; notes?: string | null; superset_group_id?: string | null }[] }[] }) => Promise<Split | null>;
  updateSplit: (id: string, updates: Partial<Split>) => Promise<{ ok: boolean; reason?: string }>;
  deleteSplit: (id: string) => Promise<{ ok: boolean; reason?: string }>;
  setActiveSplit: (splitId: string) => Promise<{ ok: boolean; reason?: string }>;

  // Workout actions
  startWorkout: (splitDayId: string) => Promise<Workout | null>;
  startFlexibleWorkout: (dayLabel: string, templateLabel?: string | null) => Promise<Workout | null>;
  fetchCurrentWorkout: () => Promise<void>;
  substituteWorkoutExercise: (exerciseId: string, replacement: Exercise) => Promise<void>;
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
  updateWorkoutDayPlanItems: (workoutId: string, items: FlexiblePlanItem[], preloadedPlan?: WorkoutDayPlan) => Promise<WorkoutDayPlan | null>;
  addSupersetToWorkout: (workoutId: string, baseExerciseId: string, partner: Exercise) => Promise<void>;
  clearWorkoutSuperset: (workoutId: string, exerciseId: string) => Promise<void>;
  updateWorkoutExerciseTargetSets: (workoutId: string, exerciseId: string, targetSets: number) => Promise<void>;
  reorderWorkoutExercises: (workoutId: string, exerciseIds: string[]) => Promise<void>;

  // Activity actions
  fetchActivitySessionsByMonth: (month: Date) => Promise<ActivitySession[]>;
  createActivitySession: (input: ActivitySessionInput) => Promise<ActivitySession | null>;
  updateActivitySession: (activityId: string, updates: Partial<ActivitySessionInput>) => Promise<ActivitySession | null>;
  deleteActivitySession: (activityId: string) => Promise<void>;
  mergeActivitySessions: (sessions: ActivitySession[]) => Promise<ActivitySession | null>;
  // true when WHOOP-imported segments still reference the session; deleting
  // such a session must tombstone instead so re-sync cannot resurrect it
  hasLinkedWhoopSegments: (sessionId: string) => Promise<boolean>;
  // null means the load failed (or nobody is signed in); [] means no segments.
  fetchActivitySegmentsBySessionIds: (sessionIds: string[]) => Promise<ActivitySegment[] | null>;
  upsertActivitySegments: (inputs: ActivitySegmentInput[]) => Promise<ActivitySegment[]>;
  syncWhoop: () => Promise<WhoopSyncResult | null>;
  whoopConnection: WhoopConnection | null;
  fetchWhoopConnection: () => Promise<WhoopConnection | null>;
  // returns a consent URL to redirect to (production) or null (preview: mock-connects in place)
  connectWhoop: (returnTo?: string) => Promise<string | null>;
  disconnectWhoop: () => Promise<void>;
  saveTrackedRun: (run: FinishedRun) => Promise<ActivitySession | null>;

  /** Copy a WHOOP record's physiology onto a workout and tombstone the record. */
  attachWhoopToWorkout: (workout: Workout, session: ActivitySession) => Promise<Workout | null>;
  /** Undo that: clear the stats and return the WHOOP record to the activity list. */
  detachWhoopFromWorkout: (workout: Workout) => Promise<Workout | null>;

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
  fetchFlexTemplates: () => Promise<void>;
  startFlexibleWorkoutFromTemplate: (label: string) => Promise<Workout | null>;
  renameFlexTemplate: (templateId: string, nextLabel: string, allowOverwrite?: boolean) => Promise<{ ok: boolean; conflictLabel?: string; reason?: string }>;
  deleteFlexTemplate: (templateId: string) => Promise<void>;
  // movementNotesOverride: the notes on screen; a key there wins over the saved notes.
  saveFlexibleTemplateFromCurrentWorkout: (movementNotesOverride?: Record<string, string>) => Promise<void>;

  // Macro targets
  fetchMacroTarget: () => Promise<void>;
  updateMacroTarget: (target: Partial<MacroTarget>) => Promise<void>;

  // Nutrition profile (the inputs behind the targets)
  fetchNutritionProfile: () => Promise<void>;
  updateNutritionProfile: (input: NutritionProfileInput) => Promise<void>;
  /**
   * Re-learn expenditure from logged intake vs weight trend, then re-target.
   * Never rejects; the status says what happened.
   */
  refreshAdaptiveTargets: (options?: { force?: boolean }) => Promise<AdaptiveRefreshStatus>;

  // Volume
  fetchVolumeLandmarks: () => Promise<void>;
  calculateWeeklyVolume: () => Promise<void>;
}

// activity_sessions insert row, shared by createActivitySession and the WHOOP
// sync's create port so both write the same column defaults
function activitySessionInsertRow(userId: string, input: ActivitySessionInput) {
  return {
    user_id: userId,
    activity_type: input.activity_type,
    custom_type: input.custom_type ?? null,
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
  };
}

// Activates the target before deactivating the rest, so a failure part-way
// leaves two active rows (the newest still wins) rather than none.
// `activated` reports whether the first step took effect. An update that
// matches no row (deleted elsewhere, or hidden by RLS) returns no error, so the
// returned rows are checked before anything is deactivated.
async function activateSplitRow(
  splitId: string,
  userId: string
): Promise<{ ok: boolean; activated: boolean; reason?: string }> {
  const { data: activatedRows, error: activateError } = await supabase
    .from('splits')
    .update({ is_active: true })
    .eq('id', splitId)
    .select('id');
  if (activateError || !activatedRows?.length) {
    return { ok: false, activated: false, reason: 'Could not set the active program. Try again.' };
  }

  const { error: deactivateError } = await supabase
    .from('splits')
    .update({ is_active: false })
    .eq('user_id', userId)
    .neq('id', splitId);
  if (deactivateError) {
    return { ok: false, activated: true, reason: 'Could not deactivate your other programs. Try again.' };
  }

  return { ok: true, activated: true };
}

// in-flight WHOOP sync per user id (see syncWhoop)
const whoopSyncFlight = createKeyedSingleFlight<WhoopSyncResult | null>();

// per-account data, reset when a different account signs in. workoutMode is
// a device preference that fetchWorkoutMode reloads, so it stays out.
export const initialAppData = {
  activeSplit: null,
  splits: [],
  currentWorkout: null,
  currentWorkoutDayPlan: null,
  flexTemplates: [],
  macroTarget: null,
  nutritionProfile: null,
  volumeLandmarks: [],
  weeklyVolume: [],
  whoopConnection: null,
} satisfies Partial<AppState>;

export const useAppStore = create<AppState>((set, get) => ({
  ...initialAppData,
  workoutMode: 'split',

  fetchSplits: async () => {
    const userId = await getSessionUserId();
    if (!userId) return;

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
      .eq('user_id', userId)
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

      // Unchanged content keeps the existing references, so effects keyed on
      // activeSplit (schedule, plan, calendar) don't refetch on every visit.
      if (JSON.stringify(get().splits) === JSON.stringify(formattedSplits)) return;

      const active = formattedSplits.find((s: Split) => s.is_active);
      set({ 
        splits: formattedSplits, 
        activeSplit: active || null 
      });
    }
  },

  createSplit: async (splitData: Omit<Split, 'id' | 'user_id' | 'days'> & { days: { day_name: string; day_order: number; exercises?: { exercise_id: string; target_sets: number; target_reps_min: number; target_reps_max: number; exercise_order: number; notes?: string | null; superset_group_id?: string | null }[] }[] }) => {
    const userId = await getSessionUserId();
    if (!userId) return null;

    // Inserted inactive: a failed create must never replace the program in use.
    const { data: split, error } = await supabase
      .from('splits')
      .insert({
        user_id: userId,
        name: splitData.name,
        description: splitData.description,
        days_per_week: splitData.days_per_week,
        is_active: false,
      })
      .select()
      .single();

    if (error || !split) return null;

    // One transactional call writes every day and exercise. Order comes from
    // the array position, and rows without an id take the RPC's insert branch.
    const { error: snapshotError } = await supabase.rpc('save_split_snapshot', {
      p_split_id: split.id,
      p_name: splitData.name,
      p_description: splitData.description,
      p_days_per_week: splitData.days_per_week,
      p_days: splitData.days.map((day, i) => ({
        day_name: day.day_name,
        day_order: i,
        exercises: (day.exercises ?? []).map((ex, j) => ({
          exercise_id: ex.exercise_id,
          target_sets: ex.target_sets,
          target_reps_min: ex.target_reps_min,
          target_reps_max: ex.target_reps_max,
          exercise_order: j,
          notes: ex.notes ?? null,
          superset_group_id: ex.superset_group_id ?? null,
        })),
      })),
    });

    // Best effort cleanup; if the delete also fails the leftover stays inactive.
    const discard = async () => {
      await supabase.from('splits').delete().eq('id', split.id);
    };

    if (snapshotError) {
      await discard();
      return null;
    }

    if (splitData.is_active) {
      const activation = await activateSplitRow(split.id, userId);
      if (!activation.activated) {
        await discard();
        return null;
      }
    }

    await get().fetchSplits();
    return { ...split, is_active: splitData.is_active } as Split;
  },

  updateSplit: async (id, updates) => {
    const { error } = await supabase.from('splits').update(updates).eq('id', id);
    if (error) return { ok: false, reason: 'Could not update the program. Try again.' };
    await get().fetchSplits();
    return { ok: true };
  },

  deleteSplit: async (id) => {
    const { error } = await supabase.from('splits').delete().eq('id', id);
    if (error) return { ok: false, reason: 'Could not delete the program. Try again.' };
    await get().fetchSplits();
    return { ok: true };
  },

  setActiveSplit: async (splitId) => {
    const userId = await getSessionUserId();
    if (!userId) return { ok: false, reason: 'Not signed in.' };

    const activation = await activateSplitRow(splitId, userId);
    // A partial write still changed rows, so show what the database now holds.
    if (activation.activated) await get().fetchSplits();
    return activation.ok ? { ok: true } : { ok: false, reason: activation.reason };
  },

  fetchWorkoutMode: async () => {
    const fallbackMode = readWorkoutModeFallback();

    const userId = await getSessionUserId();
    if (!userId) {
      set({ workoutMode: fallbackMode });
      return;
    }

    const { data, error } = await supabase
      .from('program_preferences')
      .select('workout_mode')
      .eq('user_id', userId)
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

    const userId = await getSessionUserId();
    if (!userId) return { ok: true };

    const { error } = await supabase
      .from('program_preferences')
      .upsert({
        user_id: userId,
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
    const userId = await getSessionUserId();
    if (!userId) return;

    const { data, error } = await supabase
      .from('flex_day_templates')
      .select('id, user_id, label, items')
      .eq('user_id', userId)
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

    const userId = await getSessionUserId();
    if (!userId) return { ok: false, reason: 'Not signed in.' };

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
          user_id: userId,
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
      .eq('user_id', userId);

    if (error) {
      console.error('Error renaming flexible template:', error);
      return { ok: false, reason: 'Could not rename template.' };
    }

    await get().fetchFlexTemplates();
    return { ok: true };
  },

  deleteFlexTemplate: async (templateId) => {
    const userId = await getSessionUserId();
    if (!userId) return;

    const { error } = await supabase
      .from('flex_day_templates')
      .delete()
      .eq('id', templateId)
      .eq('user_id', userId);

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
      currentWorkoutDayPlan: toDayPlan(data),
    });
  },

  startWorkout: async (splitDayId) => {
    const userId = await getSessionUserId();
    if (!userId) throw new Error(START_WORKOUT_ERROR);

    // Resume the latest in-progress workout even if it started before midnight.
    const { data: existing, error: existingError } = await supabase
      .from('workouts')
      .select(WORKOUT_WITH_SETS_SELECT)
      .eq('user_id', userId)
      .eq('completed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking existing workout:', existingError);
    }

    if (existing && canResumeWorkout(existing as Workout)) {
      if (!isAbandonedSplitStart(existing as Workout)) {
        set({ currentWorkout: existing as Workout, currentWorkoutDayPlan: null });
        return existing as Workout;
      }
      // An earlier start saved the workout but never added its sets. Nothing
      // was logged in it, so replace it with a complete one.
      await discardStartedWorkout(existing.id);
    }

    const today = format(new Date(), 'yyyy-MM-dd');

    const { data: workout, error } = await supabase
      .from('workouts')
      .insert({
        user_id: userId,
        split_day_id: splitDayId,
        date: today,
        completed: false,
      })
      .select()
      .single();

    if (error || !workout) {
      console.error('Error creating workout:', error);
      throw new Error(START_WORKOUT_ERROR);
    }

    // Get split day exercises and create placeholder sets
    const { data: splitExercises, error: splitExercisesError } = await supabase
      .from('split_exercises')
      .select('*, exercise:exercises(*)')
      .eq('split_day_id', splitDayId)
      .order('exercise_order');

    // Never leave a workout that is missing sets: it would resume for a day.
    const { error: setsError } = splitExercisesError
      ? { error: splitExercisesError }
      : await insertPlaceholderSets(workout.id, (splitExercises || []).map((se) => ({
          exerciseId: se.exercise_id,
          from: 1,
          to: se.target_sets,
        })));

    if (setsError) {
      console.error('Error creating workout sets:', setsError);
      await discardStartedWorkout(workout.id);
      throw new Error(START_WORKOUT_ERROR);
    }

    // Fetch the complete workout with sets
    const { data: completeWorkout, error: fetchError } = await supabase
      .from('workouts')
      .select(WORKOUT_WITH_SETS_SELECT)
      .eq('id', workout.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching complete workout:', fetchError);
    }

    if (completeWorkout) {
      set({ currentWorkout: completeWorkout as Workout, currentWorkoutDayPlan: null });
      return completeWorkout as Workout;
    }

    // The workout and its sets exist, so a retry resumes it.
    throw new Error(START_WORKOUT_ERROR);
  },

  startFlexibleWorkout: async (dayLabel, templateLabel) => {
    const label = dayLabel.trim();
    if (!label) return null;

    const userId = await getSessionUserId();
    if (!userId) throw new Error(START_WORKOUT_ERROR);

    const { data: existing, error: existingError } = await supabase
      .from('workouts')
      .select(WORKOUT_WITH_SETS_SELECT)
      .eq('user_id', userId)
      .eq('completed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error('Error checking existing workout:', existingError);
    }

    if (existing && canResumeWorkout(existing as Workout)) {
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
        user_id: userId,
        split_day_id: null,
        date: today,
        completed: false,
      })
      .select()
      .single();

    if (error || !workout) {
      console.error('Error creating flexible workout:', error);
      throw new Error(START_WORKOUT_ERROR);
    }

    let templateItems: FlexiblePlanItem[] = [];

    if (templateLabel?.trim()) {
      const { data: template } = await supabase
        .from('flex_day_templates')
        .select('items')
        .eq('user_id', userId)
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

    const { error: setsError } = await insertPlaceholderSets(
      workout.id,
      templateItems
        .filter((item) => !item.hidden)
        .map((item) => ({ exerciseId: item.exercise_id, from: 1, to: normalizeTargetSets(item.target_sets) })),
    );

    if (setsError) {
      console.error('Error creating flexible workout sets:', setsError);
      await discardStartedWorkout(workout.id);
      throw new Error(START_WORKOUT_ERROR);
    }

    const { data: completeWorkout, error: fetchError } = await supabase
      .from('workouts')
      .select(WORKOUT_WITH_SETS_SELECT)
      .eq('id', workout.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching flexible workout:', fetchError);
    }

    if (completeWorkout) {
      set({
        currentWorkout: completeWorkout as Workout,
        currentWorkoutDayPlan: createdPlan ? toDayPlan(createdPlan) : null,
      });
      return completeWorkout as Workout;
    }

    // The workout and its sets exist, so a retry resumes it.
    throw new Error(START_WORKOUT_ERROR);
  },

  fetchCurrentWorkout: async () => {
    const userId = await getSessionUserId();
    if (!userId) return;

    const { data: workout, error } = await supabase
      .from('workouts')
      .select(WORKOUT_WITH_SETS_SELECT)
      .eq('user_id', userId)
      .eq('completed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching current workout:', error);
      return;
    }

    if (workout && canResumeWorkout(workout as Workout)) {
      const nextWorkout = workout as Workout;
      set({ currentWorkout: nextWorkout });

      await get().fetchCurrentWorkoutDayPlan(nextWorkout.id);
    } else {
      set({ currentWorkout: null, currentWorkoutDayPlan: null });
    }
  },

  substituteWorkoutExercise: async (exerciseId, replacement) => {
    const { currentWorkout, currentWorkoutDayPlan } = get();
    if (!currentWorkout || currentWorkout.completed) throw new Error('No active workout.');
    const originalSets = currentWorkout.sets.filter((entry) => entry.exercise_id === exerciseId);
    if (!originalSets.some((entry) => !entry.completed)) throw new Error('This movement has no remaining sets.');
    if (currentWorkout.sets.some((entry) => entry.exercise_id === replacement.id)) {
      throw new Error('That exercise is already in this workout.');
    }

    const plan = currentWorkoutDayPlan?.workout_id === currentWorkout.id
      ? currentWorkoutDayPlan
      : await get().ensureWorkoutDayPlan(currentWorkout.id);
    if (!plan) throw new Error('Could not prepare the workout. Please try again.');

    // Fresh movement defaults, never the original movement's prescription or loads.
    // Its history is loaded by the same target/autofill path as every other movement.
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: crypto.randomUUID(), workout_id: currentWorkout.id,
      exercise_id: replacement.id, set_number: index + 1, completed: false,
      weight: null, reps: null, rpe: null, completed_at: null,
    }));
    const { error: insertError } = await supabase.from('sets').insert(rows);
    if (insertError) throw new Error('Could not add the replacement. Please try again.');

    const nextItems = plan.items.filter((item) => item.exercise_id !== replacement.id).flatMap((item) => {
      if (item.exercise_id !== exerciseId) return [item];
      const replacementItem = {
        ...item, exercise_id: replacement.id, exercise_name: replacement.name,
        target_sets: 3, target_reps_min: 8, target_reps_max: 12,
        notes: currentWorkout.split_day_id ? serializeSetRangeNotes(null, 1, 3, 10) : null,
      };
      return originalSets.some((entry) => entry.completed)
        ? [{ ...item, target_sets: originalSets.filter((entry) => entry.completed).length, superset_group_id: null }, replacementItem]
        : [replacementItem];
    }).map((item, order) => ({ ...item, order }));

    try {
      if (plan && nextItems) {
        const { error } = await supabase.from('workout_day_plans').update({ items: nextItems }).eq('id', plan.id);
        if (error) throw error;
      }
      const { error } = await supabase.from('sets').delete()
        .eq('workout_id', currentWorkout.id).eq('exercise_id', exerciseId).eq('completed', false);
      if (error) throw error;
    } catch {
      const { error: cleanupError } = await supabase.from('sets').delete().in('id', rows.map((row) => row.id));
      const rollback = plan
        ? await supabase.from('workout_day_plans').update({ items: plan.items }).eq('id', plan.id)
        : null;
      if (cleanupError || rollback?.error) {
        await get().fetchCurrentWorkout();
        throw new Error('The substitution only partly saved. Check the workout before trying again.');
      }
      throw new Error('Could not substitute the exercise. Please try again.');
    }

    const latest = get().currentWorkout;
    if (!latest || latest.id !== currentWorkout.id) return;
    set({
      currentWorkout: { ...latest, sets: [
        ...latest.sets.filter((entry) => entry.exercise_id !== exerciseId || entry.completed),
        ...rows.map((row) => ({ ...row, exercise: replacement } as WorkoutSet)),
      ] },
      ...(plan && nextItems ? { currentWorkoutDayPlan: { ...plan, items: nextItems } } : {}),
    });
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
      currentWorkoutDayPlan: toDayPlan(data),
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
      const { data: createdSets, error: setsError } = await insertPlaceholderSets(
        currentWorkout.id,
        [{ exerciseId: exercise.id, from: 1, to: targetSets }],
        true,
      );

      if (setsError) {
        console.error('Error creating flexible exercise sets:', setsError);
      } else {
        // Merge instead of refetching so a set logged meanwhile stays logged.
        const latest = get().currentWorkout;
        if (latest?.id === currentWorkout.id) {
          set({ currentWorkout: { ...latest, sets: [...latest.sets, ...createdSets] } });
        }
      }
    }

    set({
      currentWorkoutDayPlan: toDayPlan(updatedPlan),
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

    // A partner removed earlier keeps its finished sets; adding sets 1..N again
    // would duplicate their numbers, so it keeps what it has (as in History).
    const partnerHasSets = currentWorkout.sets.some((set) => set.exercise_id === partner.id);
    const { data: createdSets, error: setsError } = partnerHasSets
      ? { data: [], error: null }
      : await insertPlaceholderSets(
          currentWorkout.id,
          [{ exerciseId: partner.id, from: 1, to: normalizeTargetSets(partnerItem.target_sets) }],
          true,
        );

    if (setsError) {
      console.error('Error creating flexible superset sets:', setsError);
    } else if (createdSets.length > 0) {
      // Merge instead of refetching so a set logged meanwhile stays logged.
      const latest = get().currentWorkout;
      if (latest?.id === currentWorkout.id) {
        set({ currentWorkout: { ...latest, sets: [...latest.sets, ...createdSets] } });
      }
    }

    set({
      currentWorkoutDayPlan: toDayPlan(updatedPlan),
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
      currentWorkoutDayPlan: toDayPlan(updatedPlan),
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

      const additions: PlaceholderSetSpec[] = [];
      const removedIds: string[] = [];

      for (const affectedExerciseId of affectedExerciseIds) {
        const { insertNumbers, deleteIds } = planSetCountChange(
          workout.sets.filter((set) => set.exercise_id === affectedExerciseId),
          desiredSets,
        );
        if (insertNumbers.length > 0) {
          additions.push({ exerciseId: affectedExerciseId, from: insertNumbers[0], to: insertNumbers[insertNumbers.length - 1] });
        }
        removedIds.push(...deleteIds);
      }

      const { data: createdSets, error: setsError } = await insertPlaceholderSets(workout.id, additions, true);
      if (setsError) console.error('Error adding sets for flexible target change:', setsError);

      let deletedIds: string[] = [];
      if (removedIds.length > 0) {
        // Only delete sets that are still unfinished on the server, so a set
        // logged during the plan update survives, and drop only what was deleted.
        const { data: deletedRows, error: deleteError } = await supabase
          .from('sets')
          .delete()
          .eq('completed', false)
          .in('id', removedIds)
          .select('id');
        if (deleteError) console.error('Error removing sets for flexible target change:', deleteError);
        else deletedIds = (deletedRows ?? []).map((row) => row.id);
      }

      // Merge instead of refetching so a set logged meanwhile stays logged.
      const latest = get().currentWorkout;
      if (latest?.id === workout.id && (createdSets.length > 0 || deletedIds.length > 0)) {
        set({
          currentWorkout: {
            ...latest,
            sets: [...latest.sets.filter((entry) => !deletedIds.includes(entry.id)), ...createdSets],
          },
        });
      }
    }

    set({
      currentWorkoutDayPlan: toDayPlan(updatedPlan),
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
        .select(WORKOUT_WITH_SETS_SELECT)
        .eq('id', currentWorkout.id)
        .maybeSingle();

      if (refreshedWorkout) {
        set({ currentWorkout: refreshedWorkout as Workout });
      }
    }

    set({
      currentWorkoutDayPlan: toDayPlan(updatedPlan),
    });
  },

  saveFlexibleTemplateFromCurrentWorkout: async (movementNotesOverride) => {
    const { currentWorkoutDayPlan, currentWorkout } = get();
    const userId = await getSessionUserId();
    if (!userId || !currentWorkoutDayPlan) return;

    const label = currentWorkoutDayPlan.day_label.trim();
    if (!label) return;

    const movementNotes = parseWorkoutNotes(currentWorkout?.notes || null).movementNotes;
    const itemsWithNotes = currentWorkoutDayPlan.items.map((item) => {
      if (movementNotesOverride && item.exercise_id in movementNotesOverride) {
        return { ...item, notes: movementNotesOverride[item.exercise_id].trim() || null };
      }
      return { ...item, notes: movementNotes[item.exercise_id] ?? item.notes ?? null };
    });

    const { error } = await supabase
      .from('flex_day_templates')
      .upsert({
        user_id: userId,
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
    if (!currentWorkout) throw new Error('No active workout to log this set.');
    const target = currentWorkout.sets.find(s => s.exercise_id === exerciseId && s.set_number === setNumber);
    if (!target) throw new Error('This set is no longer in the workout.');

    const updatedSet = await saveWorkoutSet(target, { weight, reps, rpe: rpe ?? null });
    const latestWorkout = get().currentWorkout;
    // A slow response must never write into a different workout opened meanwhile.
    if (!latestWorkout || latestWorkout.id !== currentWorkout.id) return;

    const updatedSets = latestWorkout.sets.map(s => s.id === target.id
      ? {
          ...s,
          weight: updatedSet.weight,
          reps: updatedSet.reps,
          rpe: updatedSet.rpe,
          completed: updatedSet.completed,
          completed_at: updatedSet.completed_at,
        }
      : s);

    set({ currentWorkout: { ...latestWorkout, sets: updatedSets } });
  },

  updateSet: async (setId, updates) => {
    const { error } = await supabase.from('sets').update(updates).eq('id', setId);
    if (error) {
      console.error('Error updating set:', error);
      throw new Error('Could not save that change.');
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

    // Bound the save so a stalled request on weak signal turns into the retry
    // message instead of a silent wait. The payload is the same on each try.
    let error: unknown;
    try {
      ({ error } = await runSaveWithRetry((signal) => supabase
        .from('workouts')
        .update({ completed: true, completed_at: completedAt })
        .eq('id', currentWorkout.id)
        .abortSignal(signal)));
    } catch (caught) {
      error = caught;
    }

    // Keep the session open when the save fails so the user can retry.
    if (error) {
      console.error('Error completing workout:', error);
      throw new Error("Couldn't finish the workout. Check your connection and try again.");
    }

    set({ currentWorkout: null, currentWorkoutDayPlan: null });
    // Screens that show volume recompute it on mount; don't hold the finish on it.
    void get().calculateWeeklyVolume().catch(() => {});
  },

  fetchWorkoutsByMonth: async (month: Date) => {
    const userId = await getSessionUserId();
    if (!userId) return [];

    const from = format(startOfMonth(month), 'yyyy-MM-dd');
    const to = format(endOfMonth(month), 'yyyy-MM-dd');

    const { data: workouts, error } = await supabase
      .from('workouts')
      .select(`
        *,
        sets (*, exercise:exercises!exercise_id (*))
      `)
      .eq('user_id', userId)
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
    // One statement: sets and the day plan go with it via ON DELETE CASCADE,
    // so a failure part-way can no longer leave a workout with its sets wiped.
    let { error } = await supabase.from('workouts').delete().eq('id', workoutId);

    // Foreign-key violation means a database without the cascade. Nothing was
    // deleted, so fall back to removing the sets first, stopping if that fails.
    if (error?.code === '23503') {
      const { error: setsError } = await supabase.from('sets').delete().eq('workout_id', workoutId);
      if (setsError) {
        console.error('Error deleting workout sets:', setsError);
        throw setsError;
      }
      ({ error } = await supabase.from('workouts').delete().eq('id', workoutId));
    }

    if (error) {
      console.error('Error deleting workout:', error);
      throw error;
    }

    // A deleted in-progress workout must not stay on the Workout tab.
    if (get().currentWorkout?.id === workoutId) {
      set({ currentWorkout: null, currentWorkoutDayPlan: null });
    }
  },

  fetchActivitySessionsByMonth: async (month: Date) => {
    const userId = await getSessionUserId();
    if (!userId) return [];

    const from = format(startOfMonth(month), 'yyyy-MM-dd');
    const to = format(endOfMonth(month), 'yyyy-MM-dd');

    const { data, error } = await supabase
      .from('activity_sessions')
      .select('*')
      .eq('user_id', userId)
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
    const userId = await getSessionUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from('activity_sessions')
      .insert(activitySessionInsertRow(userId, input))
      .select()
      .single();

    if (error || !data) {
      if (error) console.error('Error creating activity session:', error);
      return null;
    }

    return data as ActivitySession;
  },

  updateActivitySession: async (activityId, updates) => {
    const userId = await getSessionUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from('activity_sessions')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activityId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      if (error) console.error('Error updating activity session:', error);
      return null;
    }

    return data as ActivitySession;
  },

  // Combines same-day sessions WHOOP split apart. Segments are re-pointed to the
  // survivor FIRST so no child is orphaned if a later step fails, and the
  // absorbed rows are hard-deleted (not tombstoned) because their data now lives
  // on the survivor — a tombstone would leave the merged time double-counted.
  mergeActivitySessions: async (sessions) => {
    const userId = await getSessionUserId();
    if (!userId) return null;

    const plan = planActivityMerge(sessions);
    if (!plan) return null;

    const { error: relinkError } = await supabase
      .from('activity_segments')
      .update({ session_id: plan.keepId, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('session_id', plan.absorbIds);
    if (relinkError) {
      console.error('Error re-pointing segments during merge:', relinkError);
      throw relinkError;
    }

    const merged = await get().updateActivitySession(plan.keepId, plan.patch);
    if (!merged) throw new Error('Could not update the merged activity.');

    const { error: deleteError } = await supabase
      .from('activity_sessions')
      .delete()
      .eq('user_id', userId)
      .in('id', plan.absorbIds);
    if (deleteError) {
      console.error('Error removing absorbed activities:', deleteError);
      throw deleteError;
    }

    return merged;
  },

  deleteActivitySession: async (activityId) => {
    const userId = await getSessionUserId();
    if (!userId) return;

    const { error } = await supabase
      .from('activity_sessions')
      .delete()
      .eq('id', activityId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting activity session:', error);
      throw error;
    }
  },

  hasLinkedWhoopSegments: async (sessionId) => {
    const userId = await getSessionUserId();
    if (!userId) return false;

    const { count, error } = await supabase
      .from('activity_segments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('source', 'whoop');

    if (error) {
      console.error('Error checking for linked WHOOP segments:', error);
      // fail toward dismissal: a stray tombstone is invisible, but a hard
      // delete of a whoop-backed session resurrects on the next sync
      return true;
    }
    return (count ?? 0) > 0;
  },

  fetchActivitySegmentsBySessionIds: async (sessionIds) => {
    if (sessionIds.length === 0) return [];

    const userId = await getSessionUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from('activity_segments')
      .select('*')
      .eq('user_id', userId)
      .in('session_id', sessionIds)
      .order('started_at', { ascending: true });

    if (error) {
      console.error('Error fetching activity segments:', error);
      return null;
    }

    return (data || []) as ActivitySegment[];
  },

  upsertActivitySegments: async (inputs) => {
    if (inputs.length === 0) return [];

    const userId = await getSessionUserId();
    if (!userId) return [];

    // session_id is deliberately omitted: on conflict the upsert would null out
    // existing links and every re-sync would churn sessions. Linkage is owned
    // exclusively by linkSegmentsToSession-style updates
    const rows = inputs.map((input) => ({
      user_id: userId,
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
    const userId = await getSessionUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from('whoop_connections')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching whoop connection:', error);
      return null;
    }

    const connection = (data as WhoopConnection | null) ?? null;
    set({ whoopConnection: connection });
    return connection;
  },

  connectWhoop: async (returnTo) => {
    const userId = await getSessionUserId();
    if (!userId) return null;

    if (isPreviewActive()) {
      // sandbox: connecting just plants a mock metadata row
      const nowIso = new Date().toISOString();
      await supabase.from('whoop_connections').upsert(
        {
          user_id: userId,
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

    return startWhoopConnect(returnTo);
  },

  disconnectWhoop: async () => {
    const userId = await getSessionUserId();
    if (!userId) return;

    if (isPreviewActive()) {
      await supabase.from('whoop_connections').delete().eq('user_id', userId);
    } else {
      await disconnectWhoopRemote();
    }
    set({ whoopConnection: null });
  },

  syncWhoop: async () => {
    const userId = await getSessionUserId();
    if (!userId) return null;

    // One run per user at a time: a manual Sync tap during the automatic
    // launch/foreground sync joins that run instead of racing it into
    // duplicate sessions. Registered with no await after the user lookup, so the first
    // caller to resume claims the key and later callers see it.
    return whoopSyncFlight.run(userId, async () => {
      // preview drives the identical pipeline from fixture batches; production
      // fetches raw pages through the whoop-sync Edge Function
      const fetchBatch = isPreviewActive() ? fetchWhoopFixtureBatch : fetchWhoopBatchRemote;

      // Every port below throws on a failed read or write rather than returning
      // []: an empty read looks like "WHOOP has nothing here", and reconciling
      // against it deletes, duplicates or un-dismisses activities. A throw aborts
      // the run before any destructive step and surfaces as "Sync unavailable".
      try {
        // watermark: newest whoop segment already imported. A failed read must
        // not fall back to the 30-day first-sync window
        const { data: latest, error: latestError } = await supabase
          .from('activity_segments')
          .select('started_at')
          .eq('user_id', userId)
          .eq('source', 'whoop')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestError) throw latestError;

        const result = await runWhoopSync(
          {
            fetchBatch,
            data: {
              // the shared action returns [] on error (saveTrackedRun relies on
              // that), so only this port turns a short result into a failure
              upsertSegments: async (inputs) => {
                const rows = await get().upsertActivitySegments(inputs);
                if (inputs.length > 0 && rows.length === 0) throw new Error('WHOOP segment upsert failed');
                return rows;
              },
              fetchWhoopSegmentsInWindow: async (fromIso, toIso) => {
                const { data, error } = await supabase
                  .from('activity_segments')
                  .select('*')
                  .eq('user_id', userId)
                  .eq('source', 'whoop')
                  .gte('started_at', fromIso)
                  .lte('started_at', toIso)
                  .order('started_at', { ascending: true });
                if (error) {
                  console.error('Error fetching whoop segments:', error);
                  throw error;
                }
                return (data || []) as ActivitySegment[];
              },
              fetchSessionsInWindow: async (fromIso, toIso) => {
                // deliberately includes dismissed + user-edited rows (tombstones
                // must hold) and ALL sources (whoop metrics enrich GPS or
                // manual sessions covering the same time window)
                const { data, error } = await supabase
                  .from('activity_sessions')
                  .select('*')
                  .eq('user_id', userId)
                  .gte('started_at', fromIso)
                  .lte('started_at', toIso);
                if (error) {
                  console.error('Error fetching sessions in window:', error);
                  throw error;
                }
                return (data || []) as ActivitySession[];
              },
              fetchSessionsByIds: async (ids) => {
                if (ids.length === 0) return [];
                const { data, error } = await supabase
                  .from('activity_sessions')
                  .select('*')
                  .eq('user_id', userId)
                  .in('id', ids);
                if (error) {
                  console.error('Error fetching sessions by ids:', error);
                  throw error;
                }
                return (data || []) as ActivitySession[];
              },
              // create/update/delete mirror createActivitySession,
              // updateActivitySession and deleteActivitySession but reuse the
              // user resolved above instead of a user lookup per item
              createSession: async (input) => {
                const { data, error } = await supabase
                  .from('activity_sessions')
                  .insert(activitySessionInsertRow(userId, input))
                  .select()
                  .single();
                if (error || !data) {
                  if (error) console.error('Error creating activity session:', error);
                  return null;
                }
                return data as ActivitySession;
              },
              updateSession: async (sessionId, patch) => {
                const { data, error } = await supabase
                  .from('activity_sessions')
                  .update({ ...patch, updated_at: new Date().toISOString() })
                  .eq('id', sessionId)
                  .eq('user_id', userId)
                  .select()
                  .single();
                if (error || !data) {
                  if (error) console.error('Error updating activity session:', error);
                  return null;
                }
                return data as ActivitySession;
              },
              deleteSession: async (sessionId) => {
                const { error } = await supabase
                  .from('activity_sessions')
                  .delete()
                  .eq('id', sessionId)
                  .eq('user_id', userId);
                if (error) {
                  console.error('Error deleting activity session:', error);
                  throw error;
                }
              },
              // a failed link is logged and reported, not thrown: aborting the
              // whole sync as "unavailable" is worse than an unlinked session,
              // which the next sync deletes and recreates
              linkSegmentsToSession: async (segmentIds, sessionId) => {
                const { error } = await supabase
                  .from('activity_segments')
                  .update({ session_id: sessionId, updated_at: new Date().toISOString() })
                  .eq('user_id', userId)
                  .in('id', segmentIds);
                if (error) {
                  console.error('Error linking segments to session:', error);
                  return false;
                }
                return true;
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
    });
  },

  attachWhoopToWorkout: async (workout, session) => {
    const userId = await getSessionUserId();
    if (!userId) throw new Error('You are signed out. Sign in and try again.');

    const stats = whoopStatsFor(session);
    const { data, error } = await supabase
      .from('workouts')
      .update(stats)
      .eq('id', workout.id)
      .eq('user_id', userId)
      .select(WORKOUT_WITH_SETS_SELECT)
      .single();

    if (error || !data) {
      console.error('Error attaching WHOOP stats to workout:', error);
      throw new Error(`Could not attach the WHOOP stats: ${error?.message ?? 'unknown error'}`);
    }

    // Tombstone the WHOOP session rather than deleting it. dismissed_at is the
    // marker re-sync already respects, so the record will not be recreated as a
    // duplicate, and clearing it later restores the activity intact.
    const { error: dismissError } = await supabase
      .from('activity_sessions')
      .update({ dismissed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', session.id)
      .eq('user_id', userId);
    if (dismissError) console.error('Error tombstoning the absorbed WHOOP session:', dismissError);

    const updated = data as Workout;
    set((state) => ({
      currentWorkout: state.currentWorkout?.id === updated.id ? updated : state.currentWorkout,
    }));
    return updated;
  },

  detachWhoopFromWorkout: async (workout) => {
    const userId = await getSessionUserId();
    if (!userId) throw new Error('You are signed out. Sign in and try again.');

    const sessionId = workout.whoop_session_id ?? null;
    const { data, error } = await supabase
      .from('workouts')
      .update(CLEARED_WHOOP_STATS)
      .eq('id', workout.id)
      .eq('user_id', userId)
      .select(WORKOUT_WITH_SETS_SELECT)
      .single();

    if (error || !data) {
      console.error('Error detaching WHOOP stats from workout:', error);
      throw new Error(`Could not remove the WHOOP stats: ${error?.message ?? 'unknown error'}`);
    }

    if (sessionId) {
      const { error: restoreError } = await supabase
        .from('activity_sessions')
        .update({ dismissed_at: null, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('user_id', userId);
      if (restoreError) console.error('Error restoring the WHOOP session:', restoreError);
    }

    const updated = data as Workout;
    set((state) => ({
      currentWorkout: state.currentWorkout?.id === updated.id ? updated : state.currentWorkout,
    }));
    return updated;
  },

  saveTrackedRun: async (run) => {
    const userId = await getSessionUserId();
    if (!userId) throw new Error('You are signed out. Sign in and try again.');

    const { session: sessionInput, segments: segmentInputs } = finishedRunToActivity(run, run.runId);

    // A save can fail after the session insert but before segment linking.
    // Reuse the stable GPS start/type identity on retry instead of inserting a
    // second empty session. No schema or auth changes are required.
    const { data: existingSession, error: existingSessionError } = await supabase
      .from('activity_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('source', 'gps')
      .eq('activity_type', sessionInput.activity_type)
      .eq('started_at', sessionInput.started_at as string)
      .limit(1)
      .maybeSingle();

    if (existingSessionError) {
      console.error('Error checking for an existing tracked run:', existingSessionError);
      throw new Error(`Could not check for an existing run: ${existingSessionError.message}`);
    }

    const session = existingSession as ActivitySession | null
      ?? await get().createActivitySession(sessionInput);
    if (!session) throw new Error('The run could not be created. Its activity record was rejected.');

    // segment external_ids are stable per run, so a retried save upserts
    // rather than duplicating splits
    const segments = await get().upsertActivitySegments(segmentInputs);
    if (segmentInputs.length > 0 && segments.length !== segmentInputs.length) {
      throw new Error(
        `Only ${segments.length} of ${segmentInputs.length} splits saved. The run was not recorded.`,
      );
    }
    if (segments.length > 0) {
      const { error } = await supabase
        .from('activity_segments')
        .update({ session_id: session.id, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .in('id', segments.map((segment) => segment.id));
      if (error) {
        console.error('Error linking run segments:', error);
        throw new Error(`Could not attach the run's splits: ${error.message}`);
      }
    }

    // cross-source merge: if WHOOP already auto-imported this same run, absorb
    // it — its segments and strain/HR/kcal move onto the recording we just made
    // The run itself is already saved, so a failure here logs and skips the
    // merge instead of throwing: the WHOOP copy stays as a separate activity.
    if (session.started_at && session.ended_at) {
      const { data: windowSessions, error: windowError } = await supabase
        .from('activity_sessions')
        .select('*')
        .eq('user_id', userId)
        .gte('started_at', new Date(Date.parse(session.started_at) - 6 * 60 * 60 * 1000).toISOString())
        .lte('started_at', session.ended_at);
      if (windowError) {
        console.error('Error checking for a WHOOP copy of the run:', windowError);
        return session;
      }

      const absorbable = findAbsorbableWhoopSession(
        session.started_at,
        session.ended_at,
        (windowSessions || []) as ActivitySession[],
      );

      if (absorbable) {
        const { error: absorbError } = await supabase
          .from('activity_segments')
          .update({ session_id: session.id, updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('session_id', absorbable.id);
        // deleting the copy with its segments still attached would unlink them
        // (ON DELETE SET NULL) and the next WHOOP sync would recreate it
        if (absorbError) {
          console.error('Error moving WHOOP segments onto the run:', absorbError);
          return session;
        }

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
      throw new Error('Could not save that change.');
    }

    const { data: remainingSets, error: remainingError } = await supabase
      .from('sets')
      .select('id, set_number')
      .eq('workout_id', workoutId)
      .eq('exercise_id', exerciseId)
      .order('set_number', { ascending: true });

    if (remainingError) {
      console.error('Error fetching remaining sets for compaction:', remainingError);
      throw new Error('Could not save that change.');
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

    await get().updateWorkoutDayPlanItems(workoutId, nextItems, plan);
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
      throw new Error('Could not save that change.');
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

      await get().updateWorkoutDayPlanItems(workoutId, nextItems, plan);
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
    // Read the workout's own completion state with its sets so an edit can
    // only move it toward complete. A workout finished with skipped sets stays
    // finished; un-finishing is never a side effect of editing.
    const { data: workout, error } = await supabase
      .from('workouts')
      .select('completed, completed_at, sets(id, completed, completed_at)')
      .eq('id', workoutId)
      .maybeSingle();

    if (error || !workout) {
      if (error) console.error('Error syncing workout completion:', error);
      return { totalSets: 0, completedSets: 0, completed: false };
    }

    const sets = (workout.sets || []) as Array<Pick<WorkoutSet, 'completed' | 'completed_at'>>;
    const totalSets = sets.length;
    const completedSets = sets.filter((set) => Boolean(set.completed)).length;
    const wasCompleted = Boolean(workout.completed);
    const existingCompletedAt = typeof workout.completed_at === 'string'
      && Number.isFinite(new Date(workout.completed_at).getTime())
      ? workout.completed_at
      : null;

    let completed = wasCompleted;
    let completedAt: string | null = workout.completed_at ?? null;
    if (wasCompleted) {
      completedAt = existingCompletedAt ?? resolveWorkoutCompletedAt(sets);
    } else if (totalSets > 0 && completedSets === totalSets) {
      completed = true;
      completedAt = resolveWorkoutCompletedAt(sets);
    }

    if (completed !== wasCompleted || completedAt !== (workout.completed_at ?? null)) {
      const { error: updateError } = await supabase
        .from('workouts')
        .update({ completed, completed_at: completedAt })
        .eq('id', workoutId);

      if (updateError) {
        console.error('Error persisting workout completion state:', updateError);
      }
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
      throw new Error('Could not save that change.');
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

    const plan = toDayPlan(data);

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

    return toDayPlan(createdPlan);
  },

  // Pass the plan the caller just loaded to skip reading it again.
  updateWorkoutDayPlanItems: async (workoutId, items, preloadedPlan) => {
    const existingPlan = preloadedPlan ?? await get().ensureWorkoutDayPlan(workoutId);
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

    const nextPlan = toDayPlan(updatedPlan);

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
    await get().updateWorkoutDayPlanItems(workoutId, nextItems, plan);

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

    await get().updateWorkoutDayPlanItems(workoutId, nextItems, plan);
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

    await get().updateWorkoutDayPlanItems(workoutId, nextItems, plan);

    const affectedExerciseIds = sourceGroupId
      ? nextItems.filter((item) => !item.hidden && item.superset_group_id === sourceGroupId).map((item) => item.exercise_id)
      : [exerciseId];

    const additions: PlaceholderSetSpec[] = [];
    const removedIds: string[] = [];

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

      const { insertNumbers, deleteIds } = planSetCountChange(existingSets || [], desiredSets);
      if (insertNumbers.length > 0) {
        additions.push({ exerciseId: affectedExerciseId, from: insertNumbers[0], to: insertNumbers[insertNumbers.length - 1] });
      }
      removedIds.push(...deleteIds);
    }

    const { error: insertError } = await insertPlaceholderSets(workoutId, additions);
    if (insertError) {
      console.error('Error adding sets to match target sets:', insertError);
    }

    if (removedIds.length > 0) {
      // Only unfinished sets, so a set logged since the read above survives.
      const { error: deleteError } = await supabase
        .from('sets')
        .delete()
        .eq('completed', false)
        .in('id', removedIds);

      if (deleteError) {
        console.error('Error removing sets to match target sets:', deleteError);
      }
    }
  },

  reorderWorkoutExercises: async (workoutId, exerciseIds) => {
    const currentPlan = get().currentWorkoutDayPlan;
    const plan = currentPlan?.workout_id === workoutId
      ? currentPlan
      : await get().ensureWorkoutDayPlan(workoutId);
    if (!plan) throw new Error('Could not load the workout order. Please try again.');

    const planAtSave = get().currentWorkoutDayPlan;
    const orderedMap = new Map(exerciseIds.map((id, index) => [id, index]));
    const nextItems = [...plan.items]
      .sort((a, b) => {
        const orderA = orderedMap.get(a.exercise_id) ?? Number.MAX_SAFE_INTEGER;
        const orderB = orderedMap.get(b.exercise_id) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.order - b.order;
      })
      .map((item, index) => ({ ...item, order: index }));

    // Reordering changes only session-plan order, never set data or the program.
    const { data: updatedPlan, error } = await supabase
      .from('workout_day_plans')
      .update({ items: nextItems })
      .eq('id', plan.id)
      .select('id, workout_id, day_label, items')
      .single();
    if (error) throw error;
    if (!updatedPlan) throw new Error('Could not save the workout order. Please try again.');

    // Do not replace a different session (or newer plan edit) after a slow save.
    const latest = get();
    if (latest.currentWorkout?.id === workoutId && latest.currentWorkoutDayPlan === planAtSave && (!planAtSave || planAtSave.id === plan.id)) {
      set({ currentWorkoutDayPlan: {
        ...plan,
        items: normalizeFlexiblePlanItems(updatedPlan.items),
      } });
    }
  },

  fetchMacroTarget: async () => {
    const userId = await getSessionUserId();
    if (!userId) return;

    // maybeSingle, not single — a user with no targets yet is the normal case,
    // not an error.
    const { data, error } = await supabase
      .from('macro_targets')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    // A successful read with no row clears a target left over from a previous
    // account. A failed read keeps what is shown, so a flaky connection never
    // blanks the targets.
    if (!error) {
      set({ macroTarget: data ?? null });
    }
  },

  updateMacroTarget: async (target) => {
    const userId = await getSessionUserId();
    if (!userId) return;

    const { data, error } = await supabase
      .from('macro_targets')
      .upsert({
        user_id: userId,
        ...target,
        updated_at: new Date().toISOString(),
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

  fetchNutritionProfile: async () => {
    const userId = await getSessionUserId();
    if (!userId) return;

    try {
      set({ nutritionProfile: await getNutritionProfile(userId) });
    } catch {
      // A missing table on an un-migrated client should not break the app.
    }
  },

  updateNutritionProfile: async (input) => {
    const userId = await getSessionUserId();
    if (!userId) return;

    // Changing goal or rate starts a new phase; the expenditure estimator uses
    // that date to skip the glycogen/water transient that follows.
    const previous = get().nutritionProfile;
    const payload: NutritionProfileInput = isNewPhase(previous, input)
      ? { ...input, phase_started_on: todayIsoDate() }
      : input;

    set({ nutritionProfile: await saveNutritionProfile(userId, payload) });
  },

  refreshAdaptiveTargets: (options) => {
    const inFlight = adaptiveRefreshInFlight;
    if (inFlight && !options?.force) return inFlight;

    const run = (async (): Promise<AdaptiveRefreshStatus> => {
      // A forced run (Settings "Resume") must compute fresh, so it waits for
      // the one in flight rather than reusing its result.
      if (inFlight) await inFlight;

      try {
        // Local gates first: most calls stop here without an auth lookup.
        const profile = get().nutritionProfile;
        if (!profile || !profile.adaptive_enabled) return 'skipped';
        if (!options?.force && !shouldRefreshExpenditure(profile.expenditure_updated_at)) return 'skipped';

        const userId = await getSessionUserId();
        if (!userId) return 'skipped';
        const targetAtStart = get().macroTarget;

        const latest = await getLatestBodyWeight(userId);
        if (!latest) return 'skipped';
        const weightKg = Number(latest.kilograms);
        if (!Number.isFinite(weightKg) || weightKg <= 0) return 'skipped';

        const now = new Date();
        const since = localIsoDate(
          new Date(now.getTime() - ADAPTIVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000)
        );
        const [weightSamples, dailyIntake] = await Promise.all([
          getBodyWeightHistorySince(userId, ADAPTIVE_LOOKBACK_DAYS, now),
          getDailyIntake(userId, since),
        ]);

        // Seed the estimator with the PREDICTED figure, so a learned value can
        // never bootstrap itself off its own previous output.
        const predicted = calculateMacroTargets(macroInputFromProfile(profile, weightKg, null, now));

        const estimate = estimateExpenditure({
          predictedTdee: predicted.tdee,
          bmr: predicted.bmr,
          weightSamples,
          dailyIntake,
          phaseStartedOn: profile.phase_started_on,
          previousExpenditureKcal: profile.expenditure_kcal,
          previousConfidence: profile.expenditure_confidence,
          through: now,
        });

        // The user changed their goal or saved a target while this ran: the
        // result is for inputs they replaced. Write nothing; the unchanged
        // stamp lets the next Today visit recompute from the new inputs.
        if (!sameAdaptiveInputs(get().nutritionProfile, profile)) return 'skipped';
        if (!sameMacroTarget(get().macroTarget, targetAtStart)) return 'skipped';

        // A target the user typed by hand is theirs. Never overwrite it. This is
        // the fast exit; writeAdaptiveMacroTarget enforces it in the database.
        // Nothing learned yet means the existing calculated target already
        // reflects the prediction — rewriting it would just add churn.
        let retargeted = false;
        if (targetAtStart?.source !== 'manual' && estimate.confidence !== 'predicted') {
          const next = calculateMacroTargets(
            macroInputFromProfile(profile, weightKg, estimate.expenditureKcal, now)
          );
          const savedTarget = await writeAdaptiveMacroTarget(userId, {
            calories: next.calories,
            protein: next.protein,
            carbs: next.carbs,
            fat: next.fat,
          });
          // A target the user saved while the write was in flight already won
          // in the database; keep showing theirs instead of this stale echo.
          if (savedTarget && sameMacroTarget(get().macroTarget, targetAtStart)) {
            set({ macroTarget: savedTarget });
          }
          retargeted = !!savedTarget;
        }

        if (!sameAdaptiveInputs(get().nutritionProfile, profile)) return retargeted ? 'updated' : 'skipped';

        // Stamp the profile only after the target write, so a failed target
        // write is retried on the next visit instead of a week later. Only the
        // expenditure columns are written, never the snapshot's goal or rate.
        const saved = await saveExpenditure(userId, {
          expenditure_kcal: estimate.expenditureKcal,
          expenditure_confidence: estimate.confidence,
          expenditure_updated_at: now.toISOString(),
        });
        // A profile edit that landed during the write already set its own row.
        if (sameAdaptiveInputs(get().nutritionProfile, profile)) set({ nutritionProfile: saved });

        return retargeted ? 'updated' : 'unchanged';
      } catch (error) {
        // Adaptive targets are an enhancement. A failure here must never take
        // down the screen that triggered it.
        console.warn('[adaptive] refresh failed', error);
        return 'failed';
      }
    })();

    adaptiveRefreshInFlight = run;
    void run.finally(() => {
      if (adaptiveRefreshInFlight === run) adaptiveRefreshInFlight = null;
    });
    return run;
  },

  fetchVolumeLandmarks: async () => {
    const userId = await getSessionUserId();
    if (!userId) return;

    const { data } = await supabase
      .from('volume_landmarks')
      .select('*')
      .eq('user_id', userId);

    if (data) {
      set({ volumeLandmarks: data });
    }
  },

  calculateWeeklyVolume: async () => {
    const userId = await getSessionUserId();
    if (!userId) return;

    const { weekStart, weekEnd } = trainingWeekRange(new Date());

    // Get all completed sets from this week, regardless of whether
    // the parent workout was explicitly marked complete. Landmarks load
    // alongside so statuses are never graded against a missing or stale list.
    const [{ data: workouts }, { data: freshLandmarks }] = await Promise.all([
      supabase
        .from('workouts')
        .select(`
          *,
          sets!inner (
            exercise_id,
            completed,
            exercise:exercises (muscle_group, muscle_group_secondary)
          )
        `)
        .eq('user_id', userId)
        .eq('sets.completed', true)
        .gte('date', weekStart)
        .lte('date', weekEnd),
      Promise.resolve(
        supabase
          .from('volume_landmarks')
          .select('*')
          .eq('user_id', userId)
      ).catch(() => ({ data: null })),
    ]);

    if (!workouts) return;

    // If the landmarks query failed, keep grading against the stored list.
    const volumeLandmarks: VolumeLandmark[] = freshLandmarks ?? get().volumeLandmarks;
    const weeklyVolume = computeWeeklyVolume(workouts as WeeklyVolumeWorkoutRow[], volumeLandmarks);

    set({ volumeLandmarks, weeklyVolume });
  },
}));
