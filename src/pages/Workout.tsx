import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Dumbbell,
  Link2,
  Loader2,
  Minus,
  Moon,
  Plus,
  Settings2,
  Trash2,
  Unlink2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { addDays, format, isBefore, isSameDay, parseISO, startOfWeek } from 'date-fns';
import { Button, Card, Chip, EmptyState, Input, Modal, RailStrip, TickStrip } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { WorkoutSetRow } from '@/components/workout/WorkoutSetRow';
import { RestTimerPill } from '@/components/workout/RestTimerPill';
import { ScheduleEditor } from '@/components/workout/ScheduleEditor';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { springs } from '@/lib/animations';
import { parseWorkoutNotes, serializeWorkoutNotes, type WorkoutNotesPayload } from '@/lib/workoutNotes';
import { clearRestTimerSession, isRestTimerForWorkout, readRestTimerSession, saveRestTimerSession, syncRestTimerSession } from '@/lib/restTimer';
import { getSetAutofillValues, type PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { supabase } from '@/lib/supabase';
import { buildFixedWeekdays, defaultStartDate, defaultWeekdays, loadWithBackgroundSync, plannedDayForDate, savePlanSchedule, type PlanMode, type PlanSchedule } from '@/lib/planSchedule';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import { formatWorkoutDuration } from '@/lib/workoutSessions';
import type { Exercise, SplitDay, Workout, WorkoutSet } from '@/types';

function normalizeIndex(value: number, size: number): number {
  if (size <= 0) return 0;
  return ((value % size) + size) % size;
}

function normalizeFlexibleTargetSets(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(12, Math.round(value)));
}

function normalizeOptionalMetric(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

type SupersetRole = 'A' | 'B';

type SupersetFlow = {
  groupId: string;
  role: SupersetRole;
  partnerExerciseId: string;
};

type PreviousWorkoutSummary = { id: string };
type PreviousSetSummary = {
  workout_id: string;
  exercise_id: string;
  set_number: number | string;
  weight: number | string | null;
  reps: number | string | null;
  rpe: number | string | null;
  completed: boolean;
};

type CompletionSummary = {
  title: string;
  completedSets: number;
  totalSets: number;
  duration: string;
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
  const navigate = useNavigate();
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);
  const [savingPlanSchedule, setSavingPlanSchedule] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [restTimerSeed, setRestTimerSeed] = useState(0);
  const [sessionElapsedNow, setSessionElapsedNow] = useState(() => Date.now());
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
  const [previousWorkoutSetsByExercise, setPreviousWorkoutSetsByExercise] = useState<PreviousWorkoutSetMap>({});
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const [flexibleTargetSetDrafts, setFlexibleTargetSetDrafts] = useState<Record<string, string>>({});
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null);
  const movementNotesRef = useRef<Record<string, string>>({});
  const noteSaveTimersRef = useRef<Record<string, number>>({});
  const lastPersistedNotesRef = useRef<string>('');
  const planScheduleRequestRef = useRef(0);

  const [setupStartDate, setSetupStartDate] = useState(defaultStartDate());
  const [setupStartChoice, setSetupStartChoice] = useState<'today' | 'tomorrow' | 'pick'>('today');
  const [setupMode, setSetupMode] = useState<PlanMode>('fixed');
  const [setupAnchorDay, setSetupAnchorDay] = useState(1);
  const [setupFlexDayIndex, setSetupFlexDayIndex] = useState(0);

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
  const currentWorkoutCreatedAt = currentWorkout?.created_at || null;

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
    setFlexibleTargetSetDrafts({});
  }, [currentWorkoutId]);

  useEffect(() => {
    if (!currentWorkoutCreatedAt) return;

    setSessionElapsedNow(Date.now());
    const intervalId = window.setInterval(() => {
      setSessionElapsedNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentWorkoutCreatedAt]);

  useEffect(() => {
    if (!currentWorkoutId) {
      setShowRestTimer(false);
      return;
    }

    const syncStoredRestTimer = () => {
      const storedSession = readRestTimerSession();
      if (!storedSession || !isRestTimerForWorkout(storedSession, currentWorkoutId)) return;

      const syncedSession = syncRestTimerSession(storedSession);
      saveRestTimerSession(syncedSession);
      setShowRestTimer(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncStoredRestTimer();
      }
    };

    syncStoredRestTimer();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', syncStoredRestTimer);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', syncStoredRestTimer);
    };
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
    lastPersistedNotesRef.current = serializeWorkoutNotes(
      initialPayload.movementNotes || {},
      initialPayload.legacyNote
    );
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
        .select('workout_id, exercise_id, set_number, weight, reps, rpe, completed')
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

      const groupedTargets: PreviousWorkoutSetMap = {};

      for (const set of bestByExerciseAndSet.values()) {
        const parsedSetNumber = typeof set.set_number === 'number'
          ? set.set_number
          : Number.parseInt(String(set.set_number), 10);

        if (!Number.isFinite(parsedSetNumber)) continue;

        if (!groupedTargets[set.exercise_id]) {
          groupedTargets[set.exercise_id] = {};
        }

        groupedTargets[set.exercise_id][parsedSetNumber] = {
          weight: normalizeOptionalMetric(set.weight),
          reps: normalizeOptionalMetric(set.reps),
          rpe: normalizeOptionalMetric(set.rpe),
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

    const serializedPayload = serializeWorkoutNotes(
      movementNotesRef.current,
      legacyWorkoutNote || undefined
    );

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
    } finally {
      setStartingFlexibleWorkout(false);
    }
  };

  const handleFlexibleTargetSetDraftChange = (exerciseId: string, value: string) => {
    setFlexibleTargetSetDrafts((prev) => ({
      ...prev,
      [exerciseId]: value,
    }));
  };

  const handleFlexibleTargetSetBlur = (exerciseId: string, fallbackValue: number) => {
    const draftValue = flexibleTargetSetDrafts[exerciseId];
    if (typeof draftValue !== 'string') return;

    const parsed = Number.parseInt(draftValue, 10);
    setFlexibleTargetSetDrafts((prev) => {
      const next = { ...prev };
      delete next[exerciseId];
      return next;
    });

    if (!Number.isFinite(parsed)) return;

    const targetSets = normalizeFlexibleTargetSets(parsed);
    if (targetSets !== fallbackValue) {
      void updateFlexibleExerciseMeta(exerciseId, { target_sets: targetSets });
    }
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

  const handleSetLogged = (loggedSet: WorkoutSet) => {
    if (loggedSet.completed) return;

    const supersetFlow = supersetFlowMap.get(loggedSet.exercise_id);

    if (!supersetFlow) {
      setRestTimerSeed((current) => current + 1);
      setShowRestTimer(true);
      return;
    }

    if (supersetFlow.role === 'B') {
      setRestTimerSeed((current) => current + 1);
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
  const currentSessionTitle = currentWorkout?.split_day_id === null
    ? currentWorkoutDayPlan?.day_label || 'Flexible Session'
    : splitDay?.day_name || 'Session';
  const sessionDurationLabel = currentWorkoutCreatedAt
    ? formatWorkoutDuration(Math.max(0, sessionElapsedNow - new Date(currentWorkoutCreatedAt).getTime()))
    : '—';
  // ── End exercise ordering ──

  const captureCompletionSummary = () => {
    setCompletionSummary({
      title: currentSessionTitle,
      completedSets,
      totalSets,
      duration: sessionDurationLabel,
    });
  };

  const handleCompleteWorkout = async () => {
    if (completedSets < totalSets && totalSets > 0) {
      setShowCompleteConfirm(true);
      return;
    }

    if (workoutMode === 'flexible' && currentWorkout?.split_day_id === null) {
      setShowSaveTemplatePrompt(true);
      return;
    }

    captureCompletionSummary();
    await completeWorkout();
    clearRestTimerSession();
    setShowRestTimer(false);
  };

  const handleConfirmComplete = async () => {
    setShowCompleteConfirm(false);

    if (workoutMode === 'flexible' && currentWorkout?.split_day_id === null) {
      setShowSaveTemplatePrompt(true);
      return;
    }

    captureCompletionSummary();
    await completeWorkout();
    clearRestTimerSession();
    setShowRestTimer(false);
  };

  const handleSaveTemplateAtCompletion = async () => {
    try {
      setSavingTemplate(true);
      await saveFlexibleTemplateFromCurrentWorkout();
      setShowSaveTemplatePrompt(false);
      captureCompletionSummary();
      await completeWorkout();
      clearRestTimerSession();
      setShowRestTimer(false);
      await fetchFlexTemplates();
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSkipTemplateAtCompletion = () => {
    setShowSaveTemplatePrompt(false);
    captureCompletionSummary();
    void completeWorkout();
    clearRestTimerSession();
    setShowRestTimer(false);
  };

  /* ═══════════════ Initializing ═══════════════ */

  if (initializing) {
    return (
      <motion.div className="px-5 pt-6 pb-nav" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <header className="mb-6">
          <p className="t-label-sm mb-1">Train</p>
          <h1 className="t-title">Session</h1>
        </header>
        <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-5">
          <div className="flex items-center justify-center gap-2 py-14 text-[var(--color-muted)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-medium">Loading program…</span>
          </div>
        </div>
      </motion.div>
    );
  }

  /* ═══════════════ No program (split mode) ═══════════════ */

  if (workoutMode === 'split' && !activeSplit) {
    return (
      <motion.div className="px-5 pt-6 pb-nav" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <header className="mb-6">
          <p className="t-label-sm mb-1">Train</p>
          <h1 className="t-title">Session</h1>
        </header>
        <EmptyState
          icon={Dumbbell}
          title="No program yet"
          body="A program turns sessions into a plan: days, exercises, and weekly volume that adds up. The guided builder takes two minutes."
          action={
            <Button size="lg" onClick={() => navigate('/train/program')}>
              Build my program
            </Button>
          }
        />
      </motion.div>
    );
  }

  const splitDays = activeSplit?.days || [];
  const splitDaysPerWeek = activeSplit?.days_per_week || 0;

  const weekdayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

  /* ═══════════════ Pre-session ═══════════════ */

  if (!currentWorkout) {
    if (workoutMode === 'flexible') {
      const completionSheet = (
        <CompletionSheet summary={completionSummary} onClose={() => setCompletionSummary(null)} />
      );

      return (
        <motion.div className="px-5 pt-6 pb-nav" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <header className="mb-6">
            <p className="t-label-sm mb-1">Train · Flexible</p>
            <h1 className="t-title">Start a session</h1>
          </header>

          <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] hairline-strong p-5 relative overflow-hidden">
            <div
              className="absolute inset-x-0 top-0 h-[2.5px]"
              style={{ background: 'linear-gradient(to right, var(--color-accent), transparent 70%)' }}
            />
            <Input
              label="What are you training?"
              value={flexibleDayLabel}
              onChange={(event) => {
                const next = event.target.value;
                setFlexibleDayLabel(next);
                if (selectedTemplateLabel && next !== selectedTemplateLabel) {
                  setSelectedTemplateLabel('');
                }
              }}
              placeholder="Upper, Push, Arms…"
              maxLength={40}
            />

            {flexTemplates.length > 0 && (
              <div className="mt-4">
                <p className="t-label-sm mb-2">Quick start</p>
                <div className="flex flex-wrap gap-2">
                  {flexTemplates.slice(0, 6).map((template) => {
                    const selected = selectedTemplateLabel === template.label;
                    return (
                      <Chip
                        key={template.id}
                        tone="amber"
                        selected={selected}
                        onClick={() => {
                          if (selected) {
                            setSelectedTemplateLabel('');
                            setFlexibleDayLabel('');
                          } else {
                            setSelectedTemplateLabel(template.label);
                            setFlexibleDayLabel(template.label);
                          }
                        }}
                      >
                        {template.label}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}

            <Button
              size="lg"
              className="w-full mt-5"
              onClick={() => { void handleStartFlexibleWorkout(); }}
              disabled={!flexibleDayLabel.trim() || startingFlexibleWorkout}
              loading={startingFlexibleWorkout}
            >
              {startingFlexibleWorkout ? 'Starting…' : 'Start session'}
            </Button>
          </div>
          {completionSheet}
        </motion.div>
      );
    }

    return (
      <motion.div className="px-5 pt-6 pb-nav" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <header className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="t-label-sm mb-1 truncate">Train · {activeSplit?.name}</p>
            <h1 className="t-title">Today</h1>
          </div>
          {planSchedule && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={openScheduleEditor}>
              <Settings2 className="w-3.5 h-3.5" />
              Schedule
            </Button>
          )}
        </header>

        {!planSchedule ? (
          planScheduleResolving ? (
            <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-5">
              <div className="flex items-center justify-center gap-2 py-14 text-[var(--color-muted)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-medium">Loading saved plan setup…</span>
              </div>
            </div>
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
            {/* Today hero */}
            {todayCompletedWorkout ? (
              <div className="rounded-[var(--radius-lg)] bg-sage-tint hairline p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-sage)]">
                    <Check className="w-3 h-3 text-[var(--color-base)]" strokeWidth={3.5} />
                  </span>
                  <span className="t-label text-[var(--color-sage)]">Trained today</span>
                </div>
                <p className="t-display text-[1.4rem] text-[var(--color-text)]">The work is banked.</p>
                <p className="t-caption mt-1.5">Rest, or pick a different day below.</p>
              </div>
            ) : todayPlannedDay ? (
              <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] hairline-strong p-5 relative overflow-hidden">
                <div
                  className="absolute inset-x-0 top-0 h-[2.5px]"
                  style={{ background: 'linear-gradient(to right, var(--color-accent), transparent 70%)' }}
                />
                <p className="t-label text-[var(--color-accent)] mb-1.5">Today</p>
                <h2 className="t-title mb-2">{todayPlannedDay.day_name}</h2>
                <div className="flex items-center gap-3 mb-4">
                  <TickStrip total={Math.min(todayPlannedDay.exercises?.length || 0, 16)} filled={0} tone="amber" size="sm" />
                  <span className="t-data-sm text-[var(--color-text-dim)]">
                    {todayPlannedDay.exercises?.length || 0} exercises ·{' '}
                    {(todayPlannedDay.exercises || []).reduce((sum, ex) => sum + (ex.target_sets || 0), 0)} sets
                  </span>
                </div>
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => handleStartWorkout(todayPlannedDay)}
                  disabled={startingDayId !== null}
                  loading={startingDayId === todayPlannedDay.id}
                >
                  <Dumbbell className="w-4 h-4" strokeWidth={2.25} />
                  {startingDayId === todayPlannedDay.id ? 'Starting…' : "Start today's workout"}
                </Button>
              </div>
            ) : (
              <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Moon className="w-4 h-4 text-[var(--color-stone)]" strokeWidth={1.75} />
                  <span className="t-label">Rest day</span>
                </div>
                <p className="t-display text-[1.3rem] text-[var(--color-text-dim)]">Recovery is part of the program.</p>
              </div>
            )}

            {lastCompletedWorkout && (
              <p className="t-caption px-1">
                Last trained {format(parseISO(`${lastCompletedWorkout.date}T00:00:00`), 'EEE, MMM d')}
              </p>
            )}

            {/* Week strip */}
            <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="t-label-sm">{format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d')}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Previous week"
                    className="pressable p-2 rounded-[var(--radius-xs)] text-[var(--color-muted)]"
                    onClick={() => setWeekCursor((current) => addDays(current, -7))}
                  >
                    <ChevronLeft className="w-4 h-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    className="pressable px-2.5 py-1.5 rounded-[var(--radius-xs)] text-[11px] font-semibold text-[var(--color-text-dim)]"
                    onClick={() => setWeekCursor(new Date())}
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    aria-label="Next week"
                    className="pressable p-2 rounded-[var(--radius-xs)] text-[var(--color-muted)]"
                    onClick={() => setWeekCursor((current) => addDays(current, 7))}
                  >
                    <ChevronRight className="w-4 h-4" strokeWidth={2} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
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

                  const cellClass =
                    status === 'completed'
                      ? 'bg-sage-tint'
                      : status === 'missed'
                        ? 'bg-rose-tint'
                        : status === 'planned'
                          ? 'bg-[var(--color-surface-2)]'
                          : 'bg-transparent';

                  return (
                    <div
                      key={dateKey}
                      className={`relative flex flex-col items-center gap-1 rounded-[var(--radius-sm)] py-2 border ${cellClass} ${
                        isToday ? 'border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)]' : 'border-[var(--color-border)]'
                      }`}
                    >
                      <span className="t-label-sm text-[9px]">{weekdayLetters[date.getDay()]}</span>
                      <span className={`t-data-sm ${isToday ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)]'}`}>
                        {format(date, 'd')}
                      </span>
                      <span className="h-3 flex items-center">
                        {status === 'completed' ? (
                          <Check className="w-3 h-3 text-[var(--color-sage)]" strokeWidth={3} />
                        ) : status === 'missed' ? (
                          <X className="w-3 h-3 text-[var(--color-rose)]" strokeWidth={2.5} />
                        ) : status === 'planned' ? (
                          <span className="w-[3px] h-2.5 rounded-full bg-[var(--color-stone)]" />
                        ) : (
                          <span className="w-1 h-1 rounded-full bg-[color-mix(in_srgb,var(--color-muted)_35%,transparent)]" />
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Other days */}
            <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-4">
              <p className="t-label-sm mb-3">Train a different day</p>
              <div className="space-y-2">
                {(activeSplit?.days || []).map((day) => (
                  <div
                    key={day.id}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] hairline px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-text)] truncate">{day.day_name}</p>
                      <p className="text-[11px] text-[var(--color-muted)]">{day.exercises?.length || 0} exercises</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => handleStartWorkout(day)} disabled={startingDayId !== null}>
                      {startingDayId === day.id ? 'Starting…' : 'Start'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <Modal isOpen={showScheduleEditor} onClose={() => setShowScheduleEditor(false)} title="Edit Schedule">
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

        <CompletionSheet summary={completionSummary} onClose={() => setCompletionSummary(null)} />
      </motion.div>
    );
  }

  /* ═══════════════ In session ═══════════════ */

  const isFlexibleSession = workoutMode === 'flexible' && currentWorkout.split_day_id === null;

  return (
    <motion.div className={`px-5 ${showRestTimer ? 'pb-44' : 'pb-nav'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Sticky session header */}
      <div
        className="sticky z-30 -mx-5 px-5 pt-4 pb-3 mb-4 border-b border-[var(--color-border)]"
        style={{
          top: 0,
          backgroundColor: 'color-mix(in srgb, var(--color-base) 86%, transparent)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="min-w-0">
            <p className="t-label-sm flex items-center gap-1.5 mb-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-breathe" />
              In session
            </p>
            <h1 className="t-heading truncate">{currentSessionTitle}</h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <p className="t-data text-[var(--color-text)]">{sessionDurationLabel}</p>
              <p className="text-[10px] font-semibold text-[var(--color-muted)] tabular-nums">
                {completedSets}/{totalSets} sets
              </p>
            </div>
            <Button size="sm" onClick={handleCompleteWorkout}>
              Finish
            </Button>
          </div>
        </div>
        {totalSets > 0 && totalSets <= 40 ? (
          <TickStrip total={totalSets} filled={completedSets} tone="amber" size="sm" live={completedSets < totalSets} />
        ) : (
          <RailStrip value={progress / 100} tone="amber" size="sm" />
        )}
      </div>

      {isFlexibleSession ? (
        <div className="space-y-3">
          <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-4">
            <div className="flex items-end gap-3">
              <Input
                label="Day label"
                value={inSessionFlexibleDayLabel}
                onChange={(event) => setInSessionFlexibleDayLabel(event.target.value)}
                onBlur={handleInSessionDayLabelBlur}
                placeholder="Upper / Push / Legs"
                className="flex-1"
              />
              <Button
                variant="secondary"
                size="md"
                className="shrink-0"
                onClick={() => {
                  setSupersetPickerSourceExerciseId(null);
                  setShowExercisePicker(true);
                }}
              >
                <Plus className="w-4 h-4" strokeWidth={2.25} />
                Add
              </Button>
            </div>
          </div>

          {activeFlexibleItems.length === 0 ? (
            <EmptyState
              icon={Dumbbell}
              title="Nothing on the bar yet"
              body="Add your first movement and the session starts counting."
              action={
                <Button onClick={() => setShowExercisePicker(true)}>
                  <Plus className="w-4 h-4" strokeWidth={2.25} />
                  Add first exercise
                </Button>
              }
            />
          ) : (
            activeFlexibleItems.map((item, index) => {
              const exerciseId = item.exercise_id;
              const sets = (exerciseGroups[exerciseId] || []).sort((a, b) => a.set_number - b.set_number);
              const exerciseName = item.exercise_name || workoutExerciseMap.get(exerciseId)?.name || 'Exercise';
              const completedInExercise = sets.filter((set) => set.completed).length;
              const flexibleTargetSet = normalizeFlexibleTargetSets(item.target_sets);
              const flexibleTargetDraft = flexibleTargetSetDrafts[exerciseId];
              const flexibleTargetInputValue = typeof flexibleTargetDraft === 'string'
                ? flexibleTargetDraft
                : String(flexibleTargetSet);
              const isActive = activeExerciseId === exerciseId;
              const allComplete = sets.length > 0 && completedInExercise === sets.length;
              const movementNote = movementNotes[exerciseId] || item.notes || '';
              const canMoveUp = index > 0;
              const canMoveDown = index < activeFlexibleItems.length - 1;
              const supersetGroupId = item.superset_group_id || null;
              const supersetPartner = supersetGroupId
                ? activeFlexibleItems.find((candidate) => candidate.exercise_id !== exerciseId && candidate.superset_group_id === supersetGroupId)
                : null;
              const supersetRole = supersetFlowMap.get(exerciseId)?.role;
              const firstUncompletedSetId = sets.find((set) => !set.completed)?.id ?? null;

              return (
                <ExerciseCard
                  key={exerciseId}
                  index={index}
                  exerciseName={exerciseName}
                  completedCount={completedInExercise}
                  totalCount={sets.length || flexibleTargetSet}
                  allComplete={allComplete}
                  isActive={isActive}
                  onToggle={() => setActiveExerciseId(isActive ? null : exerciseId)}
                  supersetLabel={
                    supersetPartner
                      ? `${supersetRole ?? ''}${supersetRole ? ' · ' : ''}with ${supersetPartner.exercise_name || workoutExerciseMap.get(supersetPartner.exercise_id)?.name || 'Exercise'}`
                      : null
                  }
                  notePreview={!isActive && movementNote.trim() ? movementNote : null}
                  controls={
                    <>
                      <IconControl ariaLabel="Move up" disabled={!canMoveUp} onClick={() => { void handleFlexibleReorder(exerciseId, 'up'); }}>
                        <ChevronUp className="w-3.5 h-3.5" />
                      </IconControl>
                      <IconControl ariaLabel="Move down" disabled={!canMoveDown} onClick={() => { void handleFlexibleReorder(exerciseId, 'down'); }}>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </IconControl>
                      {supersetGroupId ? (
                        <IconControl ariaLabel="Remove superset" tone="sage" onClick={() => { void clearFlexibleSuperset(exerciseId); }}>
                          <Unlink2 className="w-3.5 h-3.5" />
                        </IconControl>
                      ) : (
                        <IconControl
                          ariaLabel="Add superset"
                          onClick={() => {
                            setSupersetPickerSourceExerciseId(exerciseId);
                            setShowExercisePicker(true);
                          }}
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </IconControl>
                      )}
                      <IconControl ariaLabel="Remove exercise" tone="berry" onClick={() => { void removeFlexibleExerciseFromPlan(exerciseId); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconControl>
                    </>
                  }
                >
                  {/* Target sets + add/remove */}
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <label className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[var(--color-muted)]">Target sets</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={12}
                        value={flexibleTargetInputValue}
                        onChange={(event) => {
                          handleFlexibleTargetSetDraftChange(exerciseId, event.target.value);
                        }}
                        onBlur={() => handleFlexibleTargetSetBlur(exerciseId, flexibleTargetSet)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            (event.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        className="well w-14 min-h-9 text-center t-data-sm text-[var(--color-text)] outline-none"
                      />
                    </label>
                    <div className="flex items-center gap-1.5">
                      <SetCountButton
                        ariaLabel="Remove set"
                        disabled={!sets.some((set) => !set.completed)}
                        onClick={() => { void removeLastUncompletedSet(exerciseId); }}
                      >
                        <Minus className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </SetCountButton>
                      <SetCountButton ariaLabel="Add set" onClick={() => { void addWorkoutSet(exerciseId); }}>
                        <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                      </SetCountButton>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {sets.map((set, idx) => (
                      <motion.div
                        key={set.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.04, ...springs.smooth }}
                      >
                        <WorkoutSetRow
                          set={set}
                          setNumber={idx + 1}
                          autofillValues={getSetAutofillValues({
                            exerciseId,
                            setNumber: set.set_number,
                            currentExerciseSets: sets,
                            previousWorkoutSetsByExercise,
                          })}
                          previousTarget={previousWorkoutSetsByExercise[exerciseId]?.[set.set_number] ?? null}
                          isNext={set.id === firstUncompletedSetId}
                          onBeforeComplete={validateSupersetOrderBeforeLog}
                          onComplete={handleSetLogged}
                        />
                      </motion.div>
                    ))}
                  </div>

                  <MovementNote
                    exerciseId={exerciseId}
                    value={movementNote}
                    saving={savingMovementNoteId === exerciseId}
                    saved={savedMovementNoteId === exerciseId}
                    onChange={(value) => {
                      handleMovementNoteChange(exerciseId, value);
                      void updateFlexibleExerciseMeta(exerciseId, { notes: value.slice(0, 200) });
                    }}
                    onBlur={() => handleMovementNoteBlur(exerciseId)}
                  />
                </ExerciseCard>
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
        <div className="space-y-3">
          {orderedExerciseEntries.map(([exerciseId, sets], index) => {
            const rawSet = sets[0] as WorkoutSet & { exercises?: { name?: string } };
            const exerciseName = rawSet.exercise?.name || rawSet.exercises?.name || 'Unknown Exercise';
            const completedInExercise = sets.filter(s => s.completed).length;
            const isActive = activeExerciseId === exerciseId;
            const allComplete = completedInExercise === sets.length;
            const movementNote = movementNotes[exerciseId] || '';
            const isFirst = index === 0;
            const isLast = index === orderedExerciseEntries.length - 1;
            const supersetPartnerId = splitSupersetPartnerByExerciseId.get(exerciseId) || null;
            const supersetPartnerName = supersetPartnerId
              ? (workoutExerciseMap.get(supersetPartnerId)?.name || 'Exercise')
              : null;
            const supersetRole = supersetFlowMap.get(exerciseId)?.role;
            const setRange = exerciseSetRanges.get(exerciseId) ?? { minSets: sets.length, targetSets: sets.length, maxSets: sets.length };
            const canAddSet = sets.length < setRange.maxSets;
            const hasRemovableUncompletedSet = sets.some((set) => !set.completed);
            const canRemoveSet = sets.length > setRange.minSets && hasRemovableUncompletedSet;
            const firstUncompletedSetId = sets.find((set) => !set.completed)?.id ?? null;

            return (
              <ExerciseCard
                key={exerciseId}
                index={index}
                exerciseName={exerciseName}
                completedCount={completedInExercise}
                totalCount={sets.length}
                allComplete={allComplete}
                isActive={isActive}
                onToggle={() => setActiveExerciseId(isActive ? null : exerciseId)}
                supersetLabel={
                  supersetPartnerName ? `${supersetRole ?? ''}${supersetRole ? ' · ' : ''}with ${supersetPartnerName}` : null
                }
                notePreview={!isActive && movementNote.trim() ? movementNote : null}
                controls={
                  orderedExerciseEntries.length > 1 ? (
                    <>
                      <IconControl ariaLabel={`Move ${exerciseName} up`} disabled={isFirst} onClick={() => moveExercise(exerciseId, 'up')}>
                        <ChevronUp className="w-3.5 h-3.5" />
                      </IconControl>
                      <IconControl ariaLabel={`Move ${exerciseName} down`} disabled={isLast} onClick={() => moveExercise(exerciseId, 'down')}>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </IconControl>
                    </>
                  ) : null
                }
              >
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="text-[11px] font-medium text-[var(--color-muted)]">
                    Range {setRange.minSets}–{setRange.maxSets} · Target {setRange.targetSets}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <SetCountButton
                      ariaLabel="Remove set"
                      disabled={!canRemoveSet}
                      onClick={() => { void removeLastUncompletedSet(exerciseId); }}
                    >
                      <Minus className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </SetCountButton>
                    <SetCountButton ariaLabel="Add set" disabled={!canAddSet} onClick={() => { void addWorkoutSet(exerciseId); }}>
                      <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                    </SetCountButton>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {sets.map((set, idx) => (
                    <motion.div
                      key={set.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.04, ...springs.smooth }}
                    >
                      <WorkoutSetRow
                        set={set}
                        setNumber={idx + 1}
                        autofillValues={getSetAutofillValues({
                          exerciseId,
                          setNumber: set.set_number,
                          currentExerciseSets: sets,
                          previousWorkoutSetsByExercise,
                        })}
                        previousTarget={previousWorkoutSetsByExercise[exerciseId]?.[set.set_number] ?? null}
                        isNext={set.id === firstUncompletedSetId}
                        onBeforeComplete={validateSupersetOrderBeforeLog}
                        onComplete={handleSetLogged}
                      />
                    </motion.div>
                  ))}
                </div>

                <MovementNote
                  exerciseId={exerciseId}
                  value={movementNote}
                  saving={savingMovementNoteId === exerciseId}
                  saved={savedMovementNoteId === exerciseId}
                  onChange={(value) => handleMovementNoteChange(exerciseId, value)}
                  onBlur={() => handleMovementNoteBlur(exerciseId)}
                />
              </ExerciseCard>
            );
          })}
        </div>
      )}

      {/* Ambient rest timer */}
      {showRestTimer && (
        <RestTimerPill
          key={`${currentWorkout.id}:${restTimerSeed}`}
          workoutId={currentWorkout.id}
          sessionSeed={restTimerSeed}
          onDismiss={() => setShowRestTimer(false)}
        />
      )}

      {/* Complete Confirmation */}
      <Modal isOpen={showCompleteConfirm} onClose={() => setShowCompleteConfirm(false)} title="Finish workout?">
        <div className="space-y-4 pt-1">
          <div className="flex items-center gap-3">
            <TickStrip total={Math.min(totalSets, 30)} filled={Math.min(completedSets, 30)} tone="amber" size="sm" />
            <span className="t-data-sm text-[var(--color-text-dim)]">{completedSets}/{totalSets} sets</span>
          </div>
          <p className="t-caption">Remaining sets won't be logged. You can always edit this session later in History.</p>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setShowCompleteConfirm(false)}>
              Keep training
            </Button>
            <Button className="flex-1" onClick={handleConfirmComplete}>
              Finish
            </Button>
          </div>
        </div>
      </Modal>

      {/* Save template prompt (flexible) */}
      <Modal isOpen={showSaveTemplatePrompt} onClose={() => setShowSaveTemplatePrompt(false)} title="Save as quick start?">
        <div className="space-y-4 pt-1">
          <p className="t-body text-[var(--color-text)]">
            Keep <span className="font-semibold">{currentWorkoutDayPlan?.day_label || 'this day'}</span> as a one-tap template?
          </p>
          <p className="t-caption">An existing template with this label will be replaced with today's exercises and notes.</p>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" className="flex-1" onClick={handleSkipTemplateAtCompletion}>
              Skip
            </Button>
            <Button
              className="flex-1"
              onClick={() => { void handleSaveTemplateAtCompletion(); }}
              loading={savingTemplate}
              disabled={savingTemplate}
            >
              {savingTemplate ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </div>
      </Modal>

      <CompletionSheet summary={completionSummary} onClose={() => setCompletionSummary(null)} />
    </motion.div>
  );
}

/* ───────────────────────── in-session building blocks ───────────────────────── */

function ExerciseCard({
  index,
  exerciseName,
  completedCount,
  totalCount,
  allComplete,
  isActive,
  onToggle,
  supersetLabel,
  notePreview,
  controls,
  children,
}: {
  index: number;
  exerciseName: string;
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  isActive: boolean;
  onToggle: () => void;
  supersetLabel: string | null;
  notePreview: string | null;
  controls: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.smooth, delay: Math.min(index * 0.04, 0.3) }}
    >
      <div
        className={`rounded-[var(--radius-lg)] border transition-colors ${
          allComplete
            ? 'bg-sage-tint border-[color-mix(in_srgb,var(--color-sage)_25%,transparent)]'
            : isActive
              ? 'bg-[var(--color-surface-2)] border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)]'
              : 'bg-[var(--color-surface-1)] border-[var(--color-border)]'
        }`}
      >
        <div
          role="button"
          tabIndex={0}
          className="w-full text-left px-4 py-3.5 cursor-pointer"
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {allComplete && (
                  <motion.span
                    className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[var(--color-sage)] shrink-0"
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.15, 1] }}
                    transition={{ duration: 0.35 }}
                  >
                    <Check className="w-2.5 h-2.5 text-[var(--color-base)]" strokeWidth={4} />
                  </motion.span>
                )}
                <h3 className="t-heading text-[15px] truncate">{exerciseName}</h3>
              </div>
              {supersetLabel && (
                <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--color-stone)]">
                  <Link2 className="w-3 h-3" strokeWidth={2.25} />
                  Superset {supersetLabel}
                </p>
              )}
              {notePreview && (
                <p className="mt-0.5 text-xs italic text-[var(--color-text-dim)] truncate">{notePreview}</p>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              {controls}
              <motion.span animate={{ rotate: isActive ? 90 : 0 }} transition={springs.snappy} className="p-1">
                <ChevronRight className="w-4 h-4 text-[var(--color-muted)]" />
              </motion.span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 mt-2">
            <TickStrip total={Math.min(totalCount, 12)} filled={Math.min(completedCount, 12)} tone={allComplete ? 'sage' : 'amber'} size="sm" />
            <span className="t-data-sm text-[var(--color-muted)]">
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isActive && (
            <motion.div
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={springs.smooth}
            >
              <div className="px-4 pb-4 pt-1 border-t border-[var(--color-border)]">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function IconControl({
  children,
  onClick,
  disabled,
  ariaLabel,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  tone?: 'neutral' | 'sage' | 'berry';
}) {
  const color =
    tone === 'sage'
      ? 'text-[var(--color-sage)]'
      : tone === 'berry'
        ? 'text-[color-mix(in_srgb,var(--color-danger)_75%,var(--color-muted))]'
        : 'text-[var(--color-muted)] hover:text-[var(--color-text)]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`pressable p-2 rounded-[var(--radius-xs)] transition-colors disabled:opacity-25 disabled:pointer-events-none ${color}`}
    >
      {children}
    </button>
  );
}

function SetCountButton({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="pressable flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] hairline text-[var(--color-text-dim)] disabled:opacity-30 disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}

function MovementNote({
  exerciseId,
  value,
  saving,
  saved,
  onChange,
  onBlur,
}: {
  exerciseId: string;
  value: string;
  saving: boolean;
  saved: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="mt-3 pt-3 border-t border-[var(--color-border-soft)]">
      <textarea
        id={`movement-note-${exerciseId}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        rows={1}
        maxLength={200}
        placeholder="Note — technique, feel, cues…"
        aria-label="Movement note"
        className="w-full bg-transparent border-b border-[var(--color-border)] pb-2 text-sm italic text-[var(--color-text)] placeholder:text-[color-mix(in_srgb,var(--color-muted)_60%,transparent)] focus:outline-none focus:border-[var(--color-accent)] resize-none overflow-y-auto max-h-28"
      />
      <div className="mt-1 flex items-center justify-between min-h-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">
          {saving ? 'Saving…' : saved ? <span className="text-[var(--color-sage)]">Saved</span> : ''}
        </span>
        {value.length >= 160 && <span className="t-data-sm text-[10px] text-[var(--color-muted)]">{value.length}/200</span>}
      </div>
    </div>
  );
}

function CompletionSheet({ summary, onClose }: { summary: CompletionSummary | null; onClose: () => void }) {
  return (
    <Modal isOpen={summary !== null} onClose={onClose}>
      {summary && (
        <div className="text-center pt-2 pb-3">
          <motion.span
            className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-sage)] mb-4"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.15, 1] }}
            transition={{ duration: 0.45 }}
          >
            <Check className="w-6 h-6 text-[var(--color-base)]" strokeWidth={3} />
          </motion.span>
          <p className="t-display text-[1.6rem] text-[var(--color-text)] mb-1">Session banked.</p>
          <p className="t-caption mb-5">{summary.title}</p>
          <div className="flex justify-center mb-5">
            <TickStrip total={Math.min(summary.totalSets, 30)} filled={Math.min(summary.completedSets, 30)} tone="sage" />
          </div>
          <div className="grid grid-cols-2 gap-2.5 mb-6">
            <div className="well py-3">
              <p className="t-data-lg text-[var(--color-text)]">{summary.completedSets}<span className="text-[var(--color-muted)]">/{summary.totalSets}</span></p>
              <p className="t-label-sm mt-0.5">sets</p>
            </div>
            <div className="well py-3">
              <p className="t-data-lg text-[var(--color-text)]">{summary.duration}</p>
              <p className="t-label-sm mt-0.5">duration</p>
            </div>
          </div>
          <Button size="lg" className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
