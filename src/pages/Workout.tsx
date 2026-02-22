import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Loader2, Plus, Settings2, Trash2, X, Link2, Unlink2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { addDays, format, isBefore, isSameDay, parseISO, startOfWeek } from 'date-fns';
import { Card, Button, Input, Modal } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { SetLogger } from '@/components/workout/SetLogger';
import { RestTimer } from '@/components/workout/RestTimer';
import { ScheduleEditor } from '@/components/workout/ScheduleEditor';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import { buildFixedWeekdays, defaultStartDate, defaultWeekdays, loadWithBackgroundSync, plannedDayForDate, savePlanSchedule, type PlanMode, type PlanSchedule } from '@/lib/planSchedule';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import {
  compareSetPerformance,
  formatSetPerformanceTarget,
  type PreviousSetSummary,
  type PreviousWorkoutSummary,
  type SetPerformanceInput,
} from '@/lib/workoutProgress';
import type { Exercise, SplitDay, Workout, WorkoutSet } from '@/types';

interface WorkoutNotesPayload {
  movementNotes?: Record<string, string>;
  legacyNote?: string;
}

function sanitizeMovementNotes(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};

  const next: Record<string, string> = {};

  for (const [exerciseId, noteValue] of Object.entries(input as Record<string, unknown>)) {
    if (typeof noteValue !== 'string') continue;
    const trimmed = noteValue.trim();
    if (!trimmed) continue;
    next[exerciseId] = trimmed.slice(0, 200);
  }

  return next;
}

function parseWorkoutNotes(raw: string | null): { movementNotes: Record<string, string>; legacyNote: string | null } {
  if (!raw) {
    return { movementNotes: {}, legacyNote: null };
  }

  try {
    const parsed = JSON.parse(raw) as WorkoutNotesPayload | Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return { movementNotes: {}, legacyNote: raw };
    }

    if ('movementNotes' in parsed) {
      const payload = parsed as WorkoutNotesPayload;
      return {
        movementNotes: sanitizeMovementNotes(payload.movementNotes),
        legacyNote: typeof payload.legacyNote === 'string' ? payload.legacyNote : null,
      };
    }

    return { movementNotes: sanitizeMovementNotes(parsed), legacyNote: null };
  } catch {
    return { movementNotes: {}, legacyNote: raw };
  }
}

function normalizeIndex(value: number, size: number): number {
  if (size <= 0) return 0;
  return ((value % size) + size) % size;
}

function normalizeFlexibleTargetSets(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(12, Math.round(value)));
}

type SupersetRole = 'A' | 'B';

type SupersetFlow = {
  groupId: string;
  role: SupersetRole;
  partnerExerciseId: string;
};

function buildSupersetFlowMap(orderedExerciseIdsByGroup: Array<{ groupId: string; exerciseIds: string[] }>): Map<string, SupersetFlow> {
  const map = new Map<string, SupersetFlow>();

  for (const group of orderedExerciseIdsByGroup) {
    if (group.exerciseIds.length !== 2) continue;

    const [exerciseA, exerciseB] = group.exerciseIds;
    map.set(exerciseA, { groupId: group.groupId, role: 'A', partnerExerciseId: exerciseB });
    map.set(exerciseB, { groupId: group.groupId, role: 'B', partnerExerciseId: exerciseA });
  }

  return map;
}

export function Workout() {
  const {
    activeSplit,
    currentWorkout,
    workoutMode,
    currentWorkoutDayPlan,
    flexTemplates,
    startWorkout,
    startFlexibleWorkout,
    fetchCurrentWorkout,
    fetchCurrentWorkoutDayPlan,
    fetchSplits,
    fetchWorkoutMode,
    fetchFlexTemplates,
    completeWorkout,
    addWorkoutSet,
    removeLastUncompletedSet,
    setFlexibleWorkoutLabel,
    addFlexibleExercise,
    addFlexibleSuperset,
    clearFlexibleSuperset,
    updateFlexibleExerciseMeta,
    removeFlexibleExerciseFromPlan,
    reorderFlexibleExercises,
    saveFlexibleTemplateFromCurrentWorkout,
  } = useAppStore();
  const userId = useAuthStore((state) => state.user?.id || null);
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);
  const [savingPlanSchedule, setSavingPlanSchedule] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [planSchedule, setPlanSchedule] = useState<PlanSchedule | null>(null);
  const [planScheduleResolving, setPlanScheduleResolving] = useState(false);
  const [weekCursor, setWeekCursor] = useState<Date>(new Date());
  const [weekWorkouts, setWeekWorkouts] = useState<Pick<Workout, 'id' | 'date' | 'split_day_id' | 'completed'>[]>([]);
  const [lastCompletedWorkout, setLastCompletedWorkout] = useState<Pick<Workout, 'date' | 'split_day_id'> | null>(null);
  const [completedSinceStartDates, setCompletedSinceStartDates] = useState<string[]>([]);
  const [movementNotes, setMovementNotes] = useState<Record<string, string>>({});
  const [legacyWorkoutNote, setLegacyWorkoutNote] = useState<string | null>(null);
  const [savingMovementNoteId, setSavingMovementNoteId] = useState<string | null>(null);
  const [savedMovementNoteId, setSavedMovementNoteId] = useState<string | null>(null);
  const [previousWorkoutSetsByExercise, setPreviousWorkoutSetsByExercise] = useState<Record<string, Record<number, SetPerformanceInput>>>({});
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const movementNotesRef = useRef<Record<string, string>>({});
  const noteSaveTimersRef = useRef<Record<string, number>>({});
  const lastPersistedNotesRef = useRef<string>('');
  const planScheduleRequestRef = useRef(0);

  const [setupStartDate, setSetupStartDate] = useState(defaultStartDate());
  const [setupStartChoice, setSetupStartChoice] = useState<'today' | 'tomorrow' | 'pick'>('today');
  const [setupMode, setSetupMode] = useState<PlanMode>('fixed');
  const [setupAnchorDay, setSetupAnchorDay] = useState(1);
  const [setupFlexDayIndex, setSetupFlexDayIndex] = useState(0);

  const [showFlexibleStart, setShowFlexibleStart] = useState(false);
  const [flexibleDayLabel, setFlexibleDayLabel] = useState('');
  const [inSessionFlexibleDayLabel, setInSessionFlexibleDayLabel] = useState('');
  const [selectedTemplateLabel, setSelectedTemplateLabel] = useState<string>('');
  const [startingFlexibleWorkout, setStartingFlexibleWorkout] = useState(false);
  const [showSaveTemplatePrompt, setShowSaveTemplatePrompt] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [supersetPickerSourceExerciseId, setSupersetPickerSourceExerciseId] = useState<string | null>(null);

  const currentWorkoutId = currentWorkout?.id || null;
  const currentWorkoutDate = currentWorkout?.date || null;
  const currentWorkoutNotes = currentWorkout?.notes || null;

  useEffect(() => {
    movementNotesRef.current = movementNotes;
  }, [movementNotes]);

  useEffect(() => {
    return () => {
      Object.values(noteSaveTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  useEffect(() => {
    Object.values(noteSaveTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    noteSaveTimersRef.current = {};
  }, [currentWorkoutId]);

  useEffect(() => {
    let mounted = true;

    const initializeWorkoutPage = async () => {
      await Promise.all([
        fetchSplits(),
        fetchCurrentWorkout(),
        fetchWorkoutMode(),
        fetchFlexTemplates(),
      ]);
      if (mounted) setInitializing(false);
    };

    void initializeWorkoutPage();

    return () => {
      mounted = false;
    };
  }, [fetchCurrentWorkout, fetchFlexTemplates, fetchSplits, fetchWorkoutMode]);

  useEffect(() => {
    if (!activeSplit) return;

    setSetupAnchorDay(defaultWeekdays(activeSplit.days_per_week)[0] ?? 1);
    setSetupFlexDayIndex(0);
  }, [activeSplit]);

  useEffect(() => {
    if (!activeSplit) {
      planScheduleRequestRef.current += 1;
      setPlanSchedule(null);
      setPlanScheduleResolving(false);
      return;
    }

    if (!userId) {
      planScheduleRequestRef.current += 1;
      setPlanSchedule(null);
      setPlanScheduleResolving(false);
      return;
    }

    const requestId = planScheduleRequestRef.current + 1;
    planScheduleRequestRef.current = requestId;
    const daysPerWeek = activeSplit.days_per_week;
    const splitDayCount = activeSplit.days.length;
    setPlanScheduleResolving(true);

    const applySchedule = (schedule: PlanSchedule) => {
      if (planScheduleRequestRef.current !== requestId) return;
      setPlanSchedule(schedule);
      setSetupStartDate(schedule.startDate);
      setSetupMode(schedule.mode);
      setSetupStartChoice('pick');
      setSetupAnchorDay(schedule.anchorDay ?? schedule.weekdays?.[0] ?? defaultWeekdays(daysPerWeek)[0] ?? 1);
      setSetupFlexDayIndex(normalizeIndex(schedule.anchorDay ?? 0, splitDayCount));
    };

    // Load local cache instantly + background sync from DB
    const { cached, cancel, done } = loadWithBackgroundSync(
      userId,
      activeSplit.id,
      applySchedule,  // called if remote is newer or cache was empty
    );

    if (cached) {
      applySchedule(cached);
    } else {
      // No local cache — reset to defaults until DB responds
      setPlanSchedule(null);
      setSetupStartDate(defaultStartDate());
      setSetupMode('fixed');
      setSetupStartChoice('today');
      setSetupAnchorDay(defaultWeekdays(daysPerWeek)[0] ?? 1);
      setSetupFlexDayIndex(0);
    }

    void done.finally(() => {
      if (planScheduleRequestRef.current !== requestId) return;
      setPlanScheduleResolving(false);
    });

    return () => { cancel(); };
  }, [userId, activeSplit]);

  useEffect(() => {
    if (!userId || !activeSplit || !planSchedule) {
      setWeekWorkouts([]);
      setLastCompletedWorkout(null);
      setCompletedSinceStartDates([]);
      return;
    }

    let cancelled = false;
    const fetchCalendarWorkouts = async () => {
      const weekStart = startOfWeek(weekCursor, { weekStartsOn: 1 });
      const weekEnd = addDays(weekStart, 6);

      const { data: workouts } = await supabase
        .from('workouts')
        .select('id, date, split_day_id, completed')
        .eq('user_id', userId)
        .gte('date', format(weekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'));

      const { data: completedSinceStart } = await supabase
        .from('workouts')
        .select('date')
        .eq('user_id', userId)
        .eq('completed', true)
        .gte('date', planSchedule.startDate)
        .lte('date', format(weekEnd, 'yyyy-MM-dd'));

      const { data: lastCompleted } = await supabase
        .from('workouts')
        .select('date, split_day_id')
        .eq('user_id', userId)
        .eq('completed', true)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      setWeekWorkouts((workouts || []) as Pick<Workout, 'id' | 'date' | 'split_day_id' | 'completed'>[]);
      setLastCompletedWorkout((lastCompleted as Pick<Workout, 'date' | 'split_day_id'>) || null);
      setCompletedSinceStartDates((completedSinceStart || []).map((row) => row.date));
    };

    void fetchCalendarWorkouts();
    return () => {
      cancelled = true;
    };
  }, [userId, activeSplit, planSchedule, weekCursor, currentWorkout]);

  useEffect(() => {
    if (!currentWorkoutId) {
      setMovementNotes({});
      setLegacyWorkoutNote(null);
      lastPersistedNotesRef.current = '';
      return;
    }

    const parsed = parseWorkoutNotes(currentWorkoutNotes);
    setMovementNotes(parsed.movementNotes);
    movementNotesRef.current = parsed.movementNotes;
    setLegacyWorkoutNote(parsed.legacyNote);

    const initialPayload: WorkoutNotesPayload = {
      movementNotes: parsed.movementNotes,
      legacyNote: parsed.legacyNote || undefined,
    };
    lastPersistedNotesRef.current = JSON.stringify(initialPayload);
  }, [currentWorkoutId, currentWorkoutNotes]);

  useEffect(() => {
    if (!userId || !currentWorkoutId || !currentWorkoutDate || !currentWorkout) {
      setPreviousWorkoutSetsByExercise({});
      return;
    }

    const exerciseIds = Array.from(new Set(currentWorkout.sets.map((set) => set.exercise_id)));

    if (exerciseIds.length === 0) {
      setPreviousWorkoutSetsByExercise({});
      return;
    }

    let cancelled = false;

    const fetchPreviousWorkoutTargets = async () => {
      const { data: completedWorkouts, error: workoutsError } = await supabase
        .from('workouts')
        .select('id')
        .eq('user_id', userId)
        .lte('date', currentWorkoutDate)
        .neq('id', currentWorkoutId)
        .order('date', { ascending: false })
        .limit(30);

      if (workoutsError) {
        console.error('Error loading previous workouts for target-to-beat:', workoutsError);
        if (!cancelled) setPreviousWorkoutSetsByExercise({});
        return;
      }

      const workoutIds = (completedWorkouts || []).map((workout) => (workout as PreviousWorkoutSummary).id);

      if (workoutIds.length === 0) {
        if (!cancelled) setPreviousWorkoutSetsByExercise({});
        return;
      }

      const { data: previousSets, error: previousSetsError } = await supabase
        .from('sets')
        .select('workout_id, exercise_id, set_number, weight, reps, completed')
        .in('workout_id', workoutIds)
        .in('exercise_id', exerciseIds)
        .eq('completed', true);

      if (previousSetsError) {
        console.error('Error loading previous sets for target-to-beat:', previousSetsError);
        if (!cancelled) setPreviousWorkoutSetsByExercise({});
        return;
      }

      const workoutRank = new Map(workoutIds.map((id, index) => [id, index]));
      const bestByExerciseAndSet = new Map<string, PreviousSetSummary>();

      for (const rawSet of previousSets || []) {
        const set = rawSet as PreviousSetSummary;
        const key = `${set.exercise_id}:${set.set_number}`;
        const currentBest = bestByExerciseAndSet.get(key);

        if (!currentBest) {
          bestByExerciseAndSet.set(key, set);
          continue;
        }

        const currentRank = workoutRank.get(set.workout_id) ?? Number.MAX_SAFE_INTEGER;
        const bestRank = workoutRank.get(currentBest.workout_id) ?? Number.MAX_SAFE_INTEGER;

        if (currentRank < bestRank) {
          bestByExerciseAndSet.set(key, set);
        }
      }

      const groupedTargets: Record<string, Record<number, SetPerformanceInput>> = {};

      for (const set of bestByExerciseAndSet.values()) {
        const parsedSetNumber = typeof set.set_number === 'number'
          ? set.set_number
          : Number.parseInt(String(set.set_number), 10);

        if (!Number.isFinite(parsedSetNumber)) continue;

        if (!groupedTargets[set.exercise_id]) {
          groupedTargets[set.exercise_id] = {};
        }

        groupedTargets[set.exercise_id][parsedSetNumber] = {
          weight: set.weight,
          reps: set.reps,
        };
      }

      if (cancelled) return;
      setPreviousWorkoutSetsByExercise(groupedTargets);
    };

    void fetchPreviousWorkoutTargets();

    return () => {
      cancelled = true;
    };
  }, [userId, currentWorkoutId, currentWorkoutDate, currentWorkout]);

  const persistMovementNotes = useCallback(async (exerciseId: string) => {
    if (!currentWorkoutId || !userId) return;

    setSavingMovementNoteId(exerciseId);

    const payload: WorkoutNotesPayload = {
      movementNotes: movementNotesRef.current,
      legacyNote: legacyWorkoutNote || undefined,
    };
    const serializedPayload = JSON.stringify(payload);

    if (serializedPayload === lastPersistedNotesRef.current) {
      setSavingMovementNoteId(null);
      return;
    }

    const { error } = await supabase
      .from('workouts')
      .update({ notes: serializedPayload })
      .eq('id', currentWorkoutId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error saving movement note:', error);
      setSavingMovementNoteId(null);
      return;
    }

    setSavingMovementNoteId(null);
    lastPersistedNotesRef.current = serializedPayload;
    setSavedMovementNoteId(exerciseId);
    window.setTimeout(() => {
      setSavedMovementNoteId((current) => (current === exerciseId ? null : current));
    }, 1200);
  }, [currentWorkoutId, legacyWorkoutNote, userId]);

  const queueMovementNotePersist = useCallback((exerciseId: string) => {
    const existingTimer = noteSaveTimersRef.current[exerciseId];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    noteSaveTimersRef.current[exerciseId] = window.setTimeout(() => {
      delete noteSaveTimersRef.current[exerciseId];
      void persistMovementNotes(exerciseId);
    }, 1200);
  }, [persistMovementNotes]);

  const handleMovementNoteChange = (exerciseId: string, value: string) => {
    const boundedValue = value.slice(0, 200);

    setMovementNotes((previous) => {
      const next = { ...previous };
      if (boundedValue.trim()) {
        next[exerciseId] = boundedValue;
      } else {
        delete next[exerciseId];
      }
      movementNotesRef.current = next;
      return next;
    });

    queueMovementNotePersist(exerciseId);
  };

  const handleMovementNoteBlur = (exerciseId: string) => {
    const timerId = noteSaveTimersRef.current[exerciseId];
    if (timerId) {
      window.clearTimeout(timerId);
      delete noteSaveTimersRef.current[exerciseId];
    }

    void persistMovementNotes(exerciseId);
  };

  const handleStartWorkout = async (day: SplitDay) => {
    if (startingDayId) return;

    try {
      setStartingDayId(day.id);
      await startWorkout(day.id);
    } finally {
      setStartingDayId(null);
    }
  };

  const handleSavePlanSetup = async () => {
    if (!activeSplit || !userId || savingPlanSchedule) return;

    setSavingPlanSchedule(true);

    try {
      const splitDayCount = activeSplit.days.length;
      const computedWeekdays =
        setupMode === 'fixed'
          ? buildFixedWeekdays(setupAnchorDay, activeSplit.days_per_week)
          : [];

      let computedAnchorDay: number | undefined;

      if (setupMode === 'fixed') {
        computedAnchorDay = setupAnchorDay;
      } else if (splitDayCount > 0) {
        const targetIndex = normalizeIndex(setupFlexDayIndex, splitDayCount);
        const todayKey = format(new Date(), 'yyyy-MM-dd');

        let completedBeforeToday = completedSinceStartDates.filter((dateValue) => (
          dateValue >= setupStartDate && dateValue < todayKey
        )).length;

        const { count, error } = await supabase
          .from('workouts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('completed', true)
          .gte('date', setupStartDate)
          .lt('date', todayKey);

        if (!error && typeof count === 'number') {
          completedBeforeToday = count;
        }

        const completedOffset = completedBeforeToday % splitDayCount;
        computedAnchorDay = normalizeIndex(targetIndex - completedOffset, splitDayCount);
      }

      const schedule: PlanSchedule = {
        splitId: activeSplit.id,
        startDate: setupStartDate,
        mode: setupMode,
        weekdays: computedWeekdays,
        anchorDay: computedAnchorDay,
      };

      savePlanSchedule(userId, schedule);
      setPlanSchedule(schedule);
      setShowScheduleEditor(false);
    } finally {
      setSavingPlanSchedule(false);
    }
  };

  useEffect(() => {
    if (setupStartChoice === 'today') {
      setSetupStartDate(format(new Date(), 'yyyy-MM-dd'));
    } else if (setupStartChoice === 'tomorrow') {
      setSetupStartDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    }
  }, [setupStartChoice]);

  useEffect(() => {
    if (!activeSplit) return;

    const splitDayCount = activeSplit.days.length;
    if (splitDayCount === 0) {
      setSetupFlexDayIndex(0);
      return;
    }

    setSetupFlexDayIndex((previous) => normalizeIndex(previous, splitDayCount));
  }, [activeSplit, setupMode]);

  // ── Exercise ordering (must be before early returns for hook rules) ──
  const splitDay = activeSplit?.days.find((day) => day.id === currentWorkout?.split_day_id) ?? null;
  const exerciseOrderById = useMemo(() => new Map(
    (splitDay?.exercises || []).map((exercise, index) => [
      exercise.exercise_id,
      exercise.exercise_order ?? index,
    ])
  ), [splitDay?.exercises]);

  const exerciseSetRanges = useMemo(() => new Map(
    (splitDay?.exercises || []).map((exercise) => {
      const parsedRange = parseSetRangeNotes(exercise.notes, exercise.target_sets);
      return [exercise.exercise_id, parsedRange] as const;
    })
  ), [splitDay?.exercises]);

  const orderedSets = useMemo(() => {
    if (!currentWorkout) return [];
    return [...currentWorkout.sets].sort((a, b) => {
      const orderA = exerciseOrderById.get(a.exercise_id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = exerciseOrderById.get(b.exercise_id) ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.set_number - b.set_number;
    });
  }, [currentWorkout, exerciseOrderById]);

  const exerciseGroups = useMemo(() => orderedSets.reduce<Record<string, WorkoutSet[]>>((acc, set) => {
    if (!acc[set.exercise_id]) {
      acc[set.exercise_id] = [];
    }
    acc[set.exercise_id].push(set);
    return acc;
  }, {}), [orderedSets]);

  const exerciseIds = Object.keys(exerciseGroups);
  const exerciseIdsKey = exerciseIds.join(',');

  useEffect(() => {
    setDisplayOrder((prev) => {
      // Only reset if the set of exercises actually changed (new workout, not just a reorder)
      const prevKey = [...prev].sort().join(',');
      const newKey = [...exerciseIds].sort().join(',');
      if (prevKey === newKey && prev.length > 0) return prev;
      return exerciseIds;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseIdsKey]);

  const orderedExerciseEntries = useMemo(() => {
    const entries = Object.entries(exerciseGroups);
    if (displayOrder.length === 0) return entries;
    return [...entries].sort((a, b) => {
      const idxA = displayOrder.indexOf(a[0]);
      const idxB = displayOrder.indexOf(b[0]);
      return (idxA === -1 ? Infinity : idxA) - (idxB === -1 ? Infinity : idxB);
    });
  }, [exerciseGroups, displayOrder]);

  const moveExercise = useCallback((exerciseId: string, direction: 'up' | 'down') => {
    setDisplayOrder((prev) => {
      const idx = prev.indexOf(exerciseId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next;
    });
  }, []);

  useEffect(() => {
    if (workoutMode !== 'flexible') return;

    if (currentWorkout?.split_day_id === null && currentWorkout.id) {
      void fetchCurrentWorkoutDayPlan(currentWorkout.id);
    }
  }, [workoutMode, currentWorkout?.id, currentWorkout?.split_day_id, fetchCurrentWorkoutDayPlan]);

  useEffect(() => {
    if (workoutMode !== 'flexible' || currentWorkout?.split_day_id !== null) return;

    setInSessionFlexibleDayLabel(currentWorkoutDayPlan?.day_label || '');
  }, [workoutMode, currentWorkout?.split_day_id, currentWorkoutDayPlan?.id, currentWorkoutDayPlan?.day_label]);

  const activeFlexibleItems = useMemo(() => (
    (currentWorkoutDayPlan?.items || [])
      .filter((item) => !item.hidden)
      .sort((a, b) => a.order - b.order)
  ), [currentWorkoutDayPlan?.items]);

  const splitSupersetByExerciseId = useMemo(() => {
    const map = new Map<string, string>();
    for (const exercise of splitDay?.exercises || []) {
      if (exercise.superset_group_id) {
        map.set(exercise.exercise_id, exercise.superset_group_id);
      }
    }
    return map;
  }, [splitDay?.exercises]);

  const flexibleSupersetByExerciseId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of activeFlexibleItems) {
      if (item.superset_group_id) {
        map.set(item.exercise_id, item.superset_group_id);
      }
    }
    return map;
  }, [activeFlexibleItems]);

  const supersetByExerciseId = workoutMode === 'flexible' && currentWorkout?.split_day_id === null
    ? flexibleSupersetByExerciseId
    : splitSupersetByExerciseId;

  const orderedSupersetGroups = useMemo(() => {
    const orderedExerciseIds = workoutMode === 'flexible' && currentWorkout?.split_day_id === null
      ? activeFlexibleItems.map((item) => item.exercise_id)
      : orderedExerciseEntries.map(([exerciseId]) => exerciseId);

    const grouped = new Map<string, string[]>();
    for (const exerciseId of orderedExerciseIds) {
      const groupId = supersetByExerciseId.get(exerciseId);
      if (!groupId) continue;

      const current = grouped.get(groupId) || [];
      current.push(exerciseId);
      grouped.set(groupId, current);
    }

    return Array.from(grouped.entries()).map(([groupId, exerciseIds]) => ({ groupId, exerciseIds }));
  }, [activeFlexibleItems, currentWorkout?.split_day_id, orderedExerciseEntries, supersetByExerciseId, workoutMode]);

  const supersetFlowMap = useMemo(() => buildSupersetFlowMap(orderedSupersetGroups), [orderedSupersetGroups]);

  const workoutExerciseMap = useMemo(() => {
    const map = new Map<string, Exercise>();
    for (const set of currentWorkout?.sets || []) {
      if (set.exercise) {
        map.set(set.exercise_id, set.exercise);
      }
    }
    return map;
  }, [currentWorkout?.sets]);

  const handleStartFlexibleWorkout = async () => {
    const trimmed = flexibleDayLabel.trim();
    if (!trimmed || startingFlexibleWorkout) return;

    try {
      setStartingFlexibleWorkout(true);
      const started = await startFlexibleWorkout(trimmed, selectedTemplateLabel || undefined);

      if (!started) {
        window.alert('You already have an in-progress split workout today. Finish it before starting a flexible workout.');
        return;
      }

      setShowFlexibleStart(false);
    } finally {
      setStartingFlexibleWorkout(false);
    }
  };

  const handleFlexibleTargetSetsChange = (exerciseId: string, value: number) => {
    const targetSets = normalizeFlexibleTargetSets(value);
    void updateFlexibleExerciseMeta(exerciseId, { target_sets: targetSets });
  };

  const handleInSessionDayLabelBlur = () => {
    if (!currentWorkoutDayPlan || currentWorkout?.split_day_id !== null) return;

    const trimmedDraft = inSessionFlexibleDayLabel.trim();
    if (!trimmedDraft) {
      setInSessionFlexibleDayLabel(currentWorkoutDayPlan.day_label || '');
      return;
    }

    if (trimmedDraft === currentWorkoutDayPlan.day_label) return;
    void setFlexibleWorkoutLabel(trimmedDraft);
  };

  const handleFlexibleReorder = async (exerciseId: string, direction: 'up' | 'down') => {
    const idx = activeFlexibleItems.findIndex((item) => item.exercise_id === exerciseId);
    if (idx === -1) return;

    const groupId = activeFlexibleItems[idx]?.superset_group_id || null;

    if (groupId) {
      const groupIndices = activeFlexibleItems
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.superset_group_id === groupId)
        .map(({ index }) => index)
        .sort((a, b) => a - b);

      if (groupIndices.length === 2) {
        const start = groupIndices[0];
        const end = groupIndices[1];
        const targetStart = direction === 'up' ? start - 1 : end + 1;

        if (targetStart < 0 || targetStart >= activeFlexibleItems.length) return;

        const next = [...activeFlexibleItems];
        const block = next.splice(start, 2);
        const insertAt = direction === 'up' ? start - 1 : start + 1;
        next.splice(insertAt, 0, ...block);

        await reorderFlexibleExercises(next.map((item) => item.exercise_id));
        return;
      }
    }

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= activeFlexibleItems.length) return;

    const next = [...activeFlexibleItems];
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];

    await reorderFlexibleExercises(next.map((item) => item.exercise_id));
  };

  const handleSaveTemplateAtCompletion = async () => {
    try {
      setSavingTemplate(true);
      await saveFlexibleTemplateFromCurrentWorkout();
      setShowSaveTemplatePrompt(false);
      await completeWorkout();
      await fetchFlexTemplates();
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSetLogged = (loggedSet: WorkoutSet) => {
    if (loggedSet.completed) return;

    const supersetFlow = supersetFlowMap.get(loggedSet.exercise_id);

    if (!supersetFlow) {
      setShowRestTimer(true);
      return;
    }

    if (supersetFlow.role === 'B') {
      setShowRestTimer(true);
    }
  };

  const splitSupersetPartnerByExerciseId = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const exercise of splitDay?.exercises || []) {
      if (!exercise.superset_group_id) continue;
      const current = grouped.get(exercise.superset_group_id) || [];
      current.push(exercise.exercise_id);
      grouped.set(exercise.superset_group_id, current);
    }

    const partnerMap = new Map<string, string>();
    for (const exerciseIds of grouped.values()) {
      if (exerciseIds.length !== 2) continue;
      partnerMap.set(exerciseIds[0], exerciseIds[1]);
      partnerMap.set(exerciseIds[1], exerciseIds[0]);
    }

    return partnerMap;
  }, [splitDay?.exercises]);

  const validateSupersetOrderBeforeLog = (candidateSet: WorkoutSet): true | string => {
    if (candidateSet.completed) return true;

    const supersetFlow = supersetFlowMap.get(candidateSet.exercise_id);
    if (!supersetFlow || !currentWorkout) return true;

    const candidateNumber = candidateSet.set_number;
    const partnerSets = currentWorkout.sets
      .filter((set) => set.exercise_id === supersetFlow.partnerExerciseId);

    if (supersetFlow.role === 'A') {
      const partnerPrevRound = partnerSets.find((set) => set.set_number === candidateNumber - 1);
      if (candidateNumber > 1 && !partnerPrevRound?.completed) {
        return `Complete B${candidateNumber - 1} before starting A${candidateNumber}.`;
      }
      return true;
    }

    const matchingA = partnerSets.find((set) => set.set_number === candidateNumber);
    if (!matchingA?.completed) {
      return `Complete A${candidateNumber} before logging B${candidateNumber}.`;
    }

    return true;
  };

  const completedSets = currentWorkout?.sets.filter(s => s.completed).length ?? 0;
  const totalSets = currentWorkout?.sets.length ?? 0;
  const progress = totalSets > 0 ? (completedSets / totalSets) * 100 : 0;
  // ── End exercise ordering ──

  const handleCompleteWorkout = async () => {
    if (completedSets < totalSets && totalSets > 0) {
      setShowCompleteConfirm(true);
      return;
    }

    if (workoutMode === 'flexible' && currentWorkout?.split_day_id === null) {
      setShowSaveTemplatePrompt(true);
      return;
    }

    await completeWorkout();
  };

  const handleConfirmComplete = async () => {
    setShowCompleteConfirm(false);

    if (workoutMode === 'flexible' && currentWorkout?.split_day_id === null) {
      setShowSaveTemplatePrompt(true);
      return;
    }

    await completeWorkout();
  };

  if (initializing) {
    return (
      <motion.div
        className="pb-24 px-5 pt-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <header className="mb-8">
          <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">Training</p>
          <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Begin Session</h1>
        </header>

        <Card variant="slab" className="text-center py-16">
          <div className="flex items-center justify-center gap-2 text-[#9A9A9A]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs tracking-wider">Loading program...</span>
          </div>
        </Card>
      </motion.div>
    );
  }

  if (workoutMode === 'split' && !activeSplit) {
    return (
      <motion.div
        className="pb-24 px-5 pt-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <header className="mb-8">
          <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">Training</p>
          <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Begin Session</h1>
        </header>

        <Card variant="slab" className="text-center py-16">
          <p className="text-xs text-[#6B6B6B] mb-6">No program active</p>
          <Button onClick={() => window.location.href = '/splits'}>
            Select Program
          </Button>
        </Card>
      </motion.div>
    );
  }

  const splitDays = activeSplit?.days || [];
  const splitDaysPerWeek = activeSplit?.days_per_week || 0;

  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const weekStart = startOfWeek(weekCursor, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const startDate = planSchedule ? parseISO(`${planSchedule.startDate}T00:00:00`) : null;
  const completedInWeek = weekWorkouts.filter((workout) => workout.completed);

  const completedBefore = (date: Date) =>
    completedSinceStartDates.filter((dateValue) => isBefore(parseISO(`${dateValue}T00:00:00`), date)).length;

  const today = new Date();
  const todayPlannedDay =
    planSchedule && startDate && !isBefore(today, startDate)
      ? plannedDayForDate(today, splitDays, planSchedule, completedBefore(today))
      : null;

  const todayCompletedWorkout = completedInWeek.find((workout) => workout.date === format(today, 'yyyy-MM-dd'));

  const openScheduleEditor = () => {
    if (!planSchedule) return;

    const splitDayCount = splitDays.length;
    const fallbackFlexDay = normalizeIndex(planSchedule.anchorDay ?? 0, splitDayCount);

    const todayPlannedIndex = todayPlannedDay
      ? splitDays.findIndex((day) => day.id === todayPlannedDay.id)
      : -1;

    setSetupStartDate(planSchedule.startDate);
    setSetupMode(planSchedule.mode);
    setSetupStartChoice('pick');
    setSetupAnchorDay(planSchedule.anchorDay ?? planSchedule.weekdays?.[0] ?? defaultWeekdays(splitDaysPerWeek)[0] ?? 1);
    setSetupFlexDayIndex(todayPlannedIndex >= 0 ? todayPlannedIndex : fallbackFlexDay);
    setShowScheduleEditor(true);
  };

  if (!currentWorkout) {
    if (workoutMode === 'flexible') {
      return (
        <motion.div className="pb-24 px-5 pt-8">
          <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">Flexible Training</p>
            <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Start Session</h1>
          </motion.header>

          <Card variant="slab" className="space-y-4">
            <p className="text-xs text-[var(--color-muted)]">Name your day and start training without a rigid split.</p>
            {flexTemplates.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Quick Start</p>
                <div className="flex flex-wrap gap-2">
                  {flexTemplates.slice(0, 4).map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className="px-3 py-1.5 rounded-[12px] border border-white/10 text-[10px] tracking-[0.08em] uppercase text-[#9A9A9A] hover:text-[#E8E4DE] hover:border-white/20 transition-colors"
                      onClick={() => {
                        setFlexibleDayLabel(template.label);
                        setSelectedTemplateLabel(template.label);
                        setShowFlexibleStart(true);
                      }}
                    >
                      {template.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Button onClick={() => setShowFlexibleStart(true)}>
              Start Flexible Workout
            </Button>
          </Card>

          <Modal
            isOpen={showFlexibleStart}
            onClose={() => setShowFlexibleStart(false)}
            title="Start Flexible Workout"
          >
            <div className="pt-4 space-y-4">
              <Input
                label="Day Label"
                value={flexibleDayLabel}
                onChange={(event) => setFlexibleDayLabel(event.target.value)}
                placeholder="Upper, Push, Arms, etc."
                maxLength={40}
              />

              {flexTemplates.length > 0 && (
                <div>
                  <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2">Quick Start Template (optional)</p>
                  <select
                    value={selectedTemplateLabel}
                    onChange={(event) => setSelectedTemplateLabel(event.target.value)}
                    className="w-full px-3 py-2 bg-[#1A1A1A] border border-white/10 rounded-[12px] text-sm text-[#E8E4DE]"
                  >
                    <option value="">None</option>
                    {flexTemplates.map((template) => (
                      <option key={template.id} value={template.label}>{template.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <Button
                className="w-full"
                onClick={() => { void handleStartFlexibleWorkout(); }}
                disabled={!flexibleDayLabel.trim() || startingFlexibleWorkout}
                loading={startingFlexibleWorkout}
              >
                {startingFlexibleWorkout ? 'Starting...' : 'Start Workout'}
              </Button>
            </div>
          </Modal>
        </motion.div>
      );
    }

    return (
      <motion.div
        className="pb-24 px-5 pt-8"
      >
        <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">
                {activeSplit?.name.toUpperCase()}
              </p>
              <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Training Plan</h1>
            </div>
            {planSchedule && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-0.5"
                onClick={openScheduleEditor}
              >
                <Settings2 className="w-3.5 h-3.5 mr-1.5" />
                Schedule
              </Button>
            )}
          </div>
        </motion.header>

        {!planSchedule ? (
          planScheduleResolving ? (
            <Card variant="slab" className="py-16">
              <div className="flex items-center justify-center gap-2 text-[var(--color-muted)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs tracking-wider">Loading saved plan setup...</span>
              </div>
            </Card>
          ) : (
            <Card variant="slab">
              <ScheduleEditor
                title="Start Plan"
                description="Set your Day 1 and weekly rhythm"
                daysPerWeek={activeSplit?.days_per_week || 0}
                splitDays={activeSplit?.days || []}
                startChoice={setupStartChoice}
                startDate={setupStartDate}
                mode={setupMode}
                anchorDay={setupAnchorDay}
                flexDayIndex={setupFlexDayIndex}
                onStartChoiceChange={setSetupStartChoice}
                onStartDateChange={setSetupStartDate}
                onModeChange={setSetupMode}
                onAnchorDayChange={setSetupAnchorDay}
                onFlexDayIndexChange={setSetupFlexDayIndex}
                onSave={() => {
                  void handleSavePlanSetup();
                }}
                saveLabel="Save Plan Setup"
                saving={savingPlanSchedule}
              />
            </Card>
          )
        ) : (
          <div className="space-y-4">
            <Card variant="slab" className="space-y-3">
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">Today</p>
              {todayCompletedWorkout ? (
                <>
                  <h3 className="text-[1rem] text-[var(--color-text)]">Workout completed</h3>
                  <p className="text-xs text-[var(--color-muted)]">Great work. You can rest or train a different day.</p>
                </>
              ) : todayPlannedDay ? (
                <>
                  <h3
                    className="text-[1rem] font-medium tracking-[0.02em]"
                    style={{ color: 'color-mix(in srgb, var(--color-text) 94%, white 6%)' }}
                  >
                    {todayPlannedDay.day_name}
                  </h3>
                  <p className="text-xs text-[var(--color-muted)]">Planned session for today.</p>
                  <Button onClick={() => handleStartWorkout(todayPlannedDay)} disabled={startingDayId !== null}>
                    {startingDayId === todayPlannedDay.id ? 'Starting...' : 'Start Today\'s Workout'}
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-[1rem] font-medium tracking-[0.02em] text-[var(--color-text)]">
                    Rest Day
                  </h3>
                  <p className="text-xs text-[var(--color-muted)]">No scheduled training today. Recovery is part of progress.</p>
                </>
              )}

              {lastCompletedWorkout && (
                <p className="text-[10px] text-[#8F8A83]">
                  Last trained: {format(parseISO(`${lastCompletedWorkout.date}T00:00:00`), 'EEE, MMM d')}
                </p>
              )}
            </Card>

            <Card variant="slab" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B]">Week View</p>
                <div className="flex gap-2">
                  <button
                    className="px-2 py-1 rounded-[8px] bg-[#2A2A2A] border border-white/5 text-[10px] text-[#9A9A9A]"
                    onClick={() => setWeekCursor((current) => addDays(current, -7))}
                  >
                    Prev
                  </button>
                  <button
                    className="px-2 py-1 rounded-[8px] bg-[#2A2A2A] border border-white/5 text-[10px] text-[#9A9A9A]"
                    onClick={() => setWeekCursor(new Date())}
                  >
                    This Week
                  </button>
                  <button
                    className="px-2 py-1 rounded-[8px] bg-[#2A2A2A] border border-white/5 text-[10px] text-[#9A9A9A]"
                    onClick={() => setWeekCursor((current) => addDays(current, 7))}
                  >
                    Next
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-2">
                {weekDays.map((date) => {
                  const dateKey = format(date, 'yyyy-MM-dd');
                  const workout = weekWorkouts.find((entry) => entry.date === dateKey && entry.completed);
                  const plannedDay = plannedDayForDate(date, activeSplit?.days || [], planSchedule, completedBefore(date));
                  const isToday = isSameDay(date, today);

                  let status: 'completed' | 'planned' | 'rest' | 'missed' = 'rest';
                  if (workout) {
                    status = 'completed';
                  } else if (plannedDay) {
                    status = isBefore(date, today) && !isToday ? 'missed' : 'planned';
                  }

                  const statusClass =
                    status === 'completed'
                      ? 'bg-[#253427] text-[#9AC39A] border-[#3D5C3F]'
                    : status === 'planned'
                        ? 'bg-[var(--color-surface-high)] text-[var(--color-text-dim)] border-[var(--color-border-strong)]'
                        : status === 'missed'
                          ? 'bg-[#3A2A2A] text-[#D39B9B] border-[#5C3D3D]'
                          : 'bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)]';

                  return (
                    <div
                      key={dateKey}
                      className={`relative rounded-[12px] border p-2 ${statusClass} ${
                        isToday ? 'ring-1 ring-[#E8E4DE]/35' : ''
                      }`}
                    >
                      <p className="text-[9px] tracking-[0.08em] uppercase">{weekdayLabels[date.getDay()]}</p>
                      <p className="text-xs tabular-nums">{format(date, 'd')}</p>
                      {status === 'completed' && (
                        <div className="absolute bottom-1 right-1">
                          <Check className="w-3 h-3" strokeWidth={2.5} />
                        </div>
                      )}
                      {status === 'missed' && (
                        <div className="absolute bottom-1 right-1">
                          <X className="w-3 h-3" strokeWidth={2.5} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card variant="slab" className="space-y-3">
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B]">Train a different day</p>
              <div className="space-y-2">
                {(activeSplit?.days || []).map((day) => (
                  <div key={day.id} className="flex items-center justify-between rounded-[12px] bg-[#2A2A2A] border border-white/5 px-3 py-2">
                    <div>
                      <p className="text-xs text-[#E8E4DE]">{day.day_name}</p>
                      <p className="text-[10px] text-[#6B6B6B]">{day.exercises?.length || 0} exercises</p>
                    </div>
                    <Button size="sm" onClick={() => handleStartWorkout(day)} disabled={startingDayId !== null}>
                      {startingDayId === day.id ? 'Starting...' : 'Start'}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        <Modal
          isOpen={showScheduleEditor}
          onClose={() => setShowScheduleEditor(false)}
          title="Edit Schedule"
        >
          <ScheduleEditor
            title="Adjust Plan"
            description="Update your start date, scheduling mode, and active training day."
            daysPerWeek={activeSplit?.days_per_week || 0}
            splitDays={activeSplit?.days || []}
            startChoice={setupStartChoice}
            startDate={setupStartDate}
            mode={setupMode}
            anchorDay={setupAnchorDay}
            flexDayIndex={setupFlexDayIndex}
            onStartChoiceChange={setSetupStartChoice}
            onStartDateChange={setSetupStartDate}
            onModeChange={setSetupMode}
            onAnchorDayChange={setSetupAnchorDay}
            onFlexDayIndexChange={setSetupFlexDayIndex}
            onSave={() => {
              void handleSavePlanSetup();
            }}
            onCancel={() => setShowScheduleEditor(false)}
            saveLabel="Save Changes"
            saving={savingPlanSchedule}
          />
        </Modal>

      </motion.div>
    );
  }

  return (
    <motion.div
      className="pb-24 px-5 pt-8"
    >
      <motion.header className="mb-8" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">In Progress</p>
            <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Session</h1>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCompleteWorkout}
          >
            Complete
          </Button>
        </div>

        {/* Progress */}
        <div className="text-center mb-3">
          <motion.p
            className="number-hero text-[#E8E4DE] mb-2"
            key={progress}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 0.3 }}
          >
            {Math.round(progress)}%
          </motion.p>
          <div className="h-2 bg-[#2E2E2E] rounded-[999px] overflow-hidden mb-2">
            <motion.div
              className="h-full gradient-progress-stone-sage"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <p className="label-section">
            {completedSets}/{totalSets} sets
          </p>
        </div>
      </motion.header>

      {workoutMode === 'flexible' && currentWorkout.split_day_id === null ? (
        <div className="space-y-3">
          <Card variant="slab" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Input
                label="Day Label"
                value={inSessionFlexibleDayLabel}
                onChange={(event) => setInSessionFlexibleDayLabel(event.target.value)}
                onBlur={handleInSessionDayLabelBlur}
                placeholder="Upper / Push / Legs"
                className="flex-1"
              />
              <Button
                variant="secondary"
                size="sm"
                className="mt-5"
                onClick={() => {
                  setSupersetPickerSourceExerciseId(null);
                  setShowExercisePicker(true);
                }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Exercise
              </Button>
            </div>
            <p className="text-[10px] text-[#6B6B6B]">Edit order, set targets, and notes anytime.</p>
          </Card>

          {activeFlexibleItems.length === 0 ? (
            <Card variant="slab" className="text-center py-10">
              <p className="text-xs text-[#6B6B6B] mb-3">No exercises yet.</p>
              <Button size="sm" onClick={() => setShowExercisePicker(true)}>
                Add First Exercise
              </Button>
            </Card>
          ) : (
            activeFlexibleItems.map((item, index) => {
              const exerciseId = item.exercise_id;
              const sets = (exerciseGroups[exerciseId] || []).sort((a, b) => a.set_number - b.set_number);
              const exerciseName = item.exercise_name || workoutExerciseMap.get(exerciseId)?.name || 'Exercise';
              const completedInExercise = sets.filter((set) => set.completed).length;
              const isActive = activeExerciseId === exerciseId;
              const allComplete = sets.length > 0 && completedInExercise === sets.length;
              const movementNote = movementNotes[exerciseId] || item.notes || '';
              const hasMovementNote = movementNote.trim().length > 0;
              const noteCharacters = movementNote.length;
              const canMoveUp = index > 0;
              const canMoveDown = index < activeFlexibleItems.length - 1;
              const supersetGroupId = item.superset_group_id || null;
              const supersetPartner = supersetGroupId
                ? activeFlexibleItems.find((candidate) => candidate.exercise_id !== exerciseId && candidate.superset_group_id === supersetGroupId)
                : null;

              return (
                <motion.div
                  key={exerciseId}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springs.smooth, delay: index * 0.05 }}
                >
                  <Card
                    variant="slab"
                    className={`transition-all ${
                      allComplete ? 'bg-sage-tint border-l-sage' :
                      isActive ? 'border-l-accent border-white/10' : ''
                    }`}
                  >
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setActiveExerciseId(isActive ? null : exerciseId)}
                    >
                      <div className="flex items-center gap-4">
                        <motion.div
                          className={`w-8 h-8 rounded-[12px] flex items-center justify-center ${allComplete ? 'bg-[#8B9A7D]/20' : 'bg-[#2E2E2E]'}`}
                          animate={allComplete ? { scale: [1, 1.1, 1] } : {}}
                          transition={{ duration: 0.3 }}
                        >
                          {allComplete ? (
                            <svg className="w-4 h-4 text-[#8B9A7D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <motion.path
                                d="M5 13l4 4L19 7"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.4, ease: 'easeOut' }}
                                strokeDasharray="0 1"
                              />
                            </svg>
                          ) : (
                            <span className="text-[10px] text-[#6B6B6B] tabular-nums">{completedInExercise}/{sets.length || normalizeFlexibleTargetSets(item.target_sets)}</span>
                          )}
                        </motion.div>
                        <div>
                          <p className="text-sm text-[#E8E4DE]">{exerciseName}</p>
                          {supersetPartner && (
                            <p className="mt-0.5 text-[10px] tracking-[0.08em] uppercase text-[#A8B89A]">
                              Superset with {supersetPartner.exercise_name || workoutExerciseMap.get(supersetPartner.exercise_id)?.name || 'Exercise'}
                            </p>
                          )}
                          {hasMovementNote && !isActive && (
                            <p className="mt-0.5 text-xs font-display-italic text-[var(--color-text-dim)] truncate max-w-[220px]">
                              {movementNote}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          disabled={!canMoveUp}
                          onClick={() => { void handleFlexibleReorder(exerciseId, 'up'); }}
                          className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={!canMoveDown}
                          onClick={() => { void handleFlexibleReorder(exerciseId, 'down'); }}
                          className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        {supersetGroupId ? (
                          <button
                            type="button"
                            onClick={() => { void clearFlexibleSuperset(exerciseId); }}
                            className="p-1.5 rounded-[8px] text-[#8B9A7D] hover:text-[#BFD0AF] hover:bg-white/5 transition-colors"
                            title="Remove Superset"
                          >
                            <Unlink2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSupersetPickerSourceExerciseId(exerciseId);
                              setShowExercisePicker(true);
                            }}
                            className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 transition-colors"
                            title="Add Superset"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { void removeFlexibleExerciseFromPlan(exerciseId); }}
                          className="p-1.5 rounded-[8px] text-[#8B6B6B] hover:text-[#D39B9B] hover:bg-white/5 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <motion.div
                          animate={{ rotate: isActive ? 90 : 0 }}
                          transition={springs.snappy}
                        >
                          <ChevronRight className="w-4 h-4 text-[#6B6B6B]" />
                        </motion.div>
                      </div>
                    </div>

                    <AnimatePresence>
                      {isActive && (
                        <motion.div
                          className="mt-5 pt-5 border-t border-white/5 space-y-2"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={springs.smooth}
                        >
                          <motion.div
                            className="mb-2 rounded-[12px] bg-[#242424] border border-white/5 px-3 py-2"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={springs.smooth}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[10px] text-[#6B6B6B]">Target sets</p>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={1}
                                  max={12}
                                  value={normalizeFlexibleTargetSets(item.target_sets)}
                                  onChange={(event) => {
                                    handleFlexibleTargetSetsChange(exerciseId, Number(event.target.value));
                                  }}
                                  className="w-16 px-2 py-1 rounded-[8px] bg-[#1A1A1A] border border-white/10 text-xs text-[#E8E4DE]"
                                />
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded-[8px] text-[10px] border border-white/10 text-[#6B6B6B] hover:text-[#E8E4DE] hover:border-white/20 disabled:opacity-35 disabled:pointer-events-none transition-colors"
                                  onClick={() => { void removeLastUncompletedSet(exerciseId); }}
                                  disabled={!sets.some((set) => !set.completed)}
                                >
                                  - Remove set
                                </button>
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded-[8px] text-[10px] border border-white/10 text-[#6B6B6B] hover:text-[#E8E4DE] hover:border-white/20 transition-colors"
                                  onClick={() => { void addWorkoutSet(exerciseId); }}
                                >
                                  + Add set
                                </button>
                              </div>
                            </div>
                          </motion.div>

                          {sets.map((set, idx) => {
                            const previousSetTarget = previousWorkoutSetsByExercise[exerciseId]?.[set.set_number];
                            const formattedTarget = previousSetTarget ? formatSetPerformanceTarget(previousSetTarget) : '';
                            const performanceStatus = set.completed && previousSetTarget
                              ? compareSetPerformance({ weight: set.weight, reps: set.reps }, previousSetTarget)
                              : 'unknown';

                            const statusLabel = performanceStatus === 'beat'
                              ? 'Beat'
                              : performanceStatus === 'matched'
                                ? 'Matched'
                                : performanceStatus === 'below'
                                  ? 'Below'
                                  : null;

                            const statusClass = performanceStatus === 'beat'
                              ? 'text-[#8B9A7D]'
                              : performanceStatus === 'matched'
                                ? 'text-[#B6B1A8]'
                                : 'text-[#C48D8D]';

                            return (
                              <motion.div
                                key={set.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.05, ...springs.smooth }}
                              >
                                {formattedTarget && (
                                  <div className="mb-1.5 flex items-center justify-between rounded-[10px] border border-white/5 bg-[#202020] px-2.5 py-1.5">
                                    <p className="text-[10px] text-[#7C7C7C]">
                                      Target to beat: <span className="tabular-nums text-[#D4CEC2]">{formattedTarget}</span>
                                    </p>
                                    {statusLabel && (
                                      <p className={`text-[10px] tracking-[0.08em] uppercase ${statusClass}`}>
                                        {statusLabel}
                                      </p>
                                    )}
                                  </div>
                                )}
                                <SetLogger
                                  set={set}
                                  setNumber={idx + 1}
                                  onBeforeComplete={validateSupersetOrderBeforeLog}
                                  onComplete={handleSetLogged}
                                />
                              </motion.div>
                            );
                          })}

                          <motion.div
                            className="mt-4 pt-3 border-t border-white/[0.03]"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: sets.length * 0.05, ...springs.smooth }}
                          >
                            <label
                              htmlFor={`movement-note-${exerciseId}`}
                              className="block text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)] mb-2"
                            >
                              Movement Note
                            </label>
                            <textarea
                              id={`movement-note-${exerciseId}`}
                              value={movementNote}
                              onChange={(event) => {
                                handleMovementNoteChange(exerciseId, event.target.value);
                                void updateFlexibleExerciseMeta(exerciseId, { notes: event.target.value.slice(0, 200) });
                              }}
                              onBlur={() => handleMovementNoteBlur(exerciseId)}
                              rows={1}
                              maxLength={200}
                              placeholder="Note - technique, feel, cues..."
                              className="w-full bg-transparent border-b border-white/10 pb-2 text-sm font-display-italic text-[var(--color-text)] placeholder:text-[color-mix(in_srgb,var(--color-muted)_60%,transparent)] focus:outline-none focus:border-[var(--color-accent)] resize-none overflow-y-auto max-h-28"
                            />
                            <div className="mt-1.5 flex items-center justify-between">
                              <div>
                                {savingMovementNoteId === exerciseId ? (
                                  <p className="text-[10px] tracking-[0.1em] uppercase text-[var(--color-muted)]">Saving...</p>
                                ) : savedMovementNoteId === exerciseId ? (
                                  <p className="text-[10px] tracking-[0.1em] uppercase text-[var(--color-sage)]">Saved</p>
                                ) : null}
                              </div>
                              {noteCharacters >= 160 && (
                                <p className="text-[10px] tabular-nums text-[var(--color-muted)]">{noteCharacters}/200</p>
                              )}
                            </div>
                          </motion.div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                </motion.div>
              );
            })
          )}

          <ExercisePicker
            isOpen={showExercisePicker}
            onClose={() => {
              setShowExercisePicker(false);
              setSupersetPickerSourceExerciseId(null);
            }}
            onSelect={(exercise) => {
              setShowExercisePicker(false);

              if (supersetPickerSourceExerciseId) {
                void addFlexibleSuperset(supersetPickerSourceExerciseId, exercise);
                setSupersetPickerSourceExerciseId(null);
                return;
              }

              void addFlexibleExercise(exercise);
            }}
            excludeExerciseIds={activeFlexibleItems.map((item) => item.exercise_id)}
            title={supersetPickerSourceExerciseId ? 'Add Superset Exercise' : 'Add Exercise'}
          />
        </div>
      ) : (
      /* Exercises */
      <div className="space-y-3">
        {orderedExerciseEntries.map(([exerciseId, sets], index) => {
          const rawSet = sets[0] as WorkoutSet & { exercises?: { name?: string } };
          const exerciseName = rawSet.exercise?.name || rawSet.exercises?.name || 'Unknown Exercise';
          const completedInExercise = sets.filter(s => s.completed).length;
          const isActive = activeExerciseId === exerciseId;
          const allComplete = completedInExercise === sets.length;
          const movementNote = movementNotes[exerciseId] || '';
          const hasMovementNote = movementNote.trim().length > 0;
          const noteCharacters = movementNote.length;
          const isFirst = index === 0;
          const isLast = index === orderedExerciseEntries.length - 1;
          const supersetGroupId = splitSupersetByExerciseId.get(exerciseId) || null;
          const supersetPartnerId = splitSupersetPartnerByExerciseId.get(exerciseId) || null;
          const supersetPartnerName = supersetPartnerId
            ? (workoutExerciseMap.get(supersetPartnerId)?.name || 'Exercise')
            : null;
          const setRange = exerciseSetRanges.get(exerciseId) ?? { minSets: sets.length, targetSets: sets.length, maxSets: sets.length };
          const canAddSet = sets.length < setRange.maxSets;
          const hasRemovableUncompletedSet = sets.some((set) => !set.completed);
          const canRemoveSet = sets.length > setRange.minSets && hasRemovableUncompletedSet;

          return (
            <motion.div
              key={exerciseId}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.smooth, delay: index * 0.05 }}
            >
              <Card
                variant="slab"
                className={`transition-all ${
                  allComplete ? 'bg-sage-tint border-l-sage' :
                  isActive ? 'border-l-accent border-white/10' : ''
                }`}
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setActiveExerciseId(isActive ? null : exerciseId)}
                >
                  <div className="flex items-center gap-4">
                    <motion.div
                      className={`w-8 h-8 rounded-[12px] flex items-center justify-center ${allComplete ? 'bg-[#8B9A7D]/20' : 'bg-[#2E2E2E]'}`}
                      animate={allComplete ? { scale: [1, 1.1, 1] } : {}}
                      transition={{ duration: 0.3 }}
                    >
                      {allComplete ? (
                        <svg className="w-4 h-4 text-[#8B9A7D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <motion.path
                            d="M5 13l4 4L19 7"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                            strokeDasharray="0 1"
                          />
                        </svg>
                      ) : (
                        <span className="text-[10px] text-[#6B6B6B] tabular-nums">{completedInExercise}/{sets.length}</span>
                      )}
                    </motion.div>
                    <div>
                      <p className="text-sm text-[#E8E4DE]">{exerciseName}</p>
                      {supersetGroupId && supersetPartnerName && (
                        <p className="mt-0.5 text-[10px] tracking-[0.08em] uppercase text-[#A8B89A]">
                          Superset with {supersetPartnerName}
                        </p>
                      )}
                      {hasMovementNote && !isActive && (
                        <p className="mt-0.5 text-xs font-display-italic text-[var(--color-text-dim)] truncate max-w-[220px]">
                          {movementNote}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {orderedExerciseEntries.length > 1 && (
                      <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={isFirst}
                          onClick={() => moveExercise(exerciseId, 'up')}
                          className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                          aria-label={`Move ${exerciseName} up`}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isLast}
                          onClick={() => moveExercise(exerciseId, 'down')}
                          className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                          aria-label={`Move ${exerciseName} down`}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <motion.div
                      animate={{ rotate: isActive ? 90 : 0 }}
                      transition={springs.snappy}
                    >
                      <ChevronRight className="w-4 h-4 text-[#6B6B6B]" />
                    </motion.div>
                  </div>
                </div>

                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      className="mt-5 pt-5 border-t border-white/5 space-y-2"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={springs.smooth}
                    >
                      <motion.div
                        className="mb-2 rounded-[12px] bg-[#242424] border border-white/5 px-3 py-2"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={springs.smooth}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] text-[#6B6B6B]">Range {setRange.minSets}-{setRange.maxSets} • Target {setRange.targetSets}</p>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              className="px-2 py-1 rounded-[8px] text-[10px] border border-white/10 text-[#6B6B6B] hover:text-[#E8E4DE] hover:border-white/20 disabled:opacity-35 disabled:pointer-events-none transition-colors"
                              onClick={() => { void removeLastUncompletedSet(exerciseId); }}
                              disabled={!canRemoveSet}
                            >
                              - Remove set
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 rounded-[8px] text-[10px] border border-white/10 text-[#6B6B6B] hover:text-[#E8E4DE] hover:border-white/20 disabled:opacity-35 disabled:pointer-events-none transition-colors"
                              onClick={() => { void addWorkoutSet(exerciseId); }}
                              disabled={!canAddSet}
                            >
                              + Add set
                            </button>
                          </div>
                        </div>
                      </motion.div>

                      {sets.map((set, idx) => {
                        const previousSetTarget = previousWorkoutSetsByExercise[exerciseId]?.[set.set_number];
                        const formattedTarget = previousSetTarget ? formatSetPerformanceTarget(previousSetTarget) : '';
                        const performanceStatus = set.completed && previousSetTarget
                          ? compareSetPerformance({ weight: set.weight, reps: set.reps }, previousSetTarget)
                          : 'unknown';

                        const statusLabel = performanceStatus === 'beat'
                          ? 'Beat'
                          : performanceStatus === 'matched'
                            ? 'Matched'
                            : performanceStatus === 'below'
                              ? 'Below'
                              : null;

                        const statusClass = performanceStatus === 'beat'
                          ? 'text-[#8B9A7D]'
                          : performanceStatus === 'matched'
                            ? 'text-[#B6B1A8]'
                            : 'text-[#C48D8D]';

                        return (
                          <motion.div
                            key={set.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05, ...springs.smooth }}
                          >
                            {formattedTarget && (
                              <div className="mb-1.5 flex items-center justify-between rounded-[10px] border border-white/5 bg-[#202020] px-2.5 py-1.5">
                                <p className="text-[10px] text-[#7C7C7C]">
                                  Target to beat: <span className="tabular-nums text-[#D4CEC2]">{formattedTarget}</span>
                                </p>
                                {statusLabel && (
                                  <p className={`text-[10px] tracking-[0.08em] uppercase ${statusClass}`}>
                                    {statusLabel}
                                  </p>
                                )}
                              </div>
                            )}
                            <SetLogger
                              set={set}
                              setNumber={idx + 1}
                              onComplete={() => setShowRestTimer(true)}
                            />
                          </motion.div>
                        );
                      })}

                      <motion.div
                        className="mt-4 pt-3 border-t border-white/[0.03]"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: sets.length * 0.05, ...springs.smooth }}
                      >
                        <label
                          htmlFor={`movement-note-${exerciseId}`}
                          className="block text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)] mb-2"
                        >
                          Movement Note
                        </label>
                        <textarea
                          id={`movement-note-${exerciseId}`}
                          value={movementNote}
                          onChange={(event) => handleMovementNoteChange(exerciseId, event.target.value)}
                          onBlur={() => handleMovementNoteBlur(exerciseId)}
                          rows={1}
                          maxLength={200}
                          placeholder="Note - technique, feel, cues..."
                          className="w-full bg-transparent border-b border-white/10 pb-2 text-sm font-display-italic text-[var(--color-text)] placeholder:text-[color-mix(in_srgb,var(--color-muted)_60%,transparent)] focus:outline-none focus:border-[var(--color-accent)] resize-none overflow-y-auto max-h-28"
                        />
                        <div className="mt-1.5 flex items-center justify-between">
                          <div>
                            {savingMovementNoteId === exerciseId ? (
                              <p className="text-[10px] tracking-[0.1em] uppercase text-[var(--color-muted)]">Saving...</p>
                            ) : savedMovementNoteId === exerciseId ? (
                              <p className="text-[10px] tracking-[0.1em] uppercase text-[var(--color-sage)]">Saved</p>
                            ) : null}
                          </div>
                          {noteCharacters >= 160 && (
                            <p className="text-[10px] tabular-nums text-[var(--color-muted)]">{noteCharacters}/200</p>
                          )}
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            </motion.div>
          );
        })}
      </div>
      )}

      {/* Rest Timer Modal */}
      <Modal
        isOpen={showRestTimer}
        onClose={() => setShowRestTimer(false)}
        title="Rest"
      >
        <RestTimer
          onComplete={() => setShowRestTimer(false)}
        />
      </Modal>

      {/* Complete Confirmation Modal */}
      <Modal
        isOpen={showCompleteConfirm}
        onClose={() => setShowCompleteConfirm(false)}
        title="Finish Workout?"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#E8E4DE]">
            You've completed <span className="text-[#E8E4DE] font-medium">{completedSets}</span> out of <span className="text-[#E8E4DE] font-medium">{totalSets}</span> sets.
          </p>
          <p className="text-xs text-[#6B6B6B]">
            Are you sure you want to finish this workout? Remaining sets will not be logged.
          </p>
          <div className="flex gap-3 pt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowCompleteConfirm(false)}
            >
              Keep Training
            </Button>
            <Button
              className="flex-1"
              onClick={handleConfirmComplete}
            >
              Finish
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showSaveTemplatePrompt}
        onClose={() => setShowSaveTemplatePrompt(false)}
        title="Save Quick-Start Template?"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#E8E4DE]">
            Save this day as quick-start template <span className="font-medium">{currentWorkoutDayPlan?.day_label || 'Template'}</span>?
          </p>
          <p className="text-xs text-[#6B6B6B]">
            If this label already exists, it will be overwritten with your latest exercise order and notes.
          </p>
          <div className="flex gap-3 pt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setShowSaveTemplatePrompt(false);
                void completeWorkout();
              }}
            >
              Skip
            </Button>
            <Button
              className="flex-1"
              onClick={() => { void handleSaveTemplateAtCompletion(); }}
              loading={savingTemplate}
              disabled={savingTemplate}
            >
              {savingTemplate ? 'Saving...' : 'Save Template'}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
