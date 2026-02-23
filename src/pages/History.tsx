import { useMemo, useEffect, useState, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pencil, Trash2, Check, Plus, Link2, Unlink2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardTitle, Modal, Button, Input } from '@/components/shared';
import { ExercisePicker } from '@/components/split/ExercisePicker';
import { useAppStore } from '@/stores/appStore';
import { supabase } from '@/lib/supabase';
import { parseWorkoutNotes, serializeWorkoutNotes } from '@/lib/workoutNotes';
import { springs } from '@/lib/animations';
import type { Exercise, FlexiblePlanItem, Workout, WorkoutDayPlan, WorkoutSet } from '@/types';
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';

interface WorkoutWithSplit extends Workout {
  split_day?: {
    day_name: string;
  } | null;
}

interface SetEditorProps {
  workoutSet: WorkoutSet;
  onSave: (updates: { weight: number | null; reps: number | null; rpe: number | null }) => void;
  onCancel: () => void;
}

interface PickerState {
  workoutId: string;
  baseExerciseId: string | null;
  excludeExerciseIds: string[];
}

function SetEditor({ workoutSet, onSave, onCancel }: SetEditorProps) {
  const [weight, setWeight] = useState(workoutSet.weight?.toString() || '');
  const [reps, setReps] = useState(workoutSet.reps?.toString() || '');
  const [rpe, setRpe] = useState(workoutSet.rpe?.toString() || '');

  const handleSave = () => {
    onSave({
      weight: weight ? parseFloat(weight) : null,
      reps: reps ? parseInt(reps, 10) : null,
      rpe: rpe ? parseFloat(rpe) : null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <p className="text-xs text-[#6B6B6B]">Editing Set {workoutSet.set_number}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Input
          label="Weight (lbs)"
          type="number"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="-"
        />
        <Input
          label="Reps"
          type="number"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="-"
        />
        <Input
          label="RPE"
          type="number"
          value={rpe}
          onChange={(e) => setRpe(e.target.value)}
          placeholder="-"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

function getDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function buildCalendarDays(baseDate: Date): Date[] {
  const monthStart = startOfMonth(baseDate);
  const monthEnd = endOfMonth(baseDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const days: Date[] = [];
  let day = startDate;
  while (day <= endDate) {
    days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

function groupSetsByExercise(sets: WorkoutSet[]) {
  const grouped = sets.reduce<Record<string, WorkoutSet[]>>((acc, set) => {
    if (!acc[set.exercise_id]) {
      acc[set.exercise_id] = [];
    }
    acc[set.exercise_id].push(set);
    return acc;
  }, {});

  Object.keys(grouped).forEach((exerciseId) => {
    grouped[exerciseId] = grouped[exerciseId].slice().sort((a, b) => a.set_number - b.set_number);
  });

  return grouped;
}

function progressFromSets(sets: WorkoutSet[]) {
  const totalSets = sets.length;
  const completedSets = sets.filter((set) => set.completed).length;
  const percent = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
  const completed = totalSets > 0 && completedSets === totalSets;
  return { totalSets, completedSets, percent, completed };
}

export function History() {
  const {
    fetchWorkoutsByMonth,
    fetchWorkoutById,
    deleteWorkout,
    updateSet,
    addSetToWorkout,
    removeSetFromWorkout,
    addExerciseToWorkout,
    removeExerciseFromWorkout,
    syncWorkoutCompletion,
    updateWorkoutNotes,
    fetchWorkoutDayPlanByWorkoutId,
    addSupersetToWorkout,
    clearWorkoutSuperset,
    updateWorkoutExerciseTargetSets,
    reorderWorkoutExercises,
  } = useAppStore();

  const [monthWorkouts, setMonthWorkouts] = useState<WorkoutWithSplit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<Date>(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [expandedWorkout, setExpandedWorkout] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);
  const [editingSet, setEditingSet] = useState<WorkoutSet | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [monthDirection, setMonthDirection] = useState(0);
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [workoutPlans, setWorkoutPlans] = useState<Record<string, WorkoutDayPlan | null>>({});
  const [movementNotesByWorkout, setMovementNotesByWorkout] = useState<Record<string, Record<string, string>>>({});
  const [legacyNotesByWorkout, setLegacyNotesByWorkout] = useState<Record<string, string | null>>({});
  const [savingMovementNoteKey, setSavingMovementNoteKey] = useState<string | null>(null);
  const [savedMovementNoteKey, setSavedMovementNoteKey] = useState<string | null>(null);
  const [targetSetDrafts, setTargetSetDrafts] = useState<Record<string, string>>({});

  const noteSaveTimersRef = useRef<Record<string, number>>({});
  const movementNotesRef = useRef<Record<string, Record<string, string>>>({});
  const legacyNotesRef = useRef<Record<string, string | null>>({});

  useEffect(() => {
    movementNotesRef.current = movementNotesByWorkout;
  }, [movementNotesByWorkout]);

  useEffect(() => {
    legacyNotesRef.current = legacyNotesByWorkout;
  }, [legacyNotesByWorkout]);

  useEffect(() => {
    const timersRef = noteSaveTimersRef;
    return () => {
      Object.values(timersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  const showSavedToast = useCallback(() => {
    setShowSuccess(true);
    window.setTimeout(() => setShowSuccess(false), 1500);
  }, []);

  const fetchMonthWorkouts = useCallback(async (month: Date) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const workouts = await fetchWorkoutsByMonth(month);
      const splitDayIds = workouts.filter((workout) => workout.split_day_id).map((workout) => workout.split_day_id as string);
      const uniqueSplitDayIds = [...new Set(splitDayIds)];

      let splitDays: { id: string; day_name: string }[] = [];
      if (uniqueSplitDayIds.length > 0) {
        const { data: splitDayData } = await supabase
          .from('split_days')
          .select('id, day_name')
          .in('id', uniqueSplitDayIds);
        splitDays = splitDayData || [];
      }

      const splitDayMap = new Map(splitDays.map((splitDay) => [splitDay.id, splitDay.day_name]));
      const workoutsWithSplit: WorkoutWithSplit[] = workouts.map((workout) => ({
        ...workout,
        split_day: workout.split_day_id ? { day_name: splitDayMap.get(workout.split_day_id) || 'Unknown' } : null,
      }));

      setMonthWorkouts(workoutsWithSplit);

      const notesByWorkout: Record<string, Record<string, string>> = {};
      const legacyByWorkout: Record<string, string | null> = {};
      workoutsWithSplit.forEach((workout) => {
        const parsed = parseWorkoutNotes(workout.notes || null);
        notesByWorkout[workout.id] = parsed.movementNotes;
        legacyByWorkout[workout.id] = parsed.legacyNote;
      });

      setMovementNotesByWorkout(notesByWorkout);
      setLegacyNotesByWorkout(legacyByWorkout);
    } catch (error) {
      console.error('Error fetching month workouts:', error);
    }

    setLoading(false);
  }, [fetchWorkoutsByMonth]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchMonthWorkouts(selectedMonth);
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchMonthWorkouts, selectedMonth]);

  const selectedDateKey = getDateKey(selectedDate);
  const calendarDays = useMemo(() => buildCalendarDays(selectedMonth), [selectedMonth]);

  const selectedDayWorkouts = useMemo(() => {
    return monthWorkouts
      .filter((workout) => workout.date === selectedDateKey)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [monthWorkouts, selectedDateKey]);

  const workoutsByDay = useMemo(() => {
    return monthWorkouts.reduce<Record<string, WorkoutWithSplit[]>>((acc, workout) => {
      if (!acc[workout.date]) acc[workout.date] = [];
      acc[workout.date].push(workout);
      return acc;
    }, {});
  }, [monthWorkouts]);

  const refreshWorkout = useCallback(async (workoutId: string) => {
    await syncWorkoutCompletion(workoutId);

    const [workout, plan] = await Promise.all([
      fetchWorkoutById(workoutId),
      fetchWorkoutDayPlanByWorkoutId(workoutId),
    ]);

    if (!workout) return;

    setMonthWorkouts((prev) => prev.map((item) => {
      if (item.id !== workoutId) return item;
      return {
        ...(workout as WorkoutWithSplit),
        split_day: item.split_day,
      };
    }));

    setWorkoutPlans((prev) => ({ ...prev, [workoutId]: plan || null }));

    const parsed = parseWorkoutNotes(workout.notes || null);
    setMovementNotesByWorkout((prev) => ({ ...prev, [workoutId]: parsed.movementNotes }));
    setLegacyNotesByWorkout((prev) => ({ ...prev, [workoutId]: parsed.legacyNote }));
  }, [fetchWorkoutById, fetchWorkoutDayPlanByWorkoutId, syncWorkoutCompletion]);

  const runMutation = useCallback(async (workoutId: string, mutate: () => Promise<void>) => {
    await mutate();
    await refreshWorkout(workoutId);
    showSavedToast();
  }, [refreshWorkout, showSavedToast]);

  const loadPlanIfExists = useCallback(async (workoutId: string) => {
    if (Object.prototype.hasOwnProperty.call(workoutPlans, workoutId)) return;
    const plan = await fetchWorkoutDayPlanByWorkoutId(workoutId);
    setWorkoutPlans((prev) => ({ ...prev, [workoutId]: plan || null }));
  }, [fetchWorkoutDayPlanByWorkoutId, workoutPlans]);

  const persistMovementNotes = useCallback(async (workoutId: string, exerciseId: string) => {
    const movementNotes = movementNotesRef.current[workoutId] || {};
    const legacyNote = legacyNotesRef.current[workoutId] || null;
    const serialized = serializeWorkoutNotes(movementNotes, legacyNote);

    setSavingMovementNoteKey(`${workoutId}:${exerciseId}`);
    await updateWorkoutNotes(workoutId, serialized);

    setMonthWorkouts((prev) => prev.map((workout) => (
      workout.id === workoutId ? { ...workout, notes: serialized } : workout
    )));

    setSavingMovementNoteKey(null);
    setSavedMovementNoteKey(`${workoutId}:${exerciseId}`);
    window.setTimeout(() => {
      setSavedMovementNoteKey((current) => (current === `${workoutId}:${exerciseId}` ? null : current));
    }, 1200);
  }, [updateWorkoutNotes]);

  const queueMovementNotePersist = useCallback((workoutId: string, exerciseId: string) => {
    const timerKey = `${workoutId}:${exerciseId}`;
    const existingTimer = noteSaveTimersRef.current[timerKey];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    noteSaveTimersRef.current[timerKey] = window.setTimeout(() => {
      delete noteSaveTimersRef.current[timerKey];
      void persistMovementNotes(workoutId, exerciseId);
    }, 1000);
  }, [persistMovementNotes]);

  const handleMovementNoteChange = useCallback((workoutId: string, exerciseId: string, value: string) => {
    const bounded = value.slice(0, 200);

    setMovementNotesByWorkout((prev) => {
      const currentWorkoutNotes = { ...(prev[workoutId] || {}) };

      if (bounded.trim()) {
        currentWorkoutNotes[exerciseId] = bounded;
      } else {
        delete currentWorkoutNotes[exerciseId];
      }

      return {
        ...prev,
        [workoutId]: currentWorkoutNotes,
      };
    });

    queueMovementNotePersist(workoutId, exerciseId);
  }, [queueMovementNotePersist]);

  const handleMovementNoteBlur = useCallback((workoutId: string, exerciseId: string) => {
    const timerKey = `${workoutId}:${exerciseId}`;
    const timerId = noteSaveTimersRef.current[timerKey];
    if (timerId) {
      window.clearTimeout(timerId);
      delete noteSaveTimersRef.current[timerKey];
    }

    void persistMovementNotes(workoutId, exerciseId);
  }, [persistMovementNotes]);

  const handleDeleteWorkout = async (workoutId: string) => {
    try {
      await deleteWorkout(workoutId);
      setMonthWorkouts((prev) => prev.filter((workout) => workout.id !== workoutId));
      setWorkoutPlans((prev) => {
        const next = { ...prev };
        delete next[workoutId];
        return next;
      });
      setShowDeleteConfirm(null);
      showSavedToast();
    } catch (error) {
      console.error('Error deleting workout:', error);
    }
  };

  const handleUpdateSet = async (workoutSet: WorkoutSet, updates: { weight: number | null; reps: number | null; rpe: number | null }) => {
    const completed = updates.weight !== null && updates.reps !== null;

    await runMutation(workoutSet.workout_id, async () => {
      await updateSet(workoutSet.id, {
        weight: updates.weight,
        reps: updates.reps,
        rpe: updates.rpe,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      });
    });

    setEditingSet(null);
  };

  const handleAddSet = async (workoutId: string, exerciseId: string) => {
    await runMutation(workoutId, async () => {
      await addSetToWorkout(workoutId, exerciseId);
    });
  };

  const handleRemoveSet = async (workoutId: string, exerciseId: string, setId: string) => {
    await runMutation(workoutId, async () => {
      await removeSetFromWorkout(workoutId, exerciseId, setId);
    });
  };

  const handleRemoveExercise = async (workoutId: string, exerciseId: string) => {
    await runMutation(workoutId, async () => {
      await removeExerciseFromWorkout(workoutId, exerciseId);

      setMovementNotesByWorkout((prev) => {
        const current = { ...(prev[workoutId] || {}) };
        delete current[exerciseId];
        return {
          ...prev,
          [workoutId]: current,
        };
      });

      const timerKey = `${workoutId}:${exerciseId}`;
      const timerId = noteSaveTimersRef.current[timerKey];
      if (timerId) {
        window.clearTimeout(timerId);
        delete noteSaveTimersRef.current[timerKey];
      }
    });
  };

  const handleTargetSetBlur = async (workoutId: string, exerciseId: string, fallbackValue: number) => {
    const draftKey = `${workoutId}:${exerciseId}`;
    const draftValue = targetSetDrafts[draftKey];

    if (typeof draftValue !== 'string') return;

    const parsed = Number.parseInt(draftValue, 10);
    if (!Number.isFinite(parsed)) {
      setTargetSetDrafts((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      return;
    }

    const bounded = Math.max(1, Math.min(12, parsed));
    if (bounded !== fallbackValue) {
      await runMutation(workoutId, async () => {
        await updateWorkoutExerciseTargetSets(workoutId, exerciseId, bounded);
      });
    }

    setTargetSetDrafts((prev) => {
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
  };

  const handleToggleWorkout = async (workout: WorkoutWithSplit) => {
    const next = expandedWorkout === workout.id ? null : workout.id;
    setExpandedWorkout(next);
    if (next) {
      await loadPlanIfExists(workout.id);
    }
  };

  return (
    <motion.div className="pb-24 px-5 pt-8">
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            className="fixed safe-area-top-offset left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-[#8B9A7D] text-[#1A1A1A] rounded-[20px] text-xs tracking-wider shadow-lg"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={springs.smooth}
          >
            <Check className="w-4 h-4" />
            Saved
          </motion.div>
        )}
      </AnimatePresence>

      <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">Training</p>
        <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">History</h1>
      </motion.header>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <motion.button
              onClick={() => {
                setMonthDirection(-1);
                setSelectedMonth((prev) => subMonths(prev, 1));
              }}
              className="p-2 rounded-[12px] hover:bg-white/5 active:bg-white/10 transition-colors"
              whileTap={{ scale: 0.9, x: -2 }}
            >
              <ChevronLeft className="w-4 h-4 text-[#9A9A9A]" />
            </motion.button>
            <AnimatePresence mode="wait">
              <motion.h3
                key={format(selectedMonth, 'yyyy-MM')}
                className="text-xs tracking-[0.15em] uppercase text-[#E8E4DE]"
                initial={{ opacity: 0, x: monthDirection * 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: monthDirection * -20 }}
                transition={{ duration: 0.2 }}
              >
                {format(selectedMonth, 'MMMM yyyy')}
              </motion.h3>
            </AnimatePresence>
            <motion.button
              onClick={() => {
                setMonthDirection(1);
                setSelectedMonth((prev) => addMonths(prev, 1));
              }}
              className="p-2 rounded-[12px] hover:bg-white/5 active:bg-white/10 transition-colors"
              whileTap={{ scale: 0.9, x: 2 }}
            >
              <ChevronRight className="w-4 h-4 text-[#9A9A9A]" />
            </motion.button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <div key={`${day}-${index}`} className="text-center text-[10px] text-[#6B6B6B] py-1">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const key = getDateKey(day);
              const dayWorkouts = workoutsByDay[key] || [];
              const isSelected = isSameDay(day, selectedDate);
              const inMonth = isSameMonth(day, selectedMonth);
              const isTodayDate = isToday(day);

              return (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedDate(day);
                    if (!isSameMonth(day, selectedMonth)) {
                      setSelectedMonth(startOfMonth(day));
                    }
                  }}
                  className={`h-10 rounded-[12px] text-xs tabular-nums transition-all relative ${
                    isSelected
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : inMonth
                        ? 'text-[#E8E4DE] hover:bg-white/5 active:bg-white/10'
                        : 'text-[#5A5A5A] hover:bg-white/5 active:bg-white/10'
                  } ${isTodayDate && !isSelected ? 'ring-1 ring-[#C4A484]/30' : ''}`}
                >
                  {isSelected && (
                    <motion.div
                      className="absolute inset-0 bg-[#E8E4DE] rounded-[12px]"
                      layoutId="history-day-selected"
                      transition={springs.smooth}
                    />
                  )}
                  <span className="relative z-10">{format(day, 'd')}</span>
                  {dayWorkouts.length > 0 && (
                    <motion.span
                      className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full z-10 ${
                        isSelected ? 'bg-[#1A1A1A]' : 'bg-[#8B9A7D]'
                      }`}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={springs.bouncy}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      </motion.div>

      {loading ? (
        <div className="text-center py-8 text-[#6B6B6B] text-xs tracking-wider">Loading...</div>
      ) : (
        <motion.div className="space-y-3" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <CardTitle>{format(selectedDate, 'EEEE')}</CardTitle>
              <p className="text-[10px] text-[#6B6B6B] mt-1">
                {selectedDayWorkouts.length} session{selectedDayWorkouts.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {selectedDayWorkouts.length === 0 ? (
            <Card variant="slab" className="text-center py-12">
              <p className="text-editorial">No sessions recorded.</p>
            </Card>
          ) : (
            selectedDayWorkouts.map((workout, workoutIndex) => {
              const isExpanded = expandedWorkout === workout.id;
              const groupedSets = groupSetsByExercise(workout.sets);
              const plan = workoutPlans[workout.id] || null;
              const progress = progressFromSets(workout.sets);

              const plannedVisible = plan
                ? plan.items.filter((item) => !item.hidden).sort((a, b) => a.order - b.order)
                : [];

              const plannedIds = plannedVisible.map((item) => item.exercise_id);
              const groupedIds = Object.keys(groupedSets);
              const orderedExerciseIds = [
                ...plannedIds.filter((exerciseId) => groupedIds.includes(exerciseId)),
                ...groupedIds.filter((exerciseId) => !plannedIds.includes(exerciseId)),
              ];

              const planByExercise = new Map<string, FlexiblePlanItem>(
                plannedVisible.map((item) => [item.exercise_id, item])
              );

              const supersetByExercise = new Map<string, string>();
              plannedVisible.forEach((item) => {
                if (item.superset_group_id) {
                  supersetByExercise.set(item.exercise_id, item.superset_group_id);
                }
              });

              const supersetPartnerByExercise = new Map<string, string>();
              const groupedBySuperset = new Map<string, string[]>();
              plannedVisible.forEach((item) => {
                if (!item.superset_group_id) return;
                const current = groupedBySuperset.get(item.superset_group_id) || [];
                current.push(item.exercise_id);
                groupedBySuperset.set(item.superset_group_id, current);
              });

              groupedBySuperset.forEach((exerciseIds) => {
                if (exerciseIds.length !== 2) return;
                supersetPartnerByExercise.set(exerciseIds[0], exerciseIds[1]);
                supersetPartnerByExercise.set(exerciseIds[1], exerciseIds[0]);
              });

              return (
                <motion.div
                  key={workout.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: workoutIndex * 0.06, ...springs.smooth }}
                >
                  <Card variant="slab" className="overflow-hidden">
                    <div className="flex items-center justify-between cursor-pointer" onClick={() => { void handleToggleWorkout(workout); }}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-[14px] bg-[#2E2E2E] flex items-center justify-center">
                          {progress.completed ? (
                            <Check className="w-4 h-4 text-[#8B9A7D]" />
                          ) : (
                            <span className="text-[10px] text-[#6B6B6B]">{progress.percent}%</span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm text-[#E8E4DE]">{workout.split_day?.day_name || plan?.day_label || 'Workout'}</p>
                          <p className="text-[10px] text-[#6B6B6B]">{progress.completedSets}/{progress.totalSets} sets</p>
                        </div>
                      </div>
                      <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={springs.snappy}>
                        <ChevronDown className="w-4 h-4 text-[#6B6B6B]" />
                      </motion.div>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          className="mt-4 pt-4 border-t border-white/5"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={springs.smooth}
                        >
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <p className="text-[10px] text-[#6B6B6B] tracking-[0.1em] uppercase">Exercises</p>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setPickerState({
                                  workoutId: workout.id,
                                  baseExerciseId: null,
                                  excludeExerciseIds: orderedExerciseIds,
                                });
                              }}
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              Add Exercise
                            </Button>
                          </div>

                          {orderedExerciseIds.map((exerciseId, exIndex) => {
                            const sets = groupedSets[exerciseId] || [];
                            const firstSet = sets[0];
                            const exerciseName = planByExercise.get(exerciseId)?.exercise_name
                              || (firstSet?.exercise as { name?: string } | undefined)?.name
                              || 'Unknown Exercise';

                            const expandedExerciseKey = `${workout.id}:${exerciseId}`;
                            const isExerciseExpanded = expandedExercise === expandedExerciseKey;
                            const exerciseProgress = progressFromSets(sets);
                            const planItem = planByExercise.get(exerciseId);
                            const currentTargetSets = Math.max(1, Math.min(12, planItem?.target_sets || sets.length || 1));
                            const targetDraftKey = `${workout.id}:${exerciseId}`;
                            const targetDraft = targetSetDrafts[targetDraftKey];
                            const targetInputValue = typeof targetDraft === 'string' ? targetDraft : String(currentTargetSets);
                            const movementNote = movementNotesByWorkout[workout.id]?.[exerciseId] || planItem?.notes || '';
                            const noteCharacterCount = movementNote.length;
                            const hasMovementNote = movementNote.trim().length > 0;
                            const supersetGroupId = supersetByExercise.get(exerciseId) || null;
                            const supersetPartnerId = supersetPartnerByExercise.get(exerciseId) || null;
                            const supersetPartnerName = supersetPartnerId
                              ? (
                                  planByExercise.get(supersetPartnerId)?.exercise_name
                                  || (groupedSets[supersetPartnerId]?.[0]?.exercise as { name?: string } | undefined)?.name
                                  || 'Exercise'
                                )
                              : null;
                            const canMoveUp = exIndex > 0;
                            const canMoveDown = exIndex < orderedExerciseIds.length - 1;

                            return (
                              <motion.div
                                key={exerciseId}
                                className="mb-3"
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: exIndex * 0.04, ...springs.smooth }}
                              >
                                <div
                                  className="flex items-center justify-between py-2 rounded-[12px] px-2 -mx-2 cursor-pointer hover:bg-white/5 active:bg-white/10"
                                  onClick={() => setExpandedExercise(isExerciseExpanded ? null : expandedExerciseKey)}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-[10px] bg-[#2A2A2A] flex items-center justify-center text-[10px] text-[#9A9A9A]">
                                      {exerciseProgress.completed ? <Check className="w-3.5 h-3.5 text-[#8B9A7D]" /> : `${exerciseProgress.completedSets}/${exerciseProgress.totalSets}`}
                                    </div>
                                    <div>
                                      <span className="text-xs text-[#E8E4DE]">{exerciseName}</span>
                                      {supersetGroupId && supersetPartnerName && (
                                        <p className="text-[10px] text-[#A8B89A] mt-0.5">Superset with {supersetPartnerName}</p>
                                      )}
                                      {hasMovementNote && !isExerciseExpanded && (
                                        <p className="text-[10px] text-[#6B6B6B] mt-0.5 truncate max-w-[220px]">{movementNote}</p>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                                    <button
                                      type="button"
                                      disabled={!canMoveUp}
                                      onClick={() => {
                                        const nextOrder = [...orderedExerciseIds];
                                        const currentIndex = nextOrder.indexOf(exerciseId);
                                        if (currentIndex <= 0) return;
                                        [nextOrder[currentIndex - 1], nextOrder[currentIndex]] = [nextOrder[currentIndex], nextOrder[currentIndex - 1]];
                                        void runMutation(workout.id, async () => {
                                          await reorderWorkoutExercises(workout.id, nextOrder);
                                        });
                                      }}
                                      className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                                    >
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!canMoveDown}
                                      onClick={() => {
                                        const nextOrder = [...orderedExerciseIds];
                                        const currentIndex = nextOrder.indexOf(exerciseId);
                                        if (currentIndex < 0 || currentIndex >= nextOrder.length - 1) return;
                                        [nextOrder[currentIndex], nextOrder[currentIndex + 1]] = [nextOrder[currentIndex + 1], nextOrder[currentIndex]];
                                        void runMutation(workout.id, async () => {
                                          await reorderWorkoutExercises(workout.id, nextOrder);
                                        });
                                      }}
                                      className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                                    >
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    </button>
                                    {supersetGroupId ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void runMutation(workout.id, async () => {
                                            await clearWorkoutSuperset(workout.id, exerciseId);
                                          });
                                        }}
                                        className="p-1.5 rounded-[8px] text-[#8B9A7D] hover:text-[#BFD0AF] hover:bg-white/5 transition-colors"
                                        title="Remove superset"
                                      >
                                        <Unlink2 className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setPickerState({
                                            workoutId: workout.id,
                                            baseExerciseId: exerciseId,
                                            excludeExerciseIds: orderedExerciseIds,
                                          });
                                        }}
                                        className="p-1.5 rounded-[8px] text-[#6B6B6B] hover:text-[#E8E4DE] hover:bg-white/5 transition-colors"
                                        title="Add superset"
                                      >
                                        <Link2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => { void handleRemoveExercise(workout.id, exerciseId); }}
                                      className="p-1.5 rounded-[8px] text-[#8B6B6B] hover:text-[#D39B9B] hover:bg-white/5 transition-colors"
                                      title="Remove exercise"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    <motion.div animate={{ rotate: isExerciseExpanded ? 180 : 0 }} transition={springs.snappy}>
                                      <ChevronDown className="w-3 h-3 text-[#6B6B6B]" />
                                    </motion.div>
                                  </div>
                                </div>

                                <AnimatePresence>
                                  {isExerciseExpanded && (
                                    <motion.div
                                      className="ml-4 mt-2 space-y-2"
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={springs.smooth}
                                    >
                                      <div className="flex items-center justify-between gap-2 rounded-[12px] bg-[#1E1E1E] border border-white/5 p-2.5">
                                        <div>
                                          <p className="text-[10px] text-[#6B6B6B] tracking-[0.08em] uppercase">Target Sets</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="number"
                                            min={1}
                                            max={12}
                                            value={targetInputValue}
                                            onChange={(event) => {
                                              setTargetSetDrafts((prev) => ({
                                                ...prev,
                                                [targetDraftKey]: event.target.value,
                                              }));
                                            }}
                                            onBlur={() => { void handleTargetSetBlur(workout.id, exerciseId, currentTargetSets); }}
                                            className="w-16 px-2 py-1 rounded-[8px] bg-[#121212] border border-white/10 text-xs text-[#E8E4DE]"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => { void handleAddSet(workout.id, exerciseId); }}
                                            className="px-2 py-1 rounded-[8px] text-[10px] border border-white/10 text-[#6B6B6B] hover:text-[#E8E4DE] hover:border-white/20 transition-colors"
                                          >
                                            + Add Set
                                          </button>
                                        </div>
                                      </div>

                                      {sets.map((set) => (
                                        <motion.div
                                          key={set.id}
                                          className="flex items-center justify-between py-2 px-3 bg-[#1A1A1A] rounded-[12px]"
                                          initial={{ opacity: 0, y: 4 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          transition={springs.smooth}
                                        >
                                          <div className="flex items-center gap-3">
                                            <span className="text-[10px] text-[#6B6B6B]">Set {set.set_number}</span>
                                            <span className="text-xs text-[#9A9A9A] tabular-nums">
                                              {set.weight || '-'} lbs x {set.reps || '-'}
                                              {set.rpe ? ` @ ${set.rpe}` : ''}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <motion.button
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                setEditingSet(set);
                                              }}
                                              className="p-1.5 rounded-[8px] hover:bg-white/10 transition-colors"
                                              whileTap={{ scale: 0.9 }}
                                            >
                                              <Pencil className="w-3 h-3 text-[#6B6B6B]" />
                                            </motion.button>
                                            <motion.button
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                void handleRemoveSet(workout.id, exerciseId, set.id);
                                              }}
                                              className="p-1.5 rounded-[8px] hover:bg-white/10 transition-colors"
                                              whileTap={{ scale: 0.9 }}
                                            >
                                              <X className="w-3 h-3 text-[#8B6B6B]" />
                                            </motion.button>
                                          </div>
                                        </motion.div>
                                      ))}

                                      <div className="mt-2 rounded-[12px] bg-[#171717] border border-white/5 p-3">
                                        <label
                                          htmlFor={`history-note-${workout.id}-${exerciseId}`}
                                          className="block text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B] mb-2"
                                        >
                                          Movement Note
                                        </label>
                                        <textarea
                                          id={`history-note-${workout.id}-${exerciseId}`}
                                          value={movementNote}
                                          onChange={(event) => handleMovementNoteChange(workout.id, exerciseId, event.target.value)}
                                          onBlur={() => handleMovementNoteBlur(workout.id, exerciseId)}
                                          rows={2}
                                          maxLength={200}
                                          placeholder="Note - technique, feel, cues..."
                                          className="w-full bg-transparent border-b border-white/10 pb-2 text-sm text-[#E8E4DE] placeholder:text-[#6B6B6B] focus:outline-none focus:border-white/30 resize-none"
                                        />
                                        <div className="mt-1.5 flex items-center justify-between">
                                          <div>
                                            {savingMovementNoteKey === `${workout.id}:${exerciseId}` ? (
                                              <p className="text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B]">Saving...</p>
                                            ) : savedMovementNoteKey === `${workout.id}:${exerciseId}` ? (
                                              <p className="text-[10px] tracking-[0.1em] uppercase text-[#8B9A7D]">Saved</p>
                                            ) : null}
                                          </div>
                                          {noteCharacterCount >= 160 && (
                                            <p className="text-[10px] tabular-nums text-[#6B6B6B]">{noteCharacterCount}/200</p>
                                          )}
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            );
                          })}

                          <motion.button
                            onClick={() => setShowDeleteConfirm(workout.id)}
                            className="w-full mt-4 py-3 rounded-[16px] border border-[#8B6B6B]/30 text-[#8B6B6B] text-[10px] tracking-[0.1em] uppercase hover:bg-[#8B6B6B]/10 transition-colors flex items-center justify-center gap-2"
                            whileTap={{ scale: 0.98 }}
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete Session
                          </motion.button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                </motion.div>
              );
            })
          )}
        </motion.div>
      )}

      <Modal isOpen={!!editingSet} onClose={() => setEditingSet(null)} title="Edit Set">
        {editingSet && (
          <SetEditor
            workoutSet={editingSet}
            onSave={(updates) => { void handleUpdateSet(editingSet, updates); }}
            onCancel={() => setEditingSet(null)}
          />
        )}
      </Modal>

      <Modal isOpen={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} title="Delete Session">
        <div className="space-y-4">
          <p className="text-sm text-[#9A9A9A] text-center">
            Are you sure you want to delete this session? This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setShowDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1 bg-[#8B6B6B] hover:bg-[#9B7B7B]"
              onClick={() => showDeleteConfirm && void handleDeleteWorkout(showDeleteConfirm)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <ExercisePicker
        isOpen={Boolean(pickerState)}
        onClose={() => setPickerState(null)}
        onSelect={(exercise: Exercise) => {
          if (!pickerState) return;
          const { workoutId, baseExerciseId } = pickerState;
          setPickerState(null);

          if (baseExerciseId) {
            void runMutation(workoutId, async () => {
              await addSupersetToWorkout(workoutId, baseExerciseId, exercise);
            });
            return;
          }

          void runMutation(workoutId, async () => {
            await addExerciseToWorkout(workoutId, exercise);
          });
        }}
        excludeExerciseIds={pickerState?.excludeExerciseIds || []}
        title={pickerState?.baseExerciseId ? 'Add Superset Exercise' : 'Add Exercise'}
      />
    </motion.div>
  );
}
