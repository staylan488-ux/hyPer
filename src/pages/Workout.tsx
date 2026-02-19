import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Loader2, Settings2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { addDays, format, isBefore, isSameDay, parseISO, startOfWeek } from 'date-fns';
import { Card, Button, Modal } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { SetLogger } from '@/components/workout/SetLogger';
import { RestTimer } from '@/components/workout/RestTimer';
import { ScheduleEditor } from '@/components/workout/ScheduleEditor';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import { buildFixedWeekdays, defaultStartDate, defaultWeekdays, loadWithBackgroundSync, plannedDayForDate, savePlanSchedule, type PlanMode, type PlanSchedule } from '@/lib/planSchedule';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import type { SplitDay, Workout, WorkoutSet } from '@/types';

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

interface StartSetAdjustment {
  splitExerciseId: string;
  exerciseName: string;
  minSets: number;
  targetSets: number;
  maxSets: number;
  selectedSets: number;
}

export function Workout() {
  const { activeSplit, currentWorkout, startWorkout, fetchCurrentWorkout, fetchSplits, completeWorkout } = useAppStore();
  const userId = useAuthStore((state) => state.user?.id || null);
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [showSetAdjustModal, setShowSetAdjustModal] = useState(false);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);
  const [pendingStartDay, setPendingStartDay] = useState<SplitDay | null>(null);
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
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const [startSetAdjustments, setStartSetAdjustments] = useState<StartSetAdjustment[]>([]);
  const movementNotesRef = useRef<Record<string, string>>({});
  const noteSaveTimersRef = useRef<Record<string, number>>({});
  const lastPersistedNotesRef = useRef<string>('');
  const planScheduleRequestRef = useRef(0);

  const [setupStartDate, setSetupStartDate] = useState(defaultStartDate());
  const [setupStartChoice, setSetupStartChoice] = useState<'today' | 'tomorrow' | 'pick'>('today');
  const [setupMode, setSetupMode] = useState<PlanMode>('fixed');
  const [setupAnchorDay, setSetupAnchorDay] = useState(1);
  const [setupFlexDayIndex, setSetupFlexDayIndex] = useState(0);
  const currentWorkoutId = currentWorkout?.id || null;
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
      await Promise.all([fetchSplits(), fetchCurrentWorkout()]);
      if (mounted) setInitializing(false);
    };

    void initializeWorkoutPage();

    return () => {
      mounted = false;
    };
  }, [fetchCurrentWorkout, fetchSplits]);

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

  const handleStartWorkout = async (day: SplitDay, overrides?: Record<string, number>) => {
    if (startingDayId) return;

    try {
      setStartingDayId(day.id);
      await startWorkout(day.id, overrides);
    } finally {
      setStartingDayId(null);
    }
  };

  const openSetAdjustModal = (day: SplitDay) => {
    const adjustments = (day.exercises || []).map((exercise) => {
      const parsedRange = parseSetRangeNotes(exercise.notes, exercise.target_sets);
      return {
        splitExerciseId: exercise.id,
        exerciseName: exercise.exercise?.name || 'Exercise',
        minSets: parsedRange.minSets,
        targetSets: parsedRange.targetSets,
        maxSets: parsedRange.maxSets,
        selectedSets: parsedRange.targetSets,
      };
    });

    setPendingStartDay(day);
    setStartSetAdjustments(adjustments);
    setShowSetAdjustModal(true);
  };

  const closeSetAdjustModal = () => {
    setShowSetAdjustModal(false);
    setPendingStartDay(null);
    setStartSetAdjustments([]);
  };

  const confirmStartWorkoutWithAdjustments = async () => {
    if (!pendingStartDay) return;

    const overrides = Object.fromEntries(
      startSetAdjustments.map((adjustment) => [adjustment.splitExerciseId, adjustment.selectedSets])
    );

    const dayToStart = pendingStartDay;
    closeSetAdjustModal();
    await handleStartWorkout(dayToStart, overrides);
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

  const completedSets = currentWorkout?.sets.filter(s => s.completed).length ?? 0;
  const totalSets = currentWorkout?.sets.length ?? 0;
  const progress = totalSets > 0 ? (completedSets / totalSets) * 100 : 0;
  // ── End exercise ordering ──

  const handleCompleteWorkout = async () => {
    if (completedSets < totalSets && totalSets > 0) {
      setShowCompleteConfirm(true);
      return;
    }
    await completeWorkout();
  };

  const handleConfirmComplete = async () => {
    setShowCompleteConfirm(false);
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

  if (!activeSplit) {
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
      ? plannedDayForDate(today, activeSplit.days, planSchedule, completedBefore(today))
      : null;

  const todayCompletedWorkout = completedInWeek.find((workout) => workout.date === format(today, 'yyyy-MM-dd'));

  const openScheduleEditor = () => {
    if (!planSchedule) return;

    const splitDayCount = activeSplit.days.length;
    const fallbackFlexDay = normalizeIndex(planSchedule.anchorDay ?? 0, splitDayCount);

    const todayPlannedIndex = todayPlannedDay
      ? activeSplit.days.findIndex((day) => day.id === todayPlannedDay.id)
      : -1;

    setSetupStartDate(planSchedule.startDate);
    setSetupMode(planSchedule.mode);
    setSetupStartChoice('pick');
    setSetupAnchorDay(planSchedule.anchorDay ?? planSchedule.weekdays?.[0] ?? defaultWeekdays(activeSplit.days_per_week)[0] ?? 1);
    setSetupFlexDayIndex(todayPlannedIndex >= 0 ? todayPlannedIndex : fallbackFlexDay);
    setShowScheduleEditor(true);
  };

  if (!currentWorkout) {
    return (
      <motion.div
        className="pb-24 px-5 pt-8"
      >
        <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">
                {activeSplit.name.toUpperCase()}
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
                daysPerWeek={activeSplit.days_per_week}
                splitDays={activeSplit.days}
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
                  <Button onClick={() => openSetAdjustModal(todayPlannedDay)} disabled={startingDayId !== null}>
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
                  const plannedDay = plannedDayForDate(date, activeSplit.days, planSchedule, completedBefore(date));
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
                {activeSplit.days.map((day) => (
                  <div key={day.id} className="flex items-center justify-between rounded-[12px] bg-[#2A2A2A] border border-white/5 px-3 py-2">
                    <div>
                      <p className="text-xs text-[#E8E4DE]">{day.day_name}</p>
                      <p className="text-[10px] text-[#6B6B6B]">{day.exercises?.length || 0} exercises</p>
                    </div>
                    <Button size="sm" onClick={() => openSetAdjustModal(day)} disabled={startingDayId !== null}>
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
            daysPerWeek={activeSplit.days_per_week}
            splitDays={activeSplit.days}
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

        <Modal
          isOpen={showSetAdjustModal}
          onClose={closeSetAdjustModal}
          title="Adjust Sets for Today"
        >
          <div className="space-y-3">
            {startSetAdjustments.length === 0 ? (
              <p className="text-xs text-[#6B6B6B]">No exercises found for this day.</p>
            ) : (
              startSetAdjustments.map((adjustment) => (
                <div key={adjustment.splitExerciseId} className="rounded-[12px] bg-[#2A2A2A] border border-white/5 px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-[#E8E4DE] truncate">{adjustment.exerciseName}</p>
                    <p className="text-[10px] text-[#6B6B6B] tabular-nums">
                      Range {adjustment.minSets}-{adjustment.maxSets}
                    </p>
                  </div>
                  <input
                    type="range"
                    min={adjustment.minSets}
                    max={adjustment.maxSets}
                    step={1}
                    value={adjustment.selectedSets}
                    onChange={(event) => {
                      const nextSets = Number(event.target.value || adjustment.selectedSets);
                      setStartSetAdjustments((previous) => previous.map((entry) => (
                        entry.splitExerciseId === adjustment.splitExerciseId
                          ? { ...entry, selectedSets: nextSets }
                          : entry
                      )));
                    }}
                    className="w-full"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-[#6B6B6B]">Selected sets</p>
                    <p className="text-xs text-[#E8E4DE] tabular-nums">{adjustment.selectedSets}</p>
                  </div>
                </div>
              ))
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="secondary" onClick={closeSetAdjustModal} disabled={startingDayId !== null}>
                Cancel
              </Button>
              <Button onClick={() => { void confirmStartWorkoutWithAdjustments(); }} disabled={startingDayId !== null || !pendingStartDay}>
                {startingDayId === pendingStartDay?.id ? 'Starting...' : 'Start Workout'}
              </Button>
            </div>
          </div>
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

      {/* Exercises */}
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
                      {sets.map((set, idx) => (
                        <motion.div
                          key={set.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05, ...springs.smooth }}
                        >
                          <SetLogger
                            set={set}
                            setNumber={idx + 1}
                            onComplete={() => setShowRestTimer(true)}
                          />
                        </motion.div>
                      ))}

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
    </motion.div>
  );
}
