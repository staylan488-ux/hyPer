import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CalendarRange,
  ChartNoAxesColumn,
  Check,
  Dumbbell,
  Flame,
  History as HistoryIcon,
  LayoutGrid,
  Moon,
  Play,
  Plus,
  Target,
} from 'lucide-react';
import { motion } from 'motion/react';
import { format, startOfDay } from 'date-fns';
import { Button, Screen, TickStrip, MacroBar, VolumeRail } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { DashboardMonolithIntro } from '@/components/intro/DashboardMonolithIntro';
import { supabase } from '@/lib/supabase';
import { springs } from '@/lib/animations';
import { loadPlanSchedule, plannedDayForDate, type PlanSchedule } from '@/lib/planSchedule';
import { MUSCLE_GROUP_LABELS, type MuscleVolume, type SplitDay } from '@/types';

interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

type HeroState =
  | { kind: 'loading' }
  | { kind: 'resume'; completedSets: number; totalSets: number; title: string }
  | { kind: 'done'; title: string }
  | { kind: 'planned'; day: SplitDay }
  | { kind: 'rest' }
  | { kind: 'no-schedule' }
  | { kind: 'flexible' }
  | { kind: 'first-run' };

export function Dashboard() {
  const { profile, user } = useAuthStore();
  const {
    activeSplit,
    currentWorkout,
    macroTarget,
    weeklyVolume,
    workoutMode,
    fetchMacroTarget,
    fetchVolumeLandmarks,
    calculateWeeklyVolume,
    fetchSplits,
    fetchCurrentWorkout,
    fetchWorkoutMode,
  } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [nutritionTotals, setNutritionTotals] = useState<NutritionTotals>({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });
  const [todayDone, setTodayDone] = useState<{ title: string } | null>(null);
  const [flexCompletedCount, setFlexCompletedCount] = useState(0);

  const userId = user?.id;
  const activeSplitId = activeSplit?.id;
  const schedule = useMemo<PlanSchedule | null>(
    () => (userId && activeSplitId ? loadPlanSchedule(userId, activeSplitId) : null),
    [userId, activeSplitId]
  );

  const fetchNutritionTotals = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      const today = format(new Date(), 'yyyy-MM-dd');

      const { data: logs, error: logsError } = await supabase
        .from('nutrition_logs')
        .select('food_id, servings')
        .eq('user_id', authUser.id)
        .eq('date', today);

      if (logsError || !logs || logs.length === 0) {
        setNutritionTotals({ calories: 0, protein: 0, carbs: 0, fat: 0 });
        return;
      }

      const foodIds = [...new Set(logs.map((log) => log.food_id))];

      const { data: foods } = await supabase
        .from('foods')
        .select('id, calories, protein, carbs, fat')
        .in('id', foodIds);

      if (!foods) return;

      const foodMap = new Map(foods.map((food) => [food.id, food]));

      const totals = logs.reduce(
        (acc, log) => {
          const food = foodMap.get(log.food_id);
          if (!food) return acc;

          return {
            calories: acc.calories + (food.calories || 0) * log.servings,
            protein: acc.protein + (food.protein || 0) * log.servings,
            carbs: acc.carbs + (food.carbs || 0) * log.servings,
            fat: acc.fat + (food.fat || 0) * log.servings,
          };
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      );

      setNutritionTotals(totals);
    } catch (error) {
      console.error('Error fetching nutrition totals:', error);
    }
  }, []);

  const fetchTodayStatus = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      const today = format(new Date(), 'yyyy-MM-dd');
      const { data } = await supabase
        .from('workouts')
        .select('id, split_day_id')
        .eq('user_id', authUser.id)
        .eq('date', today)
        .eq('completed', true)
        .limit(1);

      setTodayDone(data && data.length > 0 ? { title: 'Session complete' } : null);
    } catch (error) {
      console.error('Error fetching today status:', error);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      await Promise.all([
        fetchSplits(),
        fetchMacroTarget(),
        fetchVolumeLandmarks(),
        calculateWeeklyVolume(),
        fetchCurrentWorkout(),
        fetchWorkoutMode(),
        fetchNutritionTotals(),
        fetchTodayStatus(),
      ]);
      setLoading(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [calculateWeeklyVolume, fetchCurrentWorkout, fetchMacroTarget, fetchNutritionTotals, fetchSplits, fetchTodayStatus, fetchVolumeLandmarks, fetchWorkoutMode]);

  // Flex-rotation schedules advance by completed sessions since the plan start
  useEffect(() => {
    if (!userId || schedule?.mode !== 'flex') return;
    supabase
      .from('workouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('completed', true)
      .gte('date', schedule.startDate)
      .then(({ count }) => setFlexCompletedCount(count ?? 0));
  }, [userId, schedule]);

  const hero = useMemo<HeroState>(() => {
    if (loading) return { kind: 'loading' };

    if (currentWorkout && !currentWorkout.completed) {
      const total = currentWorkout.sets.length;
      const done = currentWorkout.sets.filter((s) => s.completed).length;
      return {
        kind: 'resume',
        completedSets: done,
        totalSets: total,
        title: 'Session in progress',
      };
    }

    if (todayDone) return { kind: 'done', title: todayDone.title };

    if (workoutMode === 'flexible') return { kind: 'flexible' };

    if (!activeSplit) return { kind: 'first-run' };
    if (!schedule) return { kind: 'no-schedule' };

    const planned = plannedDayForDate(
      startOfDay(new Date()),
      activeSplit.days,
      schedule,
      schedule.mode === 'flex' ? flexCompletedCount : 0
    );
    return planned ? { kind: 'planned', day: planned } : { kind: 'rest' };
  }, [loading, currentWorkout, todayDone, workoutMode, activeSplit, schedule, flexCompletedCount]);

  const hour = new Date().getHours();
  const greetingSlot = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greeting = profile?.display_name ? `${greetingSlot}, ${profile.display_name}` : greetingSlot;

  const remainingKcal = Math.max(0, Math.round((macroTarget?.calories || 2000) - nutritionTotals.calories));
  const hasAnyNutrition = nutritionTotals.calories > 0 || Boolean(macroTarget);
  const insight = useMemo(() => pickInsight(weeklyVolume), [weeklyVolume]);

  return (
    <>
      <Screen>
        {/* Header */}
        <motion.header className="mb-6" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <p className="t-label-sm mb-1.5">{format(new Date(), 'EEEE, MMMM d')}</p>
          <h1 className="t-display text-[1.75rem] text-[var(--color-text)]">{greeting}</h1>
        </motion.header>

        {/* ── Next action hero ── */}
        <motion.section
          className="mb-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.04 }}
        >
          <TodayHero hero={hero} programName={activeSplit?.name ?? null} />
        </motion.section>

        {/* ── Fuel strip ── */}
        <motion.section
          className="mb-4"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.08 }}
        >
          <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-[var(--color-sage)]" strokeWidth={1.75} />
                <span className="t-label">Fuel</span>
              </div>
              {hasAnyNutrition && !loading && (
                <span className="t-data-sm text-[var(--color-text-dim)]">
                  {remainingKcal.toLocaleString()} <span className="text-[var(--color-muted)]">kcal left</span>
                </span>
              )}
            </div>

            {loading ? (
              <div className="space-y-3">
                <div className="shimmer h-2 w-full" />
                <div className="shimmer h-2 w-3/4" />
              </div>
            ) : hasAnyNutrition ? (
              <div className="space-y-3.5">
                <MacroBar
                  label="Calories"
                  current={nutritionTotals.calories}
                  target={macroTarget?.calories || 2000}
                  tone="amber"
                  size="sm"
                />
                <MacroBar
                  label="Protein"
                  current={nutritionTotals.protein}
                  target={macroTarget?.protein || 150}
                  unit="g"
                  tone="sage"
                  size="sm"
                />
              </div>
            ) : (
              <p className="t-caption mb-1">Nothing logged today. Targets make every meal a decision, not a guess.</p>
            )}

            <div className="mt-4 flex gap-2">
              <Link to="/nutrition" className="flex-1">
                <Button variant="secondary" size="md" className="w-full">
                  <Plus className="w-4 h-4" strokeWidth={2.25} />
                  Log food
                </Button>
              </Link>
              {!macroTarget && !loading && (
                <Link to="/settings" className="flex-1">
                  <Button variant="ghost" size="md" className="w-full">
                    <Target className="w-4 h-4" strokeWidth={2} />
                    Set targets
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </motion.section>

        {/* ── One insight, only when it exists ── */}
        {insight && (
          <motion.section
            className="mb-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.smooth, delay: 0.12 }}
          >
            <Link to="/analysis" className="block">
              <div className="pressable rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ChartNoAxesColumn className="w-4 h-4 text-[var(--color-accent)]" strokeWidth={1.75} />
                    <span className="t-label">This week</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[var(--color-muted)]" />
                </div>
                <p className="t-body text-[var(--color-text)] mb-1">{insight.headline}</p>
                <p className="t-caption mb-3">{insight.detail}</p>
                {insight.landmark && (
                  <VolumeRail
                    current={insight.volume.weekly_sets}
                    mev={insight.landmark.mev}
                    mavLow={insight.landmark.mav_low}
                    mavHigh={insight.landmark.mav_high}
                    mrv={insight.landmark.mrv}
                  />
                )}
              </div>
            </Link>
          </motion.section>
        )}

        {/* ── Stations ── */}
        <motion.nav
          className="grid grid-cols-3 gap-2.5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.16 }}
        >
          <StationLink to="/train/program" icon={<LayoutGrid className="w-[18px] h-[18px]" strokeWidth={1.75} />} label="Program" />
          <StationLink to="/history" icon={<HistoryIcon className="w-[18px] h-[18px]" strokeWidth={1.75} />} label="History" />
          <StationLink to="/analysis" icon={<ChartNoAxesColumn className="w-[18px] h-[18px]" strokeWidth={1.75} />} label="Progress" />
        </motion.nav>
      </Screen>
      <DashboardMonolithIntro />
    </>
  );
}

/* ───────────────────────── hero card ───────────────────────── */

function TodayHero({ hero, programName }: { hero: HeroState; programName: string | null }) {
  if (hero.kind === 'loading') {
    return (
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-5">
        <div className="shimmer h-3 w-20 mb-3" />
        <div className="shimmer h-7 w-44 mb-4" />
        <div className="shimmer h-12 w-full" />
      </div>
    );
  }

  if (hero.kind === 'resume') {
    return (
      <div className="rounded-[var(--radius-lg)] bg-accent-tint hairline-strong p-5 relative overflow-hidden">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-breathe" />
          <span className="t-label text-[var(--color-accent)]">{hero.title}</span>
        </div>
        <p className="t-data-xl text-[var(--color-text)] mb-1.5">
          {hero.completedSets}<span className="text-[var(--color-muted)]">/{hero.totalSets} sets</span>
        </p>
        <TickStrip total={Math.min(hero.totalSets, 30)} filled={Math.min(hero.completedSets, 30)} tone="amber" live className="mb-4" />
        <Link to="/train">
          <Button size="lg" className="w-full">
            <Play className="w-4 h-4" strokeWidth={2.5} />
            Resume session
          </Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'done') {
    return (
      <div className="rounded-[var(--radius-lg)] bg-sage-tint hairline p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-sage)]">
            <Check className="w-3 h-3 text-[var(--color-base)]" strokeWidth={3.5} />
          </span>
          <span className="t-label text-[var(--color-sage)]">Trained today</span>
        </div>
        <p className="t-display text-[1.5rem] text-[var(--color-text)] mb-3">The work is banked.</p>
        <div className="flex gap-2">
          <Link to="/history" className="flex-1">
            <Button variant="secondary" className="w-full">Review session</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (hero.kind === 'planned') {
    const exercises = hero.day.exercises ?? [];
    const totalSets = exercises.reduce((sum, ex) => sum + (ex.target_sets || 0), 0);
    return (
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] hairline-strong p-5 relative overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 h-[2.5px]"
          style={{ background: 'linear-gradient(to right, var(--color-accent), transparent 70%)' }}
        />
        <p className="t-label text-[var(--color-accent)] mb-1.5">Today · {programName}</p>
        <h2 className="t-title mb-2">{hero.day.day_name}</h2>
        <div className="flex items-center gap-3 mb-4">
          <TickStrip total={Math.min(exercises.length, 16)} filled={0} tone="amber" size="sm" />
          <span className="t-data-sm text-[var(--color-text-dim)]">
            {exercises.length} exercises · {totalSets} sets
          </span>
        </div>
        <Link to="/train">
          <Button size="lg" className="w-full">
            <Dumbbell className="w-4 h-4" strokeWidth={2.25} />
            Start workout
          </Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'rest') {
    return (
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline p-5">
        <div className="flex items-center gap-2 mb-2">
          <Moon className="w-4 h-4 text-[var(--color-stone)]" strokeWidth={1.75} />
          <span className="t-label">Rest day</span>
        </div>
        <p className="t-display text-[1.4rem] text-[var(--color-text-dim)] mb-3">Growth happens between sessions.</p>
        <Link to="/train">
          <Button variant="ghost" size="sm">Train anyway →</Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'flexible') {
    return (
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] hairline-strong p-5 relative overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 h-[2.5px]"
          style={{ background: 'linear-gradient(to right, var(--color-accent), transparent 70%)' }}
        />
        <p className="t-label text-[var(--color-accent)] mb-1.5">Flexible mode</p>
        <h2 className="t-title mb-3">Build today as you go</h2>
        <Link to="/train">
          <Button size="lg" className="w-full">
            <Dumbbell className="w-4 h-4" strokeWidth={2.25} />
            Start session
          </Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'no-schedule') {
    return (
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] hairline-strong p-5">
        <p className="t-label text-[var(--color-accent)] mb-1.5">{programName}</p>
        <h2 className="t-heading mb-1">Pick your training days</h2>
        <p className="t-caption mb-4">Set Day 1 and your weekly rhythm so hyPer can call the next session.</p>
        <Link to="/train">
          <Button size="lg" className="w-full">
            <CalendarRange className="w-4 h-4" strokeWidth={2} />
            Set plan start
          </Button>
        </Link>
      </div>
    );
  }

  // first-run
  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] hairline-strong p-5 relative overflow-hidden">
      <div
        className="absolute inset-x-0 top-0 h-[2.5px]"
        style={{ background: 'linear-gradient(to right, var(--color-accent), transparent 70%)' }}
      />
      <p className="t-label text-[var(--color-accent)] mb-1.5">Start here</p>
      <h2 className="t-title mb-1">Build your program</h2>
      <p className="t-caption mb-4 max-w-[280px]">
        Answer five questions and hyPer assembles an evidence-based split around your week.
      </p>
      <div className="flex items-center gap-3 mb-4 opacity-70" aria-hidden>
        <TickStrip total={5} filled={0} tone="amber" size="sm" />
        <span className="t-caption">~2 minutes</span>
      </div>
      <Link to="/train/program">
        <Button size="lg" className="w-full">
          Get started
          <ArrowRight className="w-4 h-4" strokeWidth={2.25} />
        </Button>
      </Link>
    </div>
  );
}

/* ───────────────────────── helpers ───────────────────────── */

function StationLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to}>
      <div className="pressable rounded-[var(--radius-md)] bg-[var(--color-surface-1)] hairline flex flex-col items-center justify-center gap-1.5 py-3.5">
        <span className="text-[var(--color-stone)]">{icon}</span>
        <span className="text-[11px] font-semibold text-[var(--color-text-dim)]">{label}</span>
      </div>
    </Link>
  );
}

function pickInsight(weeklyVolume: MuscleVolume[]) {
  if (!weeklyVolume || weeklyVolume.length === 0) return null;

  const labeled = (mv: MuscleVolume) => MUSCLE_GROUP_LABELS[mv.muscle_group] ?? mv.muscle_group;

  const below = weeklyVolume
    .filter((mv) => mv.status === 'below_mev' && mv.landmark)
    .sort((a, b) => a.weekly_sets - b.weekly_sets)[0];
  if (below?.landmark) {
    const gap = Math.max(1, Math.ceil(below.landmark.mev - below.weekly_sets));
    return {
      volume: below,
      landmark: below.landmark,
      headline: `${labeled(below)} is under-stimulated`,
      detail: `${below.weekly_sets} sets this week — about ${gap} more to clear your minimum effective volume.`,
    };
  }

  const over = weeklyVolume
    .filter((mv) => (mv.status === 'above_mrv' || mv.status === 'approaching_mrv') && mv.landmark)
    .sort((a, b) => b.weekly_sets - a.weekly_sets)[0];
  if (over?.landmark) {
    return {
      volume: over,
      landmark: over.landmark,
      headline:
        over.status === 'above_mrv'
          ? `${labeled(over)} is past recoverable volume`
          : `${labeled(over)} is nearing its ceiling`,
      detail:
        over.status === 'above_mrv'
          ? `${over.weekly_sets} sets this week — pull back or plan a deload.`
          : `${over.weekly_sets} sets this week — hold here rather than adding more.`,
    };
  }

  const inZone = weeklyVolume.filter((mv) => mv.status === 'mav' && mv.landmark)[0];
  if (inZone?.landmark) {
    return {
      volume: inZone,
      landmark: inZone.landmark,
      headline: `${labeled(inZone)} is in the adaptive zone`,
      detail: `${inZone.weekly_sets} sets this week — right where growth compounds. Hold the line.`,
    };
  }

  return null;
}
