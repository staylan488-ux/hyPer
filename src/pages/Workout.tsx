import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Link2,
  Minus,
  MoreHorizontal,
  Plus,
  Pencil,
  Settings2,
  Timer,
  Trash2,
  Undo2,
  Unlink2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { addDays, differenceInCalendarWeeks, format, isBefore, isSameDay, parseISO, startOfWeek } from 'date-fns';
import { BankedStamp, Button, Chip, CountUp, Input, Modal } from '@/components/shared';
import { Eyebrow, HeroFigure, LineButton, MetalSection, MetalTitle, SegmentedHairline, useCommandCapsule, type CommandCapsuleSpec } from '@/components/metal';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useScheduleWorkouts } from '@/hooks/useScheduleWorkouts';
import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { useLitSurface } from '@/hooks/useLitSurface';
import { WorkoutSetRow } from '@/components/workout/WorkoutSetRow';
import { RestTimerPill } from '@/components/workout/RestTimerPill';
import { WorkoutCommandCapsule } from '@/components/workout/WorkoutCommandCapsule';
import { SessionToken } from '@/components/workout/SessionToken';
import { MovementDragHandle, MovementReorderList } from '@/components/workout/MovementReorderList';
import { expandedWorkoutSet, initialWorkoutExpansion, nextWorkoutSet, workoutExpansionReducer } from '@/components/workout/workoutFocus';
import '@/components/workout/studio-workout.css';
import { ScheduleEditor } from '@/components/workout/ScheduleEditor';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { springs } from '@/lib/animations';
import { completionHaptic, tapHaptic } from '@/lib/haptics';
import { emitBurstFrom } from '@/lib/fx';
import { useKeepAwakeWhile } from '@/lib/keepAwake';
import { endWorkoutActivity, syncWorkoutActivity } from '@/lib/liveActivity';
import { parseWorkoutNotes, serializeWorkoutNotes, type WorkoutNotesPayload } from '@/lib/workoutNotes';
import { createNoteAutosaver, flexiblePlanNoteToWrite, mergeMovementNoteDrafts, mergeQueuedMovementNotePayload, remainingMovementNoteDrafts, type NoteAutosaver } from '@/lib/noteAutosave';
import { captureAccountScope } from '@/lib/accountScope';
import { clearRestTimerSession, isRestTimerForWorkout, readRestTimerSession, saveRestTimerSession, syncRestTimerSession } from '@/lib/restTimer';
import { loadRestPreferences, loadRestPreferencesAsync, resolveRestSeconds, saveRestPreference } from '@/lib/restPreferences';
import { getSetAutofillValues, type PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { supabase } from '@/lib/supabase';
import { buildFixedWeekdays, defaultStartDate, defaultWeekdays, loadPlanSchedule, loadWithBackgroundSync, plannedDayForDate, savePlanSchedule, type PlanMode, type PlanSchedule } from '@/lib/planSchedule';
import { parseSetRangeNotes } from '@/lib/setRangeNotes';
import { formatWorkoutDuration, TRAINING_WEEK } from '@/lib/workoutSessions';
import { exerciseIdsFromKey, fetchPreviousSetTargets, previousTargetExerciseKey, previousTargetRetrySignal } from '@/lib/previousSetTargets';
import { collectSessionGains, formatSetPerformanceTarget, sessionTonnage } from '@/lib/workoutProgress';
import type { Exercise, SplitDay, Workout, WorkoutSet } from '@/types';

function normalizeIndex(value: number, size: number): number {
  if (size <= 0) return 0;
  return ((value % size) + size) % size;
}

function normalizeFlexibleTargetSets(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(12, Math.round(value)));
}

/** The rest bar's "Next ·" label is the movement name, this, and the set number. */
const REST_NEXT_UP_SET = ' · set ';

type SupersetRole = 'A' | 'B';

type SupersetFlow = {
  groupId: string;
  role: SupersetRole;
  partnerExerciseId: string;
};

type CompletionSummary = {
  title: string;
  completedSets: number;
  totalSets: number;
  duration: string;
  /** Completed weight × reps, lb. */
  tonnage: number;
  /** Sets that beat the same set last workout. */
  gains: Array<{ name: string; setNumber: number; gain: string }>;
  completedAt: number;
};

function formatSessionDuration(createdAt: string | null, now: number): string {
  return createdAt
    ? formatWorkoutDuration(Math.max(0, now - new Date(createdAt).getTime()))
    : '—';
}

/**
 * Ticks on its own so the whole session page doesn't re-render every second.
 * Render with `key={createdAt}` so a new session starts from a fresh clock.
 */
function SessionClock({ createdAt }: { createdAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return <>{formatSessionDuration(createdAt, now)}</>;
}

/** "8–10 reps", "8+ reps" or "Up to 12 reps"; null when the plan has no rep target. */
function formatRepTarget(min?: number | null, max?: number | null): string | null {
  if (min && max) return `${min === max ? min : `${min}–${max}`} reps`;
  if (min) return `${min}+ reps`;
  if (max) return `Up to ${max} reps`;
  return null;
}

/** The movement's progress line: "Set 2 of 3 · target 8–10 reps". */
function movementProgressLine(sets: WorkoutSet[], repTarget: string | null): string {
  const target = repTarget ? ` · target ${repTarget}` : '';
  const next = sets.findIndex((set) => !set.completed);
  if (sets.length === 0) return repTarget ? `Target ${repTarget}` : 'No sets yet';
  if (next < 0) return `All ${sets.length} ${sets.length === 1 ? 'set' : 'sets'} logged${target}`;
  return `Set ${next + 1} of ${sets.length}${target}`;
}

/**
 * Registers a Train state's one primary action on the command capsule. A
 * child component, so the page body itself adds no hooks.
 */
function TrainCapsule({ spec }: { spec: CommandCapsuleSpec | null }) {
  useCommandCapsule(spec);
  return null;
}

/**
 * The compact session bar (back · title and clock · Finish) that pins under
 * the status bar once the session title scrolls away. It fades in over the
 * page colour; no hard line.
 */
function SessionPin({ title, createdAt, finishing, onBack, onFinish }: {
  title: string;
  createdAt: string | null;
  finishing: boolean;
  onBack: () => void;
  onFinish: () => void;
}) {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const anchor = document.querySelector<HTMLElement>('[data-session-title]');
    const viewport = anchor?.closest<HTMLElement>('[data-app-scroll-viewport]');
    if (!anchor || !viewport) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const bounds = anchor.getBoundingClientRect();
      // No layout (hidden, or a test DOM): stay unpinned.
      setPinned(bounds.height > 0 && bounds.bottom < viewport.getBoundingClientRect().top + 44);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className={`studio-session-pin${pinned ? ' is-pinned' : ''}`} aria-hidden={!pinned} inert={!pinned}>
      <button type="button" className="studio-session-pin-back" onClick={onBack} aria-label="Back to Today">
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden />
      </button>
      <p className="studio-session-pin-title">
        <span>{title}</span>
        {createdAt && <span className="studio-session-pin-clock"><SessionClock key={createdAt} createdAt={createdAt} /></span>}
      </p>
      <button type="button" className="studio-session-pin-finish" onClick={onFinish} disabled={finishing}>
        {finishing ? 'Finishing…' : 'Finish'}
      </button>
    </div>
  );
}

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
    hydratedForUserId,
    startWorkout,
    startFlexibleWorkout,
    fetchCurrentWorkout,
    fetchCurrentWorkoutDayPlan,
    fetchSplits,
    fetchWorkoutMode,
    fetchFlexTemplates,
    completeWorkout,
    addWorkoutSet,
    substituteWorkoutExercise,
    switchBackWorkoutExercise,
    removeLastUncompletedSet,
    setFlexibleWorkoutLabel,
    addFlexibleExercise,
    addFlexibleSuperset,
    clearFlexibleSuperset,
    updateFlexibleExerciseMeta,
    removeFlexibleExerciseFromPlan,
    reorderWorkoutExercises,
    saveFlexibleTemplateFromCurrentWorkout,
  } = useAppStore();
  const userId = useAuthStore((state) => state.user?.id || null);
  const navigate = useNavigate();

  // Gym hands are chalky and phones auto-lock mid-set: hold the screen awake
  // for the whole live session (native app only).
  useKeepAwakeWhile(Boolean(currentWorkout));
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [expansion, dispatchExpansion] = useReducer(workoutExpansionReducer, initialWorkoutExpansion);
  const [showSessionDetails, setShowSessionDetails] = useState(false);
  const [setAdjustmentExerciseId, setSetAdjustmentExerciseId] = useState<string | null>(null);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);
  const [savingPlanSchedule, setSavingPlanSchedule] = useState(false);
  // Returning to Train shows this account's program and live workout from the
  // store while the mount reads refresh them; a cold start or another account
  // waits for them.
  const [initializing, setInitializing] = useState(!userId || hydratedForUserId !== userId);
  const [restTimerSeed, setRestTimerSeed] = useState(0);
  const [restTimerNextUpLabel, setRestTimerNextUpLabel] = useState<string | null>(null);
  const [restTimerExerciseId, setRestTimerExerciseId] = useState<string | null>(null);
  const [restTimerSeconds, setRestTimerSeconds] = useState(90);
  // Seeded at mount, so a warm return never paints the Start Plan setup for a
  // frame before the schedule effect below runs; the effect still re-reads
  // the cache and syncs from the cloud.
  const [planSchedule, setPlanSchedule] = useState<PlanSchedule | null>(() => (
    userId && activeSplit && hydratedForUserId === userId ? loadPlanSchedule(userId, activeSplit.id) : null
  ));
  const [planScheduleResolving, setPlanScheduleResolving] = useState(() => Boolean(userId && activeSplit));
  const [weekCursor, setWeekCursor] = useState<Date>(new Date());
  const [weekWorkouts, setWeekWorkouts] = useState<Pick<Workout, 'id' | 'date' | 'split_day_id' | 'completed'>[]>([]);
  const [lastCompletedWorkout, setLastCompletedWorkout] = useState<Pick<Workout, 'date' | 'split_day_id'> | null>(null);
  const adaptiveSchedulingEnabled = useAdaptiveSplitScheduling();
  const { workouts: scheduleWorkouts, loading: scheduleWorkoutsLoading, error: scheduleError, retry: retrySchedule } = useScheduleWorkouts(userId, activeSplit, planSchedule, currentWorkout, adaptiveSchedulingEnabled);
  const [movementNotes, setMovementNotes] = useState<Record<string, string>>({});
  const [savingMovementNoteId, setSavingMovementNoteId] = useState<string | null>(null);
  const [savedMovementNoteId, setSavedMovementNoteId] = useState<string | null>(null);
  const [previousWorkoutSetsByExercise, setPreviousWorkoutSetsByExercise] = useState<PreviousWorkoutSetMap>({});
  const [previousTargetsRetryNonce, setPreviousTargetsRetryNonce] = useState(0);
  const [flexibleTargetSetDrafts, setFlexibleTargetSetDrafts] = useState<Record<string, string>>({});
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [noteSaveFailed, setNoteSaveFailed] = useState(false);
  const finishingRef = useRef(false);
  const movementNotesRef = useRef<Record<string, string>>({});
  const dirtyMovementNotesRef = useRef<Record<string, string>>({});
  const legacyWorkoutNoteRef = useRef<string | null>(null);
  // The workout whose notes the refs above currently hold.
  const notesWorkoutIdRef = useRef<string | null>(null);
  const userIdRef = useRef(userId);
  const noteSaverRef = useRef<NoteAutosaver | null>(null);
  const mountedRef = useRef(false);
  const planScheduleRequestRef = useRef(0);
  const previousTargetsFailedRef = useRef(false);
  const previousTargetsContextRef = useRef<string | null>(null);

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
  // The movement whose swap picker is open, the swap being saved, and a failed swap.
  const [substitutionSource, setSubstitutionSource] = useState<string | null>(null);
  const [pendingSwap, setPendingSwap] = useState<{ exerciseId: string; targetName: string } | null>(null);
  const [swapError, setSwapError] = useState<{ exerciseId: string; message: string } | null>(null);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [supersetPickerSourceExerciseId, setSupersetPickerSourceExerciseId] = useState<string | null>(null);

  const currentWorkoutId = currentWorkout?.id || null;
  const currentWorkoutDate = currentWorkout?.date || null;
  const currentWorkoutNotes = currentWorkout?.notes || null;
  const currentWorkoutCreatedAt = currentWorkout?.created_at || null;
  const currentWorkoutCompleted = currentWorkout?.completed ?? false;
  const currentWorkoutSets = currentWorkout?.sets;
  // Sorted unique exercise ids: logging or editing sets keeps this stable, so
  // the "last time" lookup only refetches when a movement is added or swapped.
  const previousTargetExerciseIdsKey = useMemo(() => previousTargetExerciseKey(currentWorkoutSets ?? []), [currentWorkoutSets]);
  const previousTargetsRetrySignal = useMemo(() => previousTargetRetrySignal(currentWorkoutSets ?? []), [currentWorkoutSets]);

  useEffect(() => {
    movementNotesRef.current = movementNotes;
  }, [movementNotes]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    const saver = createNoteAutosaver({
      debounceMs: 1200,
      mergePayload: mergeQueuedMovementNotePayload,
      isCurrent: captureAccountScope(),
      save: async (workoutId, serializedPayload, exerciseId) => {
        const ownerId = userIdRef.current;
        if (!ownerId) return false;
        // only the workout still on screen shows the saving/saved indicator
        const showsIndicator = () => mountedRef.current && notesWorkoutIdRef.current === workoutId;

        if (showsIndicator()) setSavingMovementNoteId(exerciseId);
        try {
          // The store records the saved note too, so a warm return starts from
          // the latest value and its read guard includes this write.
          await useAppStore.getState().updateWorkoutNotes(workoutId, serializedPayload);
        } catch (error) {
          console.error('Error saving movement note:', error);
          if (showsIndicator()) setSavingMovementNoteId(null);
          return false;
        }

        if (showsIndicator()) {
          setSavingMovementNoteId(null);
          setSavedMovementNoteId(exerciseId);
          window.setTimeout(() => {
            setSavedMovementNoteId((current) => (current === exerciseId ? null : current));
          }, 1200);
        }
        return true;
      },
      // Flexible sessions also keep the note on the plan item (templates and
      // History read it there). Decided separately from the workouts.notes
      // no-op check, so clearing a note that came from a template still saves.
      prepareFlush: (workoutId, exerciseId) => {
        const store = useAppStore.getState();
        const nextNote = flexiblePlanNoteToWrite({
          workoutId,
          exerciseId,
          movementNotes: notesWorkoutIdRef.current === workoutId ? movementNotesRef.current : null,
          workout: store.currentWorkout,
          plan: store.currentWorkoutDayPlan,
          force: exerciseId in dirtyMovementNotesRef.current,
        });
        if (nextNote === null) return;
        const isCurrentAccount = captureAccountScope();
        // The note value is captured before refs change. Read the plan when
        // this queued patch executes, after any earlier note patch has landed.
        return async () => {
          if (!isCurrentAccount()) throw new Error('The signed-in account changed.');
          const latest = useAppStore.getState();
          const plan = latest.currentWorkoutDayPlan?.workout_id === workoutId
            ? latest.currentWorkoutDayPlan
            : await latest.fetchWorkoutDayPlanByWorkoutId(workoutId, { throwOnError: true });
          if (!isCurrentAccount()) throw new Error('The signed-in account changed.');
          if (!plan) throw new Error('Could not load the workout notes. Try again.');
          await latest.updateWorkoutDayPlanItems(workoutId, plan.items.map((item) => (
            item.exercise_id === exerciseId ? { ...item, notes: nextNote } : item
          )), plan);
        };
      },
      onSaved: (workoutId, payload, exerciseId) => {
        if (notesWorkoutIdRef.current !== workoutId) return;
        const remaining = remainingMovementNoteDrafts(
          { [exerciseId]: dirtyMovementNotesRef.current[exerciseId] ?? '' },
          parseWorkoutNotes(payload).movementNotes,
        );
        if (!(exerciseId in remaining)) delete dirtyMovementNotesRef.current[exerciseId];
      },
      onFailure: (workoutId) => {
        if (mountedRef.current && notesWorkoutIdRef.current === workoutId) {
          setNoteSaveFailed(true);
          setFinishError('Note not saved. Check your connection and retry.');
        }
      },
    });
    noteSaverRef.current = saver;

    // backgrounding the app with the keyboard up still saves the note
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') void saver.flushAll();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      void saver.flushAll();
    };
  }, [userId]);

  useEffect(() => {
    // Switching or finishing the workout saves its pending notes instead of
    // dropping them. This cleanup runs before the notes effect below swaps the
    // refs, and each save carries the workout id captured when it was queued.
    return () => {
      void noteSaverRef.current?.flushAll();
    };
  }, [currentWorkoutId]);

  useEffect(() => {
    setFlexibleTargetSetDrafts({});
    setActiveExerciseId(null);
    dispatchExpansion({ type: 'reset' });
    setSetAdjustmentExerciseId(null);
    setSubstitutionSource(null);
    setSwapError(null);
    setShowSessionDetails(false);
    setRestTimerSeed(0);
    setFinishError(null);
    setNoteSaveFailed(false);
  }, [currentWorkoutId]);

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
    if (!userId) return;
    void loadRestPreferencesAsync(userId);
  }, [userId]);

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
      setSetupFlexDayIndex(normalizeIndex(schedule.flexAnchorIndex ?? schedule.anchorDay ?? 0, splitDayCount));
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

  // Keyed on session identity/completion, not the workout object that every
  // set log replaces; starting or finishing a session still refreshes.
  useEffect(() => {
    if (!userId || !activeSplit || !planSchedule) {
      setWeekWorkouts([]);
      setLastCompletedWorkout(null);
      return;
    }

    let cancelled = false;
    const fetchCalendarWorkouts = async () => {
      const weekStart = startOfWeek(weekCursor, TRAINING_WEEK);
      const weekEnd = addDays(weekStart, 6);

      const [{ data: workouts }, { data: lastCompleted }] = await Promise.all([
        supabase
          .from('workouts')
          .select('id, date, split_day_id, completed')
          .eq('user_id', userId)
          .gte('date', format(weekStart, 'yyyy-MM-dd'))
          .lte('date', format(weekEnd, 'yyyy-MM-dd'))
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
        supabase
          .from('workouts')
          .select('date, split_day_id')
          .eq('user_id', userId)
          .eq('completed', true)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      setWeekWorkouts((workouts || []) as Pick<Workout, 'id' | 'date' | 'split_day_id' | 'completed'>[]);
      setLastCompletedWorkout((lastCompleted as Pick<Workout, 'date' | 'split_day_id'>) || null);
    };

    void fetchCalendarWorkouts();
    return () => {
      cancelled = true;
    };
  }, [userId, activeSplit, planSchedule, weekCursor, currentWorkoutId, currentWorkoutCompleted]);

  useEffect(() => {
    if (notesWorkoutIdRef.current !== currentWorkoutId) dirtyMovementNotesRef.current = {};
    notesWorkoutIdRef.current = currentWorkoutId;
    if (!currentWorkoutId) {
      setMovementNotes({});
      movementNotesRef.current = {};
      legacyWorkoutNoteRef.current = null;
      return;
    }

    const parsed = parseWorkoutNotes(currentWorkoutNotes);
    const nextNotes = mergeMovementNoteDrafts(parsed.movementNotes, dirtyMovementNotesRef.current);
    setMovementNotes(nextNotes);
    movementNotesRef.current = nextNotes;
    legacyWorkoutNoteRef.current = parsed.legacyNote;

    const initialPayload: WorkoutNotesPayload = {
      movementNotes: parsed.movementNotes,
      legacyNote: parsed.legacyNote || undefined,
    };
    noteSaverRef.current?.markPersisted(currentWorkoutId, serializeWorkoutNotes(
      initialPayload.movementNotes || {},
      initialPayload.legacyNote
    ));
  }, [currentWorkoutId, currentWorkoutNotes]);

  useEffect(() => {
    previousTargetsFailedRef.current = false;

    if (!userId || !currentWorkoutId || !currentWorkoutDate || !previousTargetExerciseIdsKey) {
      previousTargetsContextRef.current = null;
      setPreviousWorkoutSetsByExercise({});
      return;
    }

    const exerciseIds = exerciseIdsFromKey(previousTargetExerciseIdsKey);

    if (exerciseIds.length === 0) {
      previousTargetsContextRef.current = null;
      setPreviousWorkoutSetsByExercise({});
      return;
    }

    const context = `${userId}:${currentWorkoutId}:${currentWorkoutDate}`;
    let cancelled = false;

    void fetchPreviousSetTargets({
      userId,
      workoutId: currentWorkoutId,
      date: currentWorkoutDate,
      exerciseIds,
    }).then((targets) => {
      if (cancelled) return;

      if (targets) {
        previousTargetsContextRef.current = context;
        setPreviousWorkoutSetsByExercise(targets);
        return;
      }

      // Failed lookup: keep this workout's existing targets (they are still
      // right for its other movements) and retry on the next set log.
      previousTargetsFailedRef.current = true;
      if (previousTargetsContextRef.current !== context) {
        previousTargetsContextRef.current = null;
        setPreviousWorkoutSetsByExercise({});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userId, currentWorkoutId, currentWorkoutDate, previousTargetExerciseIdsKey, previousTargetsRetryNonce]);

  // Declared after the lookup so a movement change, which already refetches,
  // does not also trigger a retry in the same commit.
  useEffect(() => {
    if (previousTargetsFailedRef.current) setPreviousTargetsRetryNonce((nonce) => nonce + 1);
  }, [previousTargetsRetrySignal]);

  // Serializes the on-screen notes when the save fires; nothing is saved once
  // the refs hold a different workout's notes.
  const buildNotesPayload = (workoutId: string) => () => {
    if (notesWorkoutIdRef.current !== workoutId) return null;
    return serializeWorkoutNotes(movementNotesRef.current, legacyWorkoutNoteRef.current || undefined);
  };

  const handleMovementNoteChange = (exerciseId: string, value: string) => {
    const boundedValue = value.slice(0, 200);

    // A cleared note stays as '' rather than being deleted, so a note that came
    // from a template does not reappear while the clear is saving. Blank
    // entries are dropped when the notes are serialized.
    const next = { ...movementNotesRef.current, [exerciseId]: boundedValue };
    dirtyMovementNotesRef.current = { ...dirtyMovementNotesRef.current, [exerciseId]: boundedValue };
    movementNotesRef.current = next;
    setMovementNotes(next);

    if (currentWorkoutId) {
      noteSaverRef.current?.schedule(currentWorkoutId, exerciseId, buildNotesPayload(currentWorkoutId));
    }
  };

  const handleMovementNoteBlur = (exerciseId: string) => {
    if (!currentWorkoutId) return;
    void noteSaverRef.current?.saveNow(currentWorkoutId, exerciseId, buildNotesPayload(currentWorkoutId));
  };

  const handleStartWorkout = async (day: SplitDay) => {
    if (startingDayId) return;

    try {
      setStartingDayId(day.id);
      await startWorkout(day.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't start the workout. Try again.");
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
        computedAnchorDay = normalizeIndex(setupFlexDayIndex, splitDayCount);
      }

      const schedule: PlanSchedule = {
        splitId: activeSplit.id,
        startDate: setupStartDate,
        mode: setupMode,
        weekdays: computedWeekdays,
        anchorDay: setupMode === 'fixed' ? computedAnchorDay : 0,
        flexAnchorIndex: setupMode === 'flex' ? computedAnchorDay : undefined,
      };

      setPlanSchedule(savePlanSchedule(userId, schedule));
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
  const sessionPlanItems = currentWorkoutDayPlan?.workout_id === currentWorkout?.id ? currentWorkoutDayPlan?.items : undefined;
  const sessionExercises = useMemo(() => sessionPlanItems?.map((item) => ({
    ...item, exercise_order: item.order, target_sets: item.target_sets ?? 3,
    notes: item.notes ?? null,
  })) ?? splitDay?.exercises ?? [], [sessionPlanItems, splitDay?.exercises]);
  const substitutionByExerciseId = useMemo(() => new Map(
    (sessionPlanItems ?? []).flatMap((item) => (
      item.substitutes_for && !item.hidden ? [[item.exercise_id, item.substitutes_for] as const] : []
    ))
  ), [sessionPlanItems]);
  const exerciseOrderById = useMemo(() => new Map(
    sessionExercises.map((exercise, index) => [
      exercise.exercise_id,
      exercise.exercise_order ?? index,
    ])
  ), [sessionExercises]);

  const exerciseSetRanges = useMemo(() => new Map(
    sessionExercises.map((exercise) => {
      const parsedRange = parseSetRangeNotes(exercise.notes, exercise.target_sets);
      return [exercise.exercise_id, parsedRange] as const;
    })
  ), [sessionExercises]);

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
  const orderedExerciseEntries = useMemo(() => Object.entries(exerciseGroups), [exerciseGroups]);
  // Plan edits rebuild the whole item list from the store's plan, so a note's
  // plan write that is pending or still in flight lands first; otherwise the
  // later of the two writes would undo the other.
  const settleNoteWrites = useCallback(async () => {
    const saved = await noteSaverRef.current?.flushAll();
    if (saved === false) throw new Error('Note not saved. Check your connection and retry.');
    setNoteSaveFailed(false);
  }, []);
  const afterNoteWrites = (write: () => Promise<unknown>) => {
    const workoutId = currentWorkoutId;
    const guardedWrite = async () => {
      if (useAppStore.getState().currentWorkout?.id !== workoutId) return false;
      await write();
      return true;
    };
    const result = workoutId && noteSaverRef.current
      ? noteSaverRef.current.runAfterFlush(workoutId, guardedWrite)
      : guardedWrite();
    return result.catch((error) => {
      setFinishError(error instanceof Error ? error.message : 'Could not save that change. Try again.');
      return false;
    });
  };
  const reorderSessionMovements = useCallback(async (ids: string[]) => {
    if (!currentWorkoutId) throw new Error('No active workout.');
    const write = () => reorderWorkoutExercises(currentWorkoutId, ids);
    if (noteSaverRef.current) await noteSaverRef.current.runAfterFlush(currentWorkoutId, write);
    else await write();
  }, [currentWorkoutId, reorderWorkoutExercises]);

  useEffect(() => {
    if (currentWorkout?.id) {
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
    for (const exercise of sessionExercises) {
      if (exercise.superset_group_id) {
        map.set(exercise.exercise_id, exercise.superset_group_id);
      }
    }
    return map;
  }, [sessionExercises]);

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

  const focusOrder = useMemo(() => currentWorkout?.split_day_id === null
    ? activeFlexibleItems.map((item) => item.exercise_id)
    : orderedExerciseEntries.map(([id]) => id), [currentWorkout?.split_day_id, activeFlexibleItems, orderedExerciseEntries]);
  const nextMovementId = nextWorkoutSet(orderedSets, focusOrder, undefined, undefined, supersetFlowMap)?.exercise_id;
  // Progression drives the resume cue; expansion is an independent user choice.
  const resolvedActiveExerciseId = activeExerciseId && focusOrder.includes(activeExerciseId)
    ? activeExerciseId
    : nextMovementId ?? focusOrder[0] ?? null;
  const editorSet = expandedWorkoutSet(orderedSets, expansion);
  const selectMovement = (exerciseId: string) => {
    tapHaptic();
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches('input, textarea') && focused.closest('.studio-workout-page')) focused.blur();
    setActiveExerciseId(exerciseId);
    dispatchExpansion({ type: 'toggle', exerciseId });
  };

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
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Couldn't start the workout. Try again.");
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

  const closeSetAdjustment = () => {
    // Escape/backdrop closure must commit a focused target just like tapping away.
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && focused.closest('[role="dialog"]')) focused.blur();
    setSetAdjustmentExerciseId(null);
  };

  const handleFlexibleTargetSetBlur = async (exerciseId: string) => {
    const draftValue = flexibleTargetSetDrafts[exerciseId];
    if (typeof draftValue !== 'string') return;

    const parsed = Number.parseInt(draftValue, 10);
    if (Number.isFinite(parsed)) {
      const saved = await afterNoteWrites(() => updateFlexibleExerciseMeta(exerciseId, {
        target_sets: normalizeFlexibleTargetSets(parsed),
      }));
      if (!saved) return;
    }
    setFlexibleTargetSetDrafts((prev) => {
      const next = { ...prev };
      delete next[exerciseId];
      return next;
    });

  };

  const handleInSessionDayLabelBlur = () => {
    if (!currentWorkoutDayPlan || currentWorkout?.split_day_id !== null) return;

    const trimmedDraft = inSessionFlexibleDayLabel.trim();
    if (!trimmedDraft) {
      setInSessionFlexibleDayLabel(currentWorkoutDayPlan.day_label || '');
      return;
    }

    if (trimmedDraft === currentWorkoutDayPlan.day_label) return;
    void afterNoteWrites(() => setFlexibleWorkoutLabel(trimmedDraft));
  };

  const startRestForExercise = (exerciseId: string, nextUp?: { exerciseId: string; setNumber: number }) => {
    const prefs = userId ? loadRestPreferences(userId) : {};
    const nextUpName = nextUp ? workoutExerciseMap.get(nextUp.exerciseId)?.name : undefined;
    setRestTimerNextUpLabel(nextUpName ? `${nextUpName}${REST_NEXT_UP_SET}${nextUp!.setNumber}` : null);
    setRestTimerExerciseId(exerciseId || null);
    setRestTimerSeconds(resolveRestSeconds(prefs, exerciseId, 90));
    setRestTimerSeed((current) => current + 1);
    setShowRestTimer(true);
  };

  // Manual rest: start a timer without logging a set (e.g. between warm-ups, or
  // a mid-session breather). Resolve the duration for the open movement so its
  // saved preference applies; fall back to last-used / default when no card is
  // active (empty id won't be persisted by onDurationChange).
  const handleManualRestStart = () => {
    startRestForExercise(resolvedActiveExerciseId ?? '');
  };

  const handleSetLogged = (loggedSet: WorkoutSet) => {
    if (useAppStore.getState().currentWorkout?.id !== currentWorkoutId) return;
    dispatchExpansion({ type: 'saved', exerciseId: loggedSet.exercise_id, setId: loggedSet.id });
    if (loggedSet.completed) return; // Editing a saved set never starts rest.
    const supersetFlow = supersetFlowMap.get(loggedSet.exercise_id);
    const next = nextWorkoutSet(useAppStore.getState().currentWorkout?.sets ?? [], focusOrder, loggedSet, supersetFlow, supersetFlowMap);
    if (next) setActiveExerciseId((active) => !active || active === loggedSet.exercise_id ? next.exercise_id : active);
    if (!supersetFlow || supersetFlow.role === 'B') {
      startRestForExercise(loggedSet.exercise_id, next ? { exerciseId: next.exercise_id, setNumber: next.set_number } : undefined);
    }
  };

  const splitSupersetPartnerByExerciseId = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const exercise of sessionExercises) {
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
  }, [sessionExercises]);

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
  const currentSessionTitle = currentWorkout?.split_day_id === null
    ? currentWorkoutDayPlan?.day_label || 'Flexible Session'
    : splitDay?.day_name || 'Session';

  // Mirror the live session onto the lock screen / Dynamic Island (native
  // only): exercise + set on top, sets-and-tonnage ledger line underneath.
  // The rest pill layers its countdown onto the same card independently.
  useEffect(() => {
    if (!currentWorkout) {
      endWorkoutActivity();
      return;
    }

    const activeName = resolvedActiveExerciseId ? workoutExerciseMap.get(resolvedActiveExerciseId)?.name : undefined;
    const nextSetNumber = orderedSets.find((set) => set.exercise_id === resolvedActiveExerciseId && !set.completed)?.set_number ?? null;
    // Same rule as the completion sheet's tonnage.
    const tonnage = sessionTonnage(currentWorkout.sets);

    const detailLine = [
      activeName && nextSetNumber ? `set ${nextSetNumber}` : null,
      `${completedSets} of ${totalSets} sets`,
      tonnage > 0 ? `${Math.round(tonnage).toLocaleString('en-US')} lb` : null,
    ].filter(Boolean).join(' · ');

    syncWorkoutActivity({
      exerciseName: activeName ?? currentSessionTitle,
      detailLine,
      sessionStartedAtEpochMs: currentWorkoutCreatedAt
        ? new Date(currentWorkoutCreatedAt).getTime()
        : Date.now(),
    });
  }, [currentWorkout, resolvedActiveExerciseId, orderedSets, workoutExerciseMap, completedSets, totalSets, currentSessionTitle, currentWorkoutCreatedAt]);
  const canSwap = (exerciseId: string) => !pendingSwap && Boolean(exerciseGroups[exerciseId]?.some((entry) => !entry.completed));
  const openSwap = (exerciseId: string) => {
    setSwapError(null);
    setSubstitutionSource(exerciseId);
  };

  // Plan notes typed before the swap land first, like every other plan edit.
  // The card shows progress and any failure where the user tapped Swap.
  const runSwap = (exerciseId: string, target: { id: string; name: string }, write: () => Promise<void>) => {
    if (pendingSwap || !currentWorkoutId) return;
    const workoutId = currentWorkoutId;
    const sourceName = workoutExerciseMap.get(exerciseId)?.name;
    setSubstitutionSource(null);
    setSwapError(null);
    setPendingSwap({ exerciseId, targetName: target.name });
    const guardedWrite = async () => {
      if (useAppStore.getState().currentWorkout?.id !== workoutId) return false;
      await write();
      return true;
    };
    const run = noteSaverRef.current ? noteSaverRef.current.runAfterFlush(workoutId, guardedWrite) : guardedWrite();
    void run.then((saved) => {
      if (!saved || useAppStore.getState().currentWorkout?.id !== workoutId) return;
      setActiveExerciseId((active) => active === exerciseId ? target.id : active);
      dispatchExpansion({ type: 'replace', exerciseId, replacementId: target.id });
      // A running rest that names the swapped movement now names the replacement.
      const rest = readRestTimerSession();
      const nextSet = useAppStore.getState().currentWorkout?.sets
        .filter((entry) => entry.exercise_id === target.id && !entry.completed)
        .sort((a, b) => a.set_number - b.set_number)[0];
      if (sourceName && nextSet && isRestTimerForWorkout(rest, workoutId)
        && rest?.nextUpLabel?.startsWith(`${sourceName}${REST_NEXT_UP_SET}`)) {
        setRestTimerNextUpLabel(`${target.name}${REST_NEXT_UP_SET}${nextSet.set_number}`);
      }
    }, (error: unknown) => {
      if (useAppStore.getState().currentWorkout?.id !== workoutId) return;
      setSwapError({ exerciseId, message: error instanceof Error ? error.message : 'Could not swap the exercise. Try again.' });
    }).finally(() => setPendingSwap(null));
  };

  const switchBack = (exerciseId: string) => {
    const origin = substitutionByExerciseId.get(exerciseId);
    if (!origin) return;
    runSwap(exerciseId, { id: origin.exercise_id, name: origin.exercise_name ?? 'the planned exercise' },
      () => switchBackWorkoutExercise(exerciseId));
  };

  const swapMenuActions = (exerciseId: string): CardMenuAction[] => {
    const origin = substitutionByExerciseId.get(exerciseId);
    return [
      { label: 'Swap exercise', icon: <ArrowLeftRight className="w-4 h-4" />, disabled: !canSwap(exerciseId), onClick: () => openSwap(exerciseId) },
      ...(origin ? [{
        label: `Switch back to ${origin.exercise_name ?? 'planned exercise'}`,
        icon: <Undo2 className="w-4 h-4" />,
        disabled: !canSwap(exerciseId),
        onClick: () => switchBack(exerciseId),
      }] : []),
    ];
  };

  const swapCardProps = (exerciseId: string) => {
    const origin = substitutionByExerciseId.get(exerciseId);
    return {
      substitutionLabel: origin ? `Instead of ${origin.exercise_name ?? 'the planned exercise'}` : null,
      swapStatus: pendingSwap?.exerciseId === exerciseId
        ? { text: `Swapping to ${pendingSwap.targetName}…`, failed: false }
        : swapError?.exerciseId === exerciseId ? { text: swapError.message, failed: true } : null,
    };
  };
  const swapSourceName = substitutionSource ? workoutExerciseMap.get(substitutionSource)?.name ?? 'this movement' : '';
  const swapSourceOrigin = substitutionSource ? substitutionByExerciseId.get(substitutionSource) ?? null : null;

  // ── End exercise ordering ──

  const buildCompletionSummary = (): CompletionSummary => {
    const sessionSets = currentWorkout?.sets ?? [];
    return {
      title: currentSessionTitle,
      completedSets,
      totalSets,
      duration: formatSessionDuration(currentWorkoutCreatedAt, Date.now()),
      tonnage: sessionTonnage(sessionSets),
      gains: collectSessionGains(sessionSets, previousWorkoutSetsByExercise).map((gain) => ({
        name: workoutExerciseMap.get(gain.exerciseId)?.name ?? 'Movement',
        setNumber: gain.setNumber,
        gain: gain.gain,
      })),
      completedAt: Date.now(),
    };
  };

  // Build the summary while the session still exists (the store clears it on
  // success), but only celebrate and clear the rest timer once the save lands.
  const finishWorkout = async () => {
    if (finishingRef.current) return;
    const summary = buildCompletionSummary();
    finishingRef.current = true;
    setFinishing(true);
    setFinishError(null);
    try {
      // Keep the session available until its queued plan-note patches land.
      if (currentWorkoutId && noteSaverRef.current) {
        await noteSaverRef.current.runAfterFlush(currentWorkoutId, completeWorkout);
      } else {
        await completeWorkout();
      }
      setCompletionSummary(summary);
      clearRestTimerSession();
      setShowRestTimer(false);
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : "Couldn't finish the workout. Check your connection and try again.");
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  };

  const handleCompleteWorkout = async () => {
    if (finishingRef.current) return;

    if (completedSets < totalSets && totalSets > 0) {
      setShowCompleteConfirm(true);
      return;
    }

    if (workoutMode === 'flexible' && currentWorkout?.split_day_id === null) {
      setShowSaveTemplatePrompt(true);
      return;
    }

    await finishWorkout();
  };

  const handleConfirmComplete = async () => {
    setShowCompleteConfirm(false);

    if (workoutMode === 'flexible' && currentWorkout?.split_day_id === null) {
      setShowSaveTemplatePrompt(true);
      return;
    }

    await finishWorkout();
  };

  const handleSaveTemplateAtCompletion = async () => {
    try {
      setSavingTemplate(true);
      // the template takes the notes on screen, including ones still saving
      await saveFlexibleTemplateFromCurrentWorkout(movementNotesRef.current);
      setShowSaveTemplatePrompt(false);
      await finishWorkout();
      await fetchFlexTemplates();
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSkipTemplateAtCompletion = async () => {
    setShowSaveTemplatePrompt(false);
    await finishWorkout();
  };

  /* ═══════════════ Initializing ═══════════════ */

  if (initializing) {
    return (
      <motion.div className="metal-page train-pre pb-nav">
        <header>
          <div className="train-head"><Eyebrow>Train</Eyebrow></div>
          <div className="shimmer h-8 w-44 mt-2" aria-hidden />
        </header>
        <div aria-hidden>
          <div className="shimmer h-[90px] w-36 mt-5" />
          <div className="shimmer h-[2px] w-full mt-[18px]" />
        </div>
        <p className="sr-only" role="status">Loading program</p>
      </motion.div>
    );
  }

  /* ═══════════════ No program (split mode) ═══════════════ */

  if (workoutMode === 'split' && !activeSplit) {
    return (
      <motion.div className="metal-page train-pre pb-nav">
        <header>
          <div className="train-head"><Eyebrow>Train</Eyebrow></div>
          <MetalTitle>No program yet</MetalTitle>
        </header>
        <p className="metal-note">A program turns sessions into a plan: days, exercises, and weekly volume that adds up. The guided builder takes two minutes.</p>
        <TrainCapsule spec={{
          key: 'build-program',
          label: 'Build my program',
          sublabel: 'Guided builder · about 2 minutes',
          glyph: 'arrow',
          dock: 'tabbar',
          onPress: () => navigate('/train/program'),
        }} />
      </motion.div>
    );
  }

  const splitDays = activeSplit?.days || [];
  const splitDaysPerWeek = activeSplit?.days_per_week || 0;

  const weekdayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const weekStart = startOfWeek(weekCursor, TRAINING_WEEK);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const startDate = planSchedule ? parseISO(`${planSchedule.startDate}T00:00:00`) : null;

  const today = new Date();
  const todayPlannedDay =
    planSchedule && startDate && !isBefore(today, startDate)
      ? plannedDayForDate(today, splitDays, planSchedule, 0, scheduleWorkouts, adaptiveSchedulingEnabled)
      : null;

  // Today's status must not depend on which calendar week is being browsed.
  const todayKey = format(today, 'yyyy-MM-dd');
  const todayCompletedWorkout = scheduleWorkouts.find((workout) => workout.date === todayKey)
    || (lastCompletedWorkout?.date === todayKey ? lastCompletedWorkout : null);

  const openScheduleEditor = () => {
    if (!planSchedule) return;

    const splitDayCount = splitDays.length;
    const fallbackFlexDay = normalizeIndex(planSchedule.flexAnchorIndex ?? planSchedule.anchorDay ?? 0, splitDayCount);

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
      const label = flexibleDayLabel.trim();
      const flexibleCapsule: CommandCapsuleSpec = {
        key: 'start-flexible',
        label: startingFlexibleWorkout ? 'Starting…' : label ? `Start ${label}` : 'Start session',
        sublabel: label ? (selectedTemplateLabel ? 'Quick start · its movements and notes' : 'Flexible session') : 'Name what you’re training first',
        glyph: 'arrow',
        dock: 'tabbar',
        busy: startingFlexibleWorkout,
        disabled: !label,
        ariaLabel: label ? `Start session: ${label}` : 'Start session',
        onPress: () => { void handleStartFlexibleWorkout(); },
      };

      return (
        <motion.div className="metal-page train-pre pb-nav">
          <header>
            <div className="train-head">
              <Eyebrow>Train · Flexible</Eyebrow>
              <div className="train-head-actions">
                <LineButton onClick={() => navigate('/train/run')}>Run</LineButton>
              </div>
            </div>
            <MetalTitle note="Build today as you go.">Start a session</MetalTitle>
          </header>

          <div className="train-flex-form">
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
          </div>

          {flexTemplates.length > 0 && (
            <MetalSection label="Quick start">
              <div className="flex flex-wrap gap-2 mt-2">
                {flexTemplates.slice(0, 6).map((template) => {
                  const selected = selectedTemplateLabel === template.label;
                  return (
                    <Chip
                      key={template.id}
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
            </MetalSection>
          )}

          <TrainCapsule spec={flexibleCapsule} />
          <CompletionSheet summary={completionSummary} onClose={() => setCompletionSummary(null)} />
        </motion.div>
      );
    }

    const preState = planSchedule && scheduleWorkoutsLoading ? 'loading'
      : planSchedule && scheduleError ? 'error'
        : !planSchedule ? (planScheduleResolving ? 'setup-loading' : 'setup')
          : todayCompletedWorkout ? 'done'
            : todayPlannedDay ? 'planned' : 'rest';
    const programWeek = planSchedule
      ? differenceInCalendarWeeks(today, parseISO(planSchedule.startDate), TRAINING_WEEK) + 1
      : null;
    const plannedSets = (todayPlannedDay?.exercises || []).reduce((sum, ex) => sum + (ex.target_sets || 0), 0);
    const plannedExercises = todayPlannedDay?.exercises?.length || 0;
    const firstPlannedName = [...(todayPlannedDay?.exercises || [])]
      .sort((a, b) => (a.exercise_order ?? 0) - (b.exercise_order ?? 0))[0]?.exercise?.name;
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const setupRhythm = setupMode === 'fixed'
      ? buildFixedWeekdays(setupAnchorDay, activeSplit?.days_per_week || 0).map((day) => weekdayNames[day]).join(' / ')
      : 'Flexible sequence';
    const setupDay1 = /^\d{4}-\d{2}-\d{2}$/.test(setupStartDate) ? format(parseISO(setupStartDate), 'EEE, MMM d') : null;

    const preCapsule: CommandCapsuleSpec | null = preState === 'planned' && todayPlannedDay ? {
      key: `start:${todayPlannedDay.id}`,
      label: startingDayId === todayPlannedDay.id ? 'Starting…' : `Start ${todayPlannedDay.day_name}`,
      sublabel: `${plannedSets} ${plannedSets === 1 ? 'set' : 'sets'}${firstPlannedName ? ` · ${firstPlannedName} first` : ''}`,
      glyph: 'arrow',
      dock: 'tabbar',
      busy: startingDayId !== null,
      ariaLabel: `Start today’s workout, ${todayPlannedDay.day_name}`,
      onPress: () => { void handleStartWorkout(todayPlannedDay); },
    } : preState === 'error' ? {
      key: 'schedule-retry',
      label: 'Retry',
      sublabel: 'Couldn’t load your workout schedule',
      alert: true,
      glyph: 'arrow',
      dock: 'tabbar',
      ariaLabel: 'Retry loading your workout schedule',
      onPress: retrySchedule,
    } : preState === 'setup' ? {
      key: 'save-plan',
      label: savingPlanSchedule ? 'Saving…' : 'Save plan setup',
      sublabel: [setupDay1 ? `Day 1 ${setupDay1}` : null, setupRhythm].filter(Boolean).join(' · '),
      glyph: 'check',
      dock: 'tabbar',
      busy: savingPlanSchedule,
      onPress: () => { void handleSavePlanSetup(); },
    } : null;

    return (
      <motion.div className="metal-page train-pre pb-nav">
        <header>
          <div className="train-head">
            <Eyebrow>Train</Eyebrow>
            <div className="train-head-actions">
              <LineButton onClick={() => navigate('/train/run')}>Run</LineButton>
              {planSchedule && <LineButton onClick={openScheduleEditor}>Schedule</LineButton>}
            </div>
          </div>
          {preState === 'loading' || preState === 'setup-loading' ? (
            <div className="shimmer h-8 w-44 mt-2" aria-hidden />
          ) : preState === 'error' ? (
            <MetalTitle note="Couldn’t load your workout schedule.">Today</MetalTitle>
          ) : preState === 'setup' ? (
            <MetalTitle note={activeSplit?.name}>Start your plan</MetalTitle>
          ) : preState === 'done' ? (
            <MetalTitle note="The work is banked.">Trained today</MetalTitle>
          ) : preState === 'planned' && todayPlannedDay ? (
            <MetalTitle note={[activeSplit?.name, programWeek && programWeek >= 1 ? `week ${programWeek}` : null].filter(Boolean).join(' · ') || undefined}>
              {todayPlannedDay.day_name}
            </MetalTitle>
          ) : (
            <MetalTitle note={<span className="metal-quote">Recovery is part of the program.</span>}>Rest day</MetalTitle>
          )}
        </header>

        {preState === 'loading' ? (
          <p className="metal-note" role="status">Loading workout schedule…</p>
        ) : preState === 'error' ? null : preState === 'setup-loading' ? (
          <p className="metal-note" role="status">Loading saved plan setup</p>
        ) : preState === 'setup' ? (
          <div className="train-setup">
            <p className="metal-note">Set your Day 1 and weekly rhythm, and hyPer calls each session from there.</p>
            <ScheduleEditor
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
              saveLabel="Save plan setup"
              saving={savingPlanSchedule}
              hideSave
            />
          </div>
        ) : planSchedule && (
          <>
            <section aria-label="Today" className="train-today">
              {preState === 'done' && (
                <>
                  <BankedStamp date={format(new Date(), 'MMM d')} className="train-banked" />
                  <p className="metal-note">Rest, or pick a different day below.</p>
                </>
              )}
              {preState === 'planned' && todayPlannedDay && (
                <HeroFigure
                  value={plannedSets}
                  caption={`${plannedSets === 1 ? 'set' : 'sets'} · ${plannedExercises} ${plannedExercises === 1 ? 'exercise' : 'exercises'}`}
                  segments={{ total: Math.max(1, plannedSets), on: 0, label: `${plannedSets} sets planned` }}
                />
              )}
              {lastCompletedWorkout && (
                <p className="metal-note train-last">
                  Last trained {format(parseISO(`${lastCompletedWorkout.date}T00:00:00`), 'EEE, MMM d')}
                </p>
              )}
            </section>

            {/* Week strip */}
            <MetalSection
              label={`${format(weekStart, 'MMM d')} – ${format(addDays(weekStart, 6), 'MMM d')}`}
              right={(
                <span className="train-week-nav">
                  <button type="button" aria-label="Previous week" onClick={() => setWeekCursor((current) => addDays(current, -7))}>
                    <ChevronLeft size={16} strokeWidth={1.6} aria-hidden />
                  </button>
                  <button type="button" onClick={() => setWeekCursor(new Date())}>Now</button>
                  <button type="button" aria-label="Next week" onClick={() => setWeekCursor((current) => addDays(current, 7))}>
                    <ChevronRight size={16} strokeWidth={1.6} aria-hidden />
                  </button>
                </span>
              )}
            >
              <div className="train-week" role="list" aria-label="Training week">
                {weekDays.map((date) => {
                  const dateKey = format(date, 'yyyy-MM-dd');
                  const workout = weekWorkouts.find((entry) => entry.date === dateKey && entry.completed);
                  const plannedDay = plannedDayForDate(date, activeSplit?.days || [], planSchedule, 0, scheduleWorkouts, adaptiveSchedulingEnabled);
                  const isToday = isSameDay(date, today);

                  let status: 'completed' | 'planned' | 'rest' | 'missed' = 'rest';
                  if (workout) {
                    status = 'completed';
                  } else if (plannedDay) {
                    status = isBefore(date, today) && !isToday ? 'missed' : 'planned';
                  }
                  const dayLabel = workout ? activeSplit?.days.find((day) => day.id === workout.split_day_id)?.day_name || 'Completed workout' : plannedDay?.day_name || 'Rest';

                  return (
                    <div
                      key={dateKey}
                      role="listitem"
                      title={`${format(date, 'EEE, MMM d')}: ${dayLabel}`}
                      aria-label={`${format(date, 'EEE, MMM d')}: ${dayLabel} (${status})${isToday ? ', today' : ''}`}
                      className={`train-day is-${status}${isToday ? ' is-today' : ''}`}
                    >
                      <span className="train-day-letter" aria-hidden>{weekdayLetters[date.getDay()]}</span>
                      <span className="train-day-date" aria-hidden>{format(date, 'd')}</span>
                      <span className="train-day-mark" aria-hidden />
                    </div>
                  );
                })}
              </div>
            </MetalSection>

            {/* Other days */}
            <MetalSection label="Train a different day">
              <p className="metal-note train-other-note">{!adaptiveSchedulingEnabled
                ? 'Adaptive split scheduling is off. Workouts follow your saved schedule.'
                : planSchedule.mode === 'fixed'
                ? 'Finishing a different day shifts upcoming workouts and rest days to follow your split.'
                : 'Finishing a different day moves your next workout forward from that day.'}</p>
              <ul className="train-days">
                {(activeSplit?.days || []).map((day) => (
                  <li key={day.id} className="metal-row">
                    <span className="min-w-0">
                      <span className="metal-row-title">{day.day_name}</span>
                      <span className="metal-row-detail">{day.exercises?.length || 0} exercises</span>
                    </span>
                    <button
                      type="button"
                      className="metal-text-btn train-day-start"
                      onClick={() => { tapHaptic(); void handleStartWorkout(day); }}
                      disabled={startingDayId !== null}
                      aria-label={`Start ${day.day_name}`}
                    >
                      {startingDayId === day.id ? 'Starting…' : 'Start'}
                    </button>
                  </li>
                ))}
              </ul>
            </MetalSection>
          </>
        )}

        <TrainCapsule spec={preCapsule} />

        <Modal isOpen={showScheduleEditor} onClose={() => setShowScheduleEditor(false)} title="Edit schedule">
          <ScheduleEditor
            title="Adjust plan"
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
            saveLabel="Save changes"
            saving={savingPlanSchedule}
          />
        </Modal>

        <CompletionSheet summary={completionSummary} onClose={() => setCompletionSummary(null)} />
      </motion.div>
    );
  }

  /* ═══════════════ In session ═══════════════ */

  const isFlexibleSession = workoutMode === 'flexible' && currentWorkout.split_day_id === null;
  const movementName = (id: string) => workoutExerciseMap.get(id)?.name || activeFlexibleItems.find((item) => item.exercise_id === id)?.exercise_name || 'Movement';
  const pinTitle = expansion.expandedExerciseId && focusOrder.includes(expansion.expandedExerciseId)
    ? movementName(expansion.expandedExerciseId)
    : currentSessionTitle;
  const flexibleEmpty = isFlexibleSession && activeFlexibleItems.length === 0;
  const openAddMovement = () => { setSupersetPickerSourceExerciseId(null); setShowExercisePicker(true); };

  return (
    <motion.div className={`studio-workout-page metal-page${showRestTimer ? ' has-rest-timer' : ''}`}>
      <SessionPin
        title={pinTitle}
        createdAt={currentWorkoutCreatedAt}
        finishing={finishing}
        onBack={() => navigate('/')}
        onFinish={() => { void handleCompleteWorkout(); }}
      />
      <header className="studio-session-header">
        <div className="studio-session-top">
          <button type="button" onClick={() => navigate('/')}><ChevronLeft size={18} strokeWidth={1.75} aria-hidden /> Today</button>
          <span>{currentWorkoutCreatedAt ? <SessionClock key={currentWorkoutCreatedAt} createdAt={currentWorkoutCreatedAt} /> : '—'}</span>
          <Button variant="ghost" size="sm" onClick={handleCompleteWorkout} disabled={finishing}>{finishing ? 'Finishing…' : 'Finish'}</Button>
        </div>
        {finishError && <div className="studio-session-error">
          <p className="metal-flag" role="alert"><span>{finishError}</span></p>
          {noteSaveFailed && <button type="button" className="metal-text-btn" onClick={() => {
            void settleNoteWrites().then(() => setFinishError(null)).catch(() => {});
          }}>Retry</button>}
        </div>}
        <Eyebrow live className="studio-session-eyebrow">{isFlexibleSession ? 'Flexible session' : activeSplit?.name || 'Session in progress'}</Eyebrow>
        <h1 className="metal-title studio-session-title" data-session-title>
          {isFlexibleSession
            ? <button type="button" onClick={() => setShowSessionDetails(true)} aria-label="Edit workout name">{currentSessionTitle}<Pencil size={14} aria-hidden /></button>
            : <span>{currentSessionTitle}</span>}
          <small>{totalSets > 0 ? `${completedSets} of ${totalSets} ${totalSets === 1 ? 'set' : 'sets'}` : 'No sets yet'}</small>
        </h1>
        {totalSets > 0 && <SegmentedHairline
          total={totalSets}
          on={completedSets}
          now={completedSets < totalSets ? completedSets : undefined}
          max={40}
          label={`${completedSets} of ${totalSets} sets logged`}
        />}
      </header>

      <section className="metal-section studio-session-list" aria-label="Movements">
        <div className="metal-section-head">
          <Eyebrow>{focusOrder.length} {focusOrder.length === 1 ? 'movement' : 'movements'}</Eyebrow>
          <div className="metal-section-head-right">
            <button type="button" className="metal-line-btn" onClick={() => { tapHaptic(); handleManualRestStart(); }} disabled={showRestTimer}
              aria-label={showRestTimer ? 'Rest timer is running' : 'Start rest timer'}><Timer aria-hidden />Rest</button>
            {isFlexibleSession && !flexibleEmpty && <button type="button" className="metal-line-btn" onClick={() => { tapHaptic(); openAddMovement(); }}>
              <Plus aria-hidden />Add movement</button>}
          </div>
        </div>

      <MovementReorderList key={currentWorkout.id} onReorder={reorderSessionMovements}
        items={focusOrder.map((id) => ({ id, name: workoutExerciseMap.get(id)?.name || activeFlexibleItems.find((item) => item.exercise_id === id)?.exercise_name || 'Movement', supersetGroupId: supersetByExerciseId.get(id) }))}>
      {isFlexibleSession ? (
        <div className="studio-movements">
          <Modal isOpen={showSessionDetails} onClose={() => setShowSessionDetails(false)} title="Workout name">
              <Input
                label="Name"
                value={inSessionFlexibleDayLabel}
                onChange={(event) => setInSessionFlexibleDayLabel(event.target.value)}
                onBlur={handleInSessionDayLabelBlur}
                placeholder="Upper / Push / Legs"
              />
              <Button className="w-full mt-4" onClick={() => setShowSessionDetails(false)}>Done</Button>
          </Modal>

          {activeFlexibleItems.length === 0 ? (
            <div className="studio-session-empty">
              <p className="metal-row-title">Nothing on the bar yet</p>
              <p className="metal-note">Add your first movement and the session starts counting.</p>
            </div>
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
              const isActive = expansion.expandedExerciseId === exerciseId;
              const allComplete = sets.length > 0 && completedInExercise === sets.length;
              const movementNote = exerciseId in movementNotes ? movementNotes[exerciseId] : (item.notes || '');
              const supersetGroupId = item.superset_group_id || null;
              const supersetPartner = supersetGroupId
                ? activeFlexibleItems.find((candidate) => candidate.exercise_id !== exerciseId && candidate.superset_group_id === supersetGroupId)
                : null;
              const supersetRole = supersetFlowMap.get(exerciseId)?.role;
              const firstUncompletedSetId = sets.find((set) => !set.completed)?.id ?? null;
              const repTarget = formatRepTarget(item.target_reps_min, item.target_reps_max);

              return (
                <ExerciseCard
                  key={exerciseId}
                  exerciseId={exerciseId}
                  index={index}
                  movementCount={activeFlexibleItems.length}
                  exerciseName={exerciseName}
                  previousTargetText={previousWorkoutSetsByExercise[exerciseId]?.[sets.find((set) => !set.completed)?.set_number ?? 1] ? formatSetPerformanceTarget(previousWorkoutSetsByExercise[exerciseId][sets.find((set) => !set.completed)?.set_number ?? 1]) : null}
                  completedCount={completedInExercise}
                  totalCount={sets.length || flexibleTargetSet}
                  allComplete={allComplete}
                  isActive={isActive}
                  isNext={exerciseId === nextMovementId}
                  repTarget={repTarget}
                  progressLine={movementProgressLine(sets, repTarget)}
                  onToggle={() => selectMovement(exerciseId)}
                  supersetRole={supersetRole}
                  supersetLabel={
                    supersetPartner
                      ? `${supersetRole ?? ''}${supersetRole ? ' · ' : ''}with ${supersetPartner.exercise_name || workoutExerciseMap.get(supersetPartner.exercise_id)?.name || 'Exercise'}`
                      : null
                  }
                  notePreview={!isActive && movementNote.trim() ? movementNote : null}
                  {...swapCardProps(exerciseId)}
                  menuActions={[
                    { label: 'Adjust sets', icon: <Settings2 className="w-4 h-4" />, onClick: () => setSetAdjustmentExerciseId(exerciseId) },
                    ...swapMenuActions(exerciseId),
                    supersetGroupId
                      ? {
                          label: 'Unlink superset',
                          icon: <Unlink2 className="w-4 h-4" />,
                          tone: 'sage' as const,
                          onClick: () => { void afterNoteWrites(() => clearFlexibleSuperset(exerciseId)); },
                        }
                      : {
                          label: 'Add superset',
                          icon: <Link2 className="w-4 h-4" />,
                          onClick: () => {
                            setSupersetPickerSourceExerciseId(exerciseId);
                            setShowExercisePicker(true);
                          },
                        },
                    {
                      label: 'Remove exercise',
                      icon: <Trash2 className="w-4 h-4" />,
                      tone: 'danger' as const,
                      onClick: () => { void afterNoteWrites(() => removeFlexibleExerciseFromPlan(exerciseId)); },
                    },
                  ]}
                >
                  <Modal isOpen={setAdjustmentExerciseId === exerciseId} onClose={closeSetAdjustment} title={`Sets · ${exerciseName}`}>
                  <div className="studio-set-adjust">
                    <label className="studio-set-adjust-target">
                      <span className="metal-eyebrow">Target sets</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={12}
                        value={flexibleTargetInputValue}
                        onChange={(event) => {
                          handleFlexibleTargetSetDraftChange(exerciseId, event.target.value);
                        }}
                        onBlur={() => { void handleFlexibleTargetSetBlur(exerciseId); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            (event.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        className="metal-input studio-set-adjust-input"
                      />
                    </label>
                    <div className="studio-set-adjust-steps">
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
                  </Modal>

                  <div className="studio-set-list">
                    {sets.map((set, idx) => (
                      <div
                        key={set.id}
                        className="studio-set-slot"
                        style={{ '--i': Math.min(idx, 10) } as React.CSSProperties}
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
                          repTarget={repTarget}
                          isNext={set.id === firstUncompletedSetId}
                          editing={set.id === editorSet?.id}
                          exerciseName={exerciseName}
                          onSelect={() => { dispatchExpansion({ type: 'select', exerciseId, setId: set.id }); setActiveExerciseId(exerciseId); }}
                          onHide={() => dispatchExpansion({ type: 'hide', exerciseId })}
                          onBeforeComplete={validateSupersetOrderBeforeLog}
                          onComplete={handleSetLogged}
                        />
                      </div>
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
                const sourceExerciseId = supersetPickerSourceExerciseId;
                void afterNoteWrites(() => addFlexibleSuperset(sourceExerciseId, exercise));
                setSupersetPickerSourceExerciseId(null);
                return;
              }

              void afterNoteWrites(() => addFlexibleExercise(exercise));
            }}
            excludeExerciseIds={activeFlexibleItems.map((item) => item.exercise_id)}
            title={supersetPickerSourceExerciseId ? 'Add Superset Exercise' : 'Add Exercise'}
          />
        </div>
      ) : (
        <div className="studio-movements">
          {orderedExerciseEntries.map(([exerciseId, sets], index) => {
            const rawSet = sets[0] as WorkoutSet & { exercises?: { name?: string } };
            const exerciseName = rawSet.exercise?.name || rawSet.exercises?.name || 'Unknown Exercise';
            const completedInExercise = sets.filter(s => s.completed).length;
            const isActive = expansion.expandedExerciseId === exerciseId;
            const allComplete = completedInExercise === sets.length;
            const movementNote = movementNotes[exerciseId] || '';
            const supersetPartnerId = splitSupersetPartnerByExerciseId.get(exerciseId) || null;
            const supersetPartnerName = supersetPartnerId
              ? (workoutExerciseMap.get(supersetPartnerId)?.name || 'Exercise')
              : null;
            const supersetRole = supersetFlowMap.get(exerciseId)?.role;
            const setRange = exerciseSetRanges.get(exerciseId) ?? { minSets: 1, targetSets: sets.length, maxSets: 12 };
            const canAddSet = sets.length < setRange.maxSets;
            const hasRemovableUncompletedSet = sets.some((set) => !set.completed);
            const canRemoveSet = sets.length > setRange.minSets && hasRemovableUncompletedSet;
            const firstUncompletedSetId = sets.find((set) => !set.completed)?.id ?? null;
            const prescription = sessionExercises.find((entry) => entry.exercise_id === exerciseId);
            const repTarget = formatRepTarget(prescription?.target_reps_min, prescription?.target_reps_max);

            return (
              <ExerciseCard
                key={exerciseId}
                exerciseId={exerciseId}
                index={index}
                movementCount={orderedExerciseEntries.length}
                exerciseName={exerciseName}
                previousTargetText={previousWorkoutSetsByExercise[exerciseId]?.[sets.find((set) => !set.completed)?.set_number ?? 1] ? formatSetPerformanceTarget(previousWorkoutSetsByExercise[exerciseId][sets.find((set) => !set.completed)?.set_number ?? 1]) : null}
                completedCount={completedInExercise}
                totalCount={sets.length}
                allComplete={allComplete}
                isActive={isActive}
                isNext={exerciseId === nextMovementId}
                repTarget={repTarget}
                progressLine={movementProgressLine(sets, repTarget)}
                progressAction={hasRemovableUncompletedSet ? (
                  <button type="button" className="studio-movement-swap" disabled={!canSwap(exerciseId)}
                    aria-label={`Swap ${exerciseName} for this workout`}
                    onClick={() => { tapHaptic(); openSwap(exerciseId); }}>
                    <ArrowLeftRight size={14} aria-hidden />Swap
                  </button>
                ) : null}
                onToggle={() => selectMovement(exerciseId)}
                supersetRole={supersetRole}
                supersetLabel={
                  supersetPartnerName ? `${supersetRole ?? ''}${supersetRole ? ' · ' : ''}with ${supersetPartnerName}` : null
                }
                notePreview={!isActive && movementNote.trim() ? movementNote : null}
                {...swapCardProps(exerciseId)}
                menuActions={[{ label: 'Adjust sets', icon: <Settings2 className="w-4 h-4" />, onClick: () => setSetAdjustmentExerciseId(exerciseId) }, ...swapMenuActions(exerciseId)]}
              >
                <Modal isOpen={setAdjustmentExerciseId === exerciseId} onClose={closeSetAdjustment} title={`Sets · ${exerciseName}`}>
                <div className="studio-set-adjust">
                  <span className="studio-set-adjust-target">
                    <span className="metal-eyebrow">{exerciseSetRanges.has(exerciseId) ? 'Plan' : 'Sets'}</span>
                    <span className="metal-row-detail">
                      {exerciseSetRanges.has(exerciseId)
                        ? `Target ${sessionExercises.find((entry) => entry.exercise_id === exerciseId)?.target_reps_min ?? '—'}–${sessionExercises.find((entry) => entry.exercise_id === exerciseId)?.target_reps_max ?? '—'} reps · ${setRange.targetSets} sets`
                        : `Choose your reps · ${sets.length} sets`}
                    </span>
                  </span>
                  <div className="studio-set-adjust-steps">
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
                </Modal>

                <div className="studio-set-list">
                  {sets.map((set, idx) => (
                    <div
                      key={set.id}
                      className="studio-set-slot"
                      style={{ '--i': Math.min(idx, 10) } as React.CSSProperties}
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
                        repTarget={repTarget}
                        isNext={set.id === firstUncompletedSetId}
                        editing={set.id === editorSet?.id}
                        exerciseName={exerciseName}
                        onSelect={() => { dispatchExpansion({ type: 'select', exerciseId, setId: set.id }); setActiveExerciseId(exerciseId); }}
                        onHide={() => dispatchExpansion({ type: 'hide', exerciseId })}
                        onBeforeComplete={validateSupersetOrderBeforeLog}
                        onComplete={handleSetLogged}
                      />
                    </div>
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

      </MovementReorderList>
      </section>
      <ExercisePicker
        isOpen={substitutionSource !== null}
        onClose={() => setSubstitutionSource(null)}
        title="Swap for this workout"
        intro={substitutionSource && (swapSourceOrigin ? (
          <div className="space-y-3">
            <Button variant="secondary" className="w-full" onClick={() => switchBack(substitutionSource)}>
              <Undo2 className="w-4 h-4" aria-hidden />
              Switch back to {swapSourceOrigin.exercise_name ?? 'the planned exercise'}
            </Button>
            <p className="t-caption">Or replace {swapSourceName} with another exercise. Your program stays the same.</p>
          </div>
        ) : (
          <p className="t-caption">Replacing {swapSourceName}. Its sets and rep target carry over; your program stays the same.</p>
        ))}
        initialMuscleGroup={substitutionSource ? workoutExerciseMap.get(substitutionSource)?.muscle_group : undefined}
        excludeExerciseIds={exerciseIds}
        onSelect={(replacement) => {
          if (!substitutionSource) return;
          const source = substitutionSource;
          runSwap(source, replacement, () => substituteWorkoutExercise(source, replacement));
        }}
      />

      {/* Metal command capsule: the next set with a check ring that logs
          through the set row's own save, or Finish when every set is logged. */}
      <WorkoutCommandCapsule
        active={!currentWorkout.completed}
        orderedSets={orderedSets}
        focusOrder={focusOrder}
        editorSet={editorSet}
        pairings={supersetFlowMap}
        previousWorkoutSetsByExercise={previousWorkoutSetsByExercise}
        exerciseName={(id) => workoutExerciseMap.get(id)?.name || activeFlexibleItems.find((item) => item.exercise_id === id)?.exercise_name || 'Movement'}
        completedSets={completedSets}
        totalSets={totalSets}
        finishing={finishing}
        onFinish={() => { void handleCompleteWorkout(); }}
      />
      {/* An empty flexible session has no set to log yet: its first movement is the action. */}
      <TrainCapsule spec={flexibleEmpty ? {
        key: 'add-first-movement',
        label: 'Add first exercise',
        sublabel: 'The session starts counting from there',
        glyph: 'plus',
        dock: 'bottom',
        onPress: openAddMovement,
      } : null} />

      {/* Rest is independent of movement expansion and set entry. */}
      {showRestTimer && (
        <RestTimerPill
          key={`${currentWorkout.id}:${restTimerSeed}`}
          workoutId={currentWorkout.id}
          sessionSeed={restTimerSeed}
          defaultSeconds={restTimerSeconds}
          nextUpLabel={restTimerNextUpLabel}
          exerciseId={restTimerExerciseId}
          onDurationChange={(seconds) => {
            // After leaving Train the pill restores from storage; so does its movement.
            const exerciseId = restTimerExerciseId ?? readRestTimerSession()?.exerciseId;
            if (userId && exerciseId) {
              saveRestPreference(userId, exerciseId, seconds);
            }
          }}
          onDismiss={() => setShowRestTimer(false)}
        />
      )}

      {/* Complete Confirmation */}
      <Modal isOpen={showCompleteConfirm} onClose={() => setShowCompleteConfirm(false)} title="Finish workout?">
        <div className="studio-sheet-body">
          <div className="studio-finish-figure">
            <span className="metal-num">{completedSets}</span>
            <span className="metal-hero-caption">of {totalSets} {totalSets === 1 ? 'set' : 'sets'} logged</span>
          </div>
          <SegmentedHairline total={Math.max(1, totalSets)} on={completedSets} max={40} label={`${completedSets} of ${totalSets} sets logged`} />
          <p className="metal-note">Remaining sets won't be logged. You can always edit this session later in History.</p>
          <div className="studio-sheet-actions">
            <Button variant="secondary" className="flex-1" onClick={() => setShowCompleteConfirm(false)}>
              Keep training
            </Button>
            <Button className="flex-1" onClick={handleConfirmComplete} disabled={finishing}>
              Finish
            </Button>
          </div>
        </div>
      </Modal>

      {/* Save template prompt (flexible) */}
      <Modal isOpen={showSaveTemplatePrompt} onClose={() => setShowSaveTemplatePrompt(false)} title="Save as quick start?">
        <div className="studio-sheet-body">
          <p className="metal-line">
            Keep <span className="font-medium">{currentWorkoutDayPlan?.day_label || 'this day'}</span> as a one-tap template?
          </p>
          <p className="metal-note">An existing template with this label will be replaced with today's exercises and notes.</p>
          <div className="studio-sheet-actions">
            <Button variant="secondary" className="flex-1" onClick={handleSkipTemplateAtCompletion} disabled={finishing}>
              Skip
            </Button>
            <Button
              className="flex-1"
              onClick={() => { void handleSaveTemplateAtCompletion(); }}
              loading={savingTemplate}
              disabled={savingTemplate || finishing}
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

type CardMenuAction = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'sage' | 'danger';
};

/**
 * One movement in the session list. Closed, it is a hairline row (name,
 * where it stands, count). Open, it shows the Fraunces title, "Set n of N ·
 * target", its set rows and note, and an explicit collapse; drafts stay
 * mounted either way.
 */
function ExerciseCard({
  exerciseId,
  index,
  movementCount,
  exerciseName,
  previousTargetText,
  completedCount,
  totalCount,
  allComplete,
  isActive,
  isNext,
  repTarget,
  progressLine,
  progressAction,
  onToggle,
  supersetRole,
  supersetLabel,
  notePreview,
  substitutionLabel,
  swapStatus,
  menuActions,
  children,
}: {
  exerciseId: string;
  index: number;
  movementCount: number;
  exerciseName: string;
  previousTargetText: string | null;
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  isActive: boolean;
  isNext: boolean;
  repTarget: string | null;
  /** "Set 2 of 3 · target 8–10 reps" under the open title. */
  progressLine: string;
  /** A quiet action on the progress line (Swap). */
  progressAction?: React.ReactNode;
  onToggle: () => void;
  supersetRole?: 'A' | 'B';
  supersetLabel: string | null;
  notePreview: string | null;
  /** "Instead of …" when this movement is a session-only swap. */
  substitutionLabel: string | null;
  swapStatus: { text: string; failed: boolean } | null;
  menuActions: CardMenuAction[];
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const contentId = useId();
  const summaryId = useId();
  const isNow = isNext && !allComplete;
  const summary = allComplete
    ? `Done · ${totalCount} ${totalCount === 1 ? 'set' : 'sets'}`
    : [
      isNow ? 'Now' : null,
      `${totalCount} ${totalCount === 1 ? 'set' : 'sets'}`,
      repTarget,
      previousTargetText ? `last ${previousTargetText}` : null,
    ].filter(Boolean).join(' · ');
  const headingRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const reveal = revealRef.current;
    if (!reveal) return;
    // Clip only while growing; once open, focus rings and floating marks may
    // overhang the movement.
    reveal.dataset.settled = 'false';
    if (!isActive) return;
    const timer = window.setTimeout(() => { reveal.dataset.settled = 'true'; }, 420);
    return () => window.clearTimeout(timer);
  }, [isActive]);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const litMenuRef = useLitSurface<HTMLDivElement>();
  useEffect(() => {
    if (!isActive || !headingRef.current) return;
    const scroller = headingRef.current.closest<HTMLElement>('[data-app-scroll-viewport]');
    if (!scroller) return;
    const bounds = headingRef.current.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    // Opening near an edge reveals the heading and first row in this scroller
    // only, clear of the pinned session bar.
    if (bounds.top < viewport.top + 56 || bounds.bottom + 150 > viewport.bottom) {
      scroller.scrollTop += bounds.top - viewport.top - 56;
    }
  }, [isActive]);
  return (
    <section data-movement-reorder-id={exerciseId} className={`studio-movement${isActive ? ' is-active' : ''}${allComplete ? ' is-complete' : ''}${isNow ? ' is-now' : ''}`} aria-label={exerciseName}>
      <div className="studio-movement-header" ref={headingRef}>
        <button ref={toggleRef} type="button" className="studio-movement-toggle" aria-expanded={isActive} aria-controls={contentId}
          aria-describedby={!isActive ? summaryId : undefined}
          aria-label={`${isActive ? 'Collapse' : 'Expand'} ${exerciseName}`} onClick={() => { setMenuOpen(false); onToggle(); }}>
          <span className="studio-movement-heading">
            {isActive && <span className="studio-movement-eyebrow">
              Movement {index + 1} of {movementCount}{supersetRole ? ` · Superset ${supersetRole}` : ''}
            </span>}
            <span className={isActive ? 'studio-movement-name' : 'studio-movement-name-compact'}>{exerciseName}</span>
            {!isActive && <span id={summaryId} className="studio-movement-summary">{summary}</span>}
          </span>
          <span className="studio-movement-count">
            {completedCount} / {totalCount}
            {isActive && <ChevronUp className="studio-movement-chevron" size={15} strokeWidth={1.75} aria-hidden />}
          </span>
        </button>
        <div className="studio-movement-controls">
        {isActive && menuActions.length > 0 && <div className="relative">
          <button ref={optionsRef} type="button" aria-label={`Options for ${exerciseName}`} aria-expanded={menuOpen}
            className="studio-movement-options" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={20} strokeWidth={1.75} /></button>
          {menuOpen && <>
            <button className="fixed inset-0 z-10" aria-label="Close exercise options" onClick={() => setMenuOpen(false)} />
            <div ref={litMenuRef} className="studio-movement-menu">
              {menuActions.map((action) => <button key={action.label} type="button" disabled={action.disabled}
                className={action.tone === 'danger' ? 'is-danger' : undefined}
                onClick={() => { setMenuOpen(false); optionsRef.current?.focus({ preventScroll: true }); action.onClick(); }}>{action.icon}{action.label}</button>)}
            </div>
          </>}
        </div>}
        <MovementDragHandle exerciseId={exerciseId} name={exerciseName} onIntent={() => setMenuOpen(false)} />
        </div>
      </div>
      {substitutionLabel && <p className="studio-movement-detail"><ArrowLeftRight size={13} aria-hidden />{substitutionLabel}</p>}
      {swapStatus && <p className={`studio-movement-detail${swapStatus.failed ? ' is-failed' : ''}`}
        role={swapStatus.failed ? 'alert' : 'status'}>{swapStatus.text}</p>}
      {supersetLabel && <p className="studio-movement-detail"><Link2 size={13} aria-hidden />Superset {supersetLabel}</p>}
      {notePreview && <p className="studio-movement-note-preview">{notePreview}</p>}
      {/* Keep every draft mounted while the user browses other movements. The
          reveal grows open (0fr → 1fr) and closes instantly, so a movement
          closing elsewhere never shifts the one being opened mid-scroll. */}
      <div ref={revealRef} className="studio-movement-reveal" data-open={isActive ? 'true' : 'false'} inert={!isActive} aria-hidden={!isActive || undefined}>
      <div className="studio-movement-reveal-inner">
      <div id={contentId} className="studio-movement-content">
        <div className="studio-movement-prescription">
          <p>{progressLine}</p>
          {progressAction}
        </div>
        {previousTargetText && <p className="studio-last-workout">Last workout <span>{previousTargetText}</span></p>}
        {children}
        <button type="button" className="studio-collapse-movement" onClick={() => {
          onToggle();
          requestAnimationFrame(() => {
            toggleRef.current?.focus({ preventScroll: true });
            const heading = headingRef.current;
            const scroller = heading?.closest<HTMLElement>('[data-app-scroll-viewport]');
            if (!heading || !scroller) return;
            const top = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
            if (top < 56) scroller.scrollTop += top - 56;
          });
        }}>All movements <ChevronUp size={14} aria-hidden /></button>
      </div>
      </div>
      </div>
    </section>
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
      onClick={() => {
        tapHaptic();
        onClick();
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      className="metal-step-btn pressable flex items-center justify-center w-11 h-11 text-[var(--metal-ink)] disabled:opacity-30 disabled:pointer-events-none"
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
  const [editing, setEditing] = useState(false);
  return (
    <div className="studio-movement-note">
      {!editing && value.trim() && <p className="studio-note-text">{value}</p>}
      <button type="button" className="studio-note-toggle" aria-expanded={editing}
        aria-controls={`movement-note-${exerciseId}`} onClick={() => setEditing((open) => !open)}>
        {editing ? 'Hide note editor' : value.trim() ? 'Edit note' : 'Add note'}
      </button>
      <textarea hidden={!editing}
        id={`movement-note-${exerciseId}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        rows={1}
        maxLength={200}
        placeholder="Note — technique, feel, cues…"
        aria-label="Movement note"
        className="studio-note-input"
      />
      <div hidden={!editing} className="studio-note-status">
        <span>
          {saving ? 'Saving…' : saved ? 'Saved' : ''}
        </span>
        {value.length >= 160 && <span className="tabular-nums">{value.length}/200</span>}
      </div>
    </div>
  );
}

function CompletionSheet({ summary, onClose }: { summary: CompletionSummary | null; onClose: () => void }) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  const celebratedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!summary || celebratedAt.current === summary.completedAt) return;
    celebratedAt.current = summary.completedAt;
    completionHaptic();
    // Let the sheet land before the ink flies.
    const timer = window.setTimeout(() => {
      emitBurstFrom(titleRef.current, { palette: 'mixed', count: 96, power: 1.45, spread: 80, anchor: 'top' });
    }, 380);
    return () => window.clearTimeout(timer);
  }, [summary]);

  return (
    <Modal isOpen={summary !== null} onClose={onClose}>
      {summary && (
        <div className="studio-banked">
          <SessionToken
            className="h-[190px] -mt-2 mb-4"
            face={{
              title: summary.title,
              dateLabel: format(summary.completedAt, 'EEEE, MMM d'),
              completedSets: summary.completedSets,
              totalSets: summary.totalSets,
              figure: summary.tonnage > 0 ? `${Math.round(summary.tonnage).toLocaleString('en-US')} lb` : summary.duration,
            }}
          />
          <p className="metal-eyebrow">
            <motion.span
              className="metal-live-dot"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...springs.lift, delay: 0.15 }}
              aria-hidden
            />
            Session complete
          </p>
          <motion.p
            ref={titleRef}
            className="studio-banked-title"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.heavy, delay: 0.1 }}
          >
            Session banked.
          </motion.p>
          <p className="studio-banked-name">{summary.title} · {format(summary.completedAt, 'EEE, MMM d')}</p>
          <SegmentedHairline
            total={Math.max(1, summary.totalSets)}
            on={summary.completedSets}
            max={40}
            label={`${summary.completedSets} of ${summary.totalSets} sets logged`}
          />
          <dl className="studio-banked-figures">
            <div>
              <dd className="metal-num">
                <CountUp value={summary.completedSets} duration={0.8} delay={0.25} />
                <i>/{summary.totalSets}</i>
              </dd>
              <dt>sets</dt>
            </div>
            <div>
              <dd className="metal-num">
                {summary.tonnage > 0 ? <CountUp value={summary.tonnage} duration={1.3} delay={0.35} /> : '—'}
              </dd>
              <dt>lb moved</dt>
            </div>
            <div>
              <dd className="metal-num">{summary.duration}</dd>
              <dt>duration</dt>
            </div>
          </dl>
          {summary.gains.length > 0 && (
            <div className="studio-banked-gains">
              <p className="metal-eyebrow">
                Beat last workout · {summary.gains.length} {summary.gains.length === 1 ? 'set' : 'sets'}
              </p>
              <ul>
                {summary.gains.slice(0, 5).map((gain, index) => (
                  <motion.li
                    key={`${gain.name}-${gain.setNumber}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...springs.settle, delay: 0.55 + index * 0.07 }}
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {gain.name} <span className="text-[var(--metal-ink-2)]">· set {gain.setNumber}</span>
                    </span>
                    <span className="studio-banked-gain">{gain.gain}</span>
                  </motion.li>
                ))}
              </ul>
              {summary.gains.length > 5 && (
                <p className="metal-note">and {summary.gains.length - 5} more</p>
              )}
            </div>
          )}
          <Button size="lg" className="w-full mt-7" onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
