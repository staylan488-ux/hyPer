import { useState, useEffect } from 'react';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { addDays, format, isBefore, isSameDay, parseISO, startOfWeek } from 'date-fns';
import { Card, Button, Modal } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { SetLogger } from '@/components/workout/SetLogger';
import { RestTimer } from '@/components/workout/RestTimer';
import { springs } from '@/lib/animations';
import { supabase } from '@/lib/supabase';
import { buildFixedWeekdays, defaultStartDate, defaultWeekdays, loadPlanSchedule, plannedDayForDate, savePlanSchedule, type PlanMode, type PlanSchedule } from '@/lib/planSchedule';
import type { SplitDay, Workout, WorkoutSet } from '@/types';

export function Workout() {
  const { activeSplit, currentWorkout, startWorkout, fetchCurrentWorkout, fetchSplits, completeWorkout } = useAppStore();
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [planSchedule, setPlanSchedule] = useState<PlanSchedule | null>(null);
  const [weekCursor, setWeekCursor] = useState<Date>(new Date());
  const [weekWorkouts, setWeekWorkouts] = useState<Pick<Workout, 'id' | 'date' | 'split_day_id' | 'completed'>[]>([]);
  const [lastCompletedWorkout, setLastCompletedWorkout] = useState<Pick<Workout, 'date' | 'split_day_id'> | null>(null);
  const [completedSinceStartDates, setCompletedSinceStartDates] = useState<string[]>([]);

  const [setupStartDate, setSetupStartDate] = useState(defaultStartDate());
  const [setupStartChoice, setSetupStartChoice] = useState<'today' | 'tomorrow' | 'pick'>('today');
  const [setupMode, setSetupMode] = useState<PlanMode>('fixed');
  const [setupAnchorDay, setSetupAnchorDay] = useState(1);

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
    let mounted = true;

    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      setUserId(user?.id || null);
    };

    void loadUser();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeSplit) return;

    setSetupAnchorDay(defaultWeekdays(activeSplit.days_per_week)[0] ?? 1);
  }, [activeSplit]);

  useEffect(() => {
    if (!userId || !activeSplit) {
      setPlanSchedule(null);
      return;
    }

    const existing = loadPlanSchedule(userId, activeSplit.id);
    setPlanSchedule(existing);
    setSetupStartDate(existing?.startDate || defaultStartDate());
    setSetupMode(existing?.mode || 'fixed');
    setSetupStartChoice('today');
    setSetupAnchorDay(existing?.anchorDay ?? existing?.weekdays?.[0] ?? defaultWeekdays(activeSplit.days_per_week)[0] ?? 1);
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

  const handleStartWorkout = async (day: SplitDay) => {
    if (startingDayId) return;

    try {
      setStartingDayId(day.id);
      await startWorkout(day.id);
    } finally {
      setStartingDayId(null);
    }
  };

  const handleSavePlanSetup = () => {
    if (!activeSplit || !userId) return;

    const computedWeekdays =
      setupMode === 'fixed'
        ? buildFixedWeekdays(setupAnchorDay, activeSplit.days_per_week)
        : [];

    const schedule: PlanSchedule = {
      splitId: activeSplit.id,
      startDate: setupStartDate,
      mode: setupMode,
      weekdays: computedWeekdays,
      anchorDay: setupMode === 'fixed' ? setupAnchorDay : undefined,
    };

    savePlanSchedule(userId, schedule);
    setPlanSchedule(schedule);
  };

  useEffect(() => {
    if (setupStartChoice === 'today') {
      setSetupStartDate(format(new Date(), 'yyyy-MM-dd'));
    } else if (setupStartChoice === 'tomorrow') {
      setSetupStartDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    }
  }, [setupStartChoice]);

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
  const shortWeekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

  if (!currentWorkout) {
    return (
      <motion.div
        className="pb-24 px-5 pt-8"
      >
        <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">
            {activeSplit.name.toUpperCase()}
          </p>
          <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">Training Plan</h1>
        </motion.header>

        {!planSchedule ? (
          <Card variant="slab" className="space-y-5">
            <div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#6B6B6B] mb-1">Start Plan</p>
              <p className="text-sm text-[#CFC9BF] leading-relaxed">Set your Day 1 and weekly rhythm</p>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">When should Day 1 start?</p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setSetupStartChoice('today')}
                  className={`px-2 py-2 rounded-[10px] text-[11px] transition-colors ${
                    setupStartChoice === 'today'
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
                  }`}
                >
                  Today
                </button>
                <button
                  onClick={() => setSetupStartChoice('tomorrow')}
                  className={`px-2 py-2 rounded-[10px] text-[11px] transition-colors ${
                    setupStartChoice === 'tomorrow'
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
                  }`}
                >
                  Tomorrow
                </button>
                <button
                  onClick={() => setSetupStartChoice('pick')}
                  className={`px-2 py-2 rounded-[10px] text-[11px] transition-colors ${
                    setupStartChoice === 'pick'
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
                  }`}
                >
                  Pick date
                </button>
              </div>

              {setupStartChoice === 'pick' && (
                <div className="w-full min-w-0 overflow-hidden rounded-[12px] bg-[#2A2A2A] border border-white/5 px-3 py-2">
                  <input
                    type="date"
                    value={setupStartDate}
                    onChange={(event) => setSetupStartDate(event.target.value)}
                    className="w-full min-w-0 bg-transparent text-[#E8E4DE] text-sm outline-none"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">Schedule style</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSetupMode('fixed')}
                  className={`px-3 py-3 rounded-[12px] text-xs transition-colors ${
                    setupMode === 'fixed'
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
                  }`}
                >
                  Fixed weekly rhythm
                </button>
                <button
                  onClick={() => setSetupMode('flex')}
                  className={`px-3 py-3 rounded-[12px] text-xs transition-colors ${
                    setupMode === 'flex'
                      ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                      : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
                  }`}
                >
                  Flexible sequence
                </button>
              </div>
            </div>

            {setupMode === 'fixed' && (
              <div className="space-y-2">
                <p className="text-[10px] tracking-[0.12em] uppercase text-[#6B6B6B]">
                  Choose first training day
                </p>
                <div className="grid grid-cols-7 gap-1">
                  {shortWeekdayLabels.map((label, weekday) => {
                    const active = setupAnchorDay === weekday;
                    return (
                      <button
                        key={`${label}-${weekday}`}
                        onClick={() => setSetupAnchorDay(weekday)}
                        className={`py-2 rounded-[10px] text-xs transition-colors ${
                          active
                            ? 'bg-[#E8E4DE] text-[#1A1A1A]'
                            : 'bg-[#2A2A2A] border border-white/5 text-[#9A9A9A]'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <p className="text-[10px] text-[#6B6B6B]">
                  Auto plan: {buildFixedWeekdays(setupAnchorDay, activeSplit.days_per_week).map((day) => weekdayLabels[day]).join(' / ')}
                </p>
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleSavePlanSetup}
            >
              Save Plan Setup
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card variant="slab" className="space-y-3">
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">Today</p>
              {todayCompletedWorkout ? (
                <>
                  <h3 className="text-base !text-[#E8E4DE]" style={{ color: '#E8E4DE' }}>Workout completed</h3>
                  <p className="text-xs text-[#A9A39A]">Great work. You can rest or train a different day.</p>
                </>
              ) : todayPlannedDay ? (
                <>
                  <h3 className="text-base !text-[#E8E4DE]" style={{ color: '#E8E4DE' }}>{todayPlannedDay.day_name}</h3>
                  <p className="text-xs text-[#A9A39A]">Planned session for today.</p>
                  <Button onClick={() => handleStartWorkout(todayPlannedDay)} disabled={startingDayId !== null}>
                    {startingDayId === todayPlannedDay.id ? 'Starting...' : 'Start Today\'s Workout'}
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="text-base font-medium tracking-[0.02em] !text-[#E8E4DE]" style={{ color: '#E8E4DE' }}>
                    Rest Day
                  </h3>
                  <p className="text-xs text-[#B6B0A8]">No scheduled training today. Recovery is part of progress.</p>
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
                        ? 'bg-[#2A2A2A] text-[#D0CCC4] border-white/10'
                        : status === 'missed'
                          ? 'bg-[#3A2A2A] text-[#D39B9B] border-[#5C3D3D]'
                          : 'bg-[#1F1F1F] text-[#9A9A9A] border-white/5';

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
                    <Button size="sm" onClick={() => handleStartWorkout(day)} disabled={startingDayId !== null}>
                      {startingDayId === day.id ? 'Starting...' : 'Start'}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </motion.div>
    );
  }

  const splitDay = activeSplit.days.find((day) => day.id === currentWorkout.split_day_id);
  const exerciseOrderById = new Map(
    (splitDay?.exercises || []).map((exercise, index) => [
      exercise.exercise_id,
      exercise.exercise_order ?? index,
    ])
  );

  const orderedSets = [...currentWorkout.sets].sort((a, b) => {
    const orderA = exerciseOrderById.get(a.exercise_id) ?? Number.MAX_SAFE_INTEGER;
    const orderB = exerciseOrderById.get(b.exercise_id) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.set_number - b.set_number;
  });

  // Group sets by exercise
  const exerciseGroups = orderedSets.reduce<Record<string, WorkoutSet[]>>((acc, set) => {
    if (!acc[set.exercise_id]) {
      acc[set.exercise_id] = [];
    }
    acc[set.exercise_id].push(set);
    return acc;
  }, {});

  const completedSets = currentWorkout.sets.filter(s => s.completed).length;
  const totalSets = currentWorkout.sets.length;
  const progress = totalSets > 0 ? (completedSets / totalSets) * 100 : 0;

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
        {Object.entries(exerciseGroups).map(([exerciseId, sets], index) => {
          const rawSet = sets[0] as WorkoutSet & { exercises?: { name?: string } };
          const exerciseName = rawSet.exercise?.name || rawSet.exercises?.name || 'Unknown Exercise';
          const completedInExercise = sets.filter(s => s.completed).length;
          const isActive = activeExerciseId === exerciseId;
          const allComplete = completedInExercise === sets.length;

          return (
            <motion.div
              key={exerciseId}
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
                    </div>
                  </div>
                  <motion.div
                    animate={{ rotate: isActive ? 90 : 0 }}
                    transition={springs.snappy}
                  >
                    <ChevronRight className="w-4 h-4 text-[#6B6B6B]" />
                  </motion.div>
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
