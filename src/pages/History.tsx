import { useMemo, useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Pencil, Trash2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardTitle, Modal, Button, Input } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { supabase } from '@/lib/supabase';
import { springs } from '@/lib/animations';
import type { Workout, WorkoutSet } from '@/types';
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

function SetEditor({ workoutSet, onSave, onCancel }: SetEditorProps) {
  const [weight, setWeight] = useState(workoutSet.weight?.toString() || '');
  const [reps, setReps] = useState(workoutSet.reps?.toString() || '');
  const [rpe, setRpe] = useState(workoutSet.rpe?.toString() || '');

  const handleSave = () => {
    onSave({
      weight: weight ? parseFloat(weight) : null,
      reps: reps ? parseInt(reps) : null,
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

export function History() {
  const { fetchWorkoutsByMonth, updateSet, deleteWorkout } = useAppStore();
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

  const fetchMonthWorkouts = useCallback(async (month: Date) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const workouts = await fetchWorkoutsByMonth(month);

      const splitDayIds = workouts.filter(w => w.split_day_id).map(w => w.split_day_id as string);
      const uniqueSplitDayIds = [...new Set(splitDayIds)];

      let splitDays: { id: string; day_name: string }[] = [];
      if (uniqueSplitDayIds.length > 0) {
        const { data: splitDayData } = await supabase
          .from('split_days')
          .select('id, day_name')
          .in('id', uniqueSplitDayIds);
        splitDays = splitDayData || [];
      }

      const splitDayMap = new Map(splitDays.map(sd => [sd.id, sd.day_name]));

      const workoutsWithSplit: WorkoutWithSplit[] = workouts.map(w => ({
        ...w,
        split_day: w.split_day_id ? { day_name: splitDayMap.get(w.split_day_id) || 'Unknown' } : null,
      }));

      setMonthWorkouts(workoutsWithSplit);
    } catch (error) {
      console.error('Error fetching month workouts:', error);
    }
    setLoading(false);
  }, [fetchWorkoutsByMonth]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMonthWorkouts(selectedMonth);
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchMonthWorkouts, selectedMonth]);

  const calendarDays = useMemo(() => buildCalendarDays(selectedMonth), [selectedMonth]);
  const selectedDateKey = getDateKey(selectedDate);

  const selectedDayWorkouts = useMemo(() => {
    return monthWorkouts
      .filter((w) => w.date === selectedDateKey)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [monthWorkouts, selectedDateKey]);

  const workoutsByDay = useMemo(() => {
    return monthWorkouts.reduce<Record<string, WorkoutWithSplit[]>>((acc, workout) => {
      if (!acc[workout.date]) acc[workout.date] = [];
      acc[workout.date].push(workout);
      return acc;
    }, {});
  }, [monthWorkouts]);

  const handleDeleteWorkout = async (workoutId: string) => {
    try {
      await deleteWorkout(workoutId);
      setMonthWorkouts((prev) => prev.filter((w) => w.id !== workoutId));
      setShowDeleteConfirm(null);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    } catch (error) {
      console.error('Error deleting workout:', error);
    }
  };

  const handleUpdateSet = async (workoutSet: WorkoutSet, updates: { weight: number | null; reps: number | null; rpe: number | null }) => {
    await updateSet(workoutSet.id, updates);

    setMonthWorkouts((prev) =>
      prev.map((w) => ({
        ...w,
        sets: w.sets.map((s) =>
          s.id === workoutSet.id
            ? { ...s, ...updates }
            : s
        ),
      }))
    );

    setEditingSet(null);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2000);
  };

  const groupSetsByExercise = (sets: WorkoutSet[]) => {
    return sets.reduce<Record<string, WorkoutSet[]>>((acc, set) => {
      if (!acc[set.exercise_id]) {
        acc[set.exercise_id] = [];
      }
      acc[set.exercise_id].push(set);
      return acc;
    }, {});
  };

  return (
    <motion.div
      className="pb-24 px-5 pt-8"
    >
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

      {/* Calendar */}
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
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
              <div key={`${day}-${i}`} className="text-center text-[10px] text-[#6B6B6B] py-1">
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

      {/* Selected Day Workouts */}
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
              const exerciseGroups = groupSetsByExercise(workout.sets);
              const completedSets = workout.sets.filter((s) => s.completed).length;
              const totalSets = workout.sets.length;

              return (
                <motion.div
                  key={workout.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: workoutIndex * 0.06, ...springs.smooth }}
                >
                  <Card variant="slab" className="overflow-hidden">
                    {/* Workout Header */}
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => setExpandedWorkout(isExpanded ? null : workout.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-[14px] bg-[#2E2E2E] flex items-center justify-center">
                          {workout.completed ? (
                            <Check className="w-4 h-4 text-[#8B9A7D]" />
                          ) : (
                            <span className="text-[10px] text-[#6B6B6B]">{Math.round((completedSets / totalSets) * 100)}%</span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm text-[#E8E4DE]">
                            {workout.split_day?.day_name || 'Workout'}
                          </p>
                          <p className="text-[10px] text-[#6B6B6B]">
                            {completedSets}/{totalSets} sets
                          </p>
                        </div>
                      </div>
                      <motion.div
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={springs.snappy}
                      >
                        <ChevronDown className="w-4 h-4 text-[#6B6B6B]" />
                      </motion.div>
                    </div>

                    {/* Expanded Content */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          className="mt-4 pt-4 border-t border-white/5"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={springs.smooth}
                        >
                          {Object.entries(exerciseGroups).map(([exerciseId, sets], exIndex) => {
                            const exerciseName = (sets[0].exercise as { name?: string })?.name || 'Unknown Exercise';
                            const isExerciseExpanded = expandedExercise === exerciseId;

                            return (
                              <motion.div
                                key={exerciseId}
                                className="mb-3"
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: exIndex * 0.04, ...springs.smooth }}
                              >
                                <div
                                  className="flex items-center justify-between py-2 cursor-pointer hover:bg-white/5 active:bg-white/10 rounded-[12px] px-2 -mx-2"
                                  onClick={() => setExpandedExercise(isExerciseExpanded ? null : exerciseId)}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-[#E8E4DE]">{exerciseName}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-[#6B6B6B]">
                                      {sets.length} x {sets[0].reps || '-'}
                                    </span>
                                    <motion.div
                                      animate={{ rotate: isExerciseExpanded ? 180 : 0 }}
                                      transition={springs.snappy}
                                    >
                                      <ChevronDown className="w-3 h-3 text-[#6B6B6B]" />
                                    </motion.div>
                                  </div>
                                </div>

                                {/* Individual Sets */}
                                <AnimatePresence>
                                  {isExerciseExpanded && (
                                    <motion.div
                                      className="ml-4 mt-2 space-y-1"
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={springs.smooth}
                                    >
                                      {sets.map((set, idx) => (
                                        <motion.div
                                          key={set.id}
                                          className="flex items-center justify-between py-2 px-3 bg-[#1A1A1A] rounded-[12px]"
                                          initial={{ opacity: 0, y: 4 }}
                                          animate={{ opacity: 1, y: 0 }}
                                          transition={{ delay: idx * 0.03, ...springs.smooth }}
                                        >
                                          <div className="flex items-center gap-3">
                                            <span className="text-[10px] text-[#6B6B6B]">Set {idx + 1}</span>
                                            <span className="text-xs text-[#9A9A9A] tabular-nums">
                                              {set.weight || '-'} lbs x {set.reps || '-'}
                                              {set.rpe && ` @ ${set.rpe}`}
                                            </span>
                                          </div>
                                          <motion.button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingSet(set);
                                            }}
                                            className="p-1.5 rounded-[8px] hover:bg-white/10 transition-colors"
                                            whileTap={{ scale: 0.9 }}
                                          >
                                            <Pencil className="w-3 h-3 text-[#6B6B6B]" />
                                          </motion.button>
                                        </motion.div>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            );
                          })}

                          {/* Delete Button */}
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

      {/* Edit Set Modal */}
      <Modal
        isOpen={!!editingSet}
        onClose={() => setEditingSet(null)}
        title="Edit Set"
      >
        {editingSet && (
          <SetEditor
            workoutSet={editingSet}
            onSave={(updates) => handleUpdateSet(editingSet, updates)}
            onCancel={() => setEditingSet(null)}
          />
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title="Delete Session"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#9A9A9A] text-center">
            Are you sure you want to delete this session? This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setShowDeleteConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              className="flex-1 bg-[#8B6B6B] hover:bg-[#9B7B7B]"
              onClick={() => showDeleteConfirm && handleDeleteWorkout(showDeleteConfirm)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
