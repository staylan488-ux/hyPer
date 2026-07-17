import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Dumbbell,
  Play,
  Plus,
} from 'lucide-react';
import { motion } from 'motion/react';
import { format, startOfDay } from 'date-fns';
import { Button, RailStrip, RollingNumber, Screen, TickStrip, VolumeRail } from '@/components/shared';
import { formatWorkoutDuration } from '@/lib/workoutSessions';
import { tapHaptic } from '@/lib/haptics';
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
  | { kind: 'resume'; completedSets: number; totalSets: number; title: string; dayName: string; exerciseCount: number; elapsed: string }
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
  const [mountedAt] = useState(() => Date.now());

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
      const dayName =
        currentWorkout.split_day_id === null
          ? 'Flexible'
          : activeSplit?.days.find((d) => d.id === currentWorkout.split_day_id)?.day_name ?? 'Session';
      return {
        kind: 'resume',
        completedSets: done,
        totalSets: total,
        title: 'Session in progress',
        dayName,
        exerciseCount: new Set(currentWorkout.sets.map((s) => s.exercise_id)).size,
        elapsed: currentWorkout.created_at
          ? formatWorkoutDuration(Math.max(0, mountedAt - new Date(currentWorkout.created_at).getTime()))
          : '—',
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
  }, [loading, currentWorkout, todayDone, workoutMode, activeSplit, schedule, flexCompletedCount, mountedAt]);

  const hour = new Date().getHours();
  const greetingSlot = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greeting = profile?.display_name ? `${greetingSlot}, ${profile.display_name}` : greetingSlot;

  const remainingKcal = Math.max(0, Math.round((macroTarget?.calories || 2000) - nutritionTotals.calories));
  const hasAnyNutrition = nutritionTotals.calories > 0 || Boolean(macroTarget);
  const insight = useMemo(() => pickInsight(weeklyVolume), [weeklyVolume]);

  const stations: { to: string; index: string; label: string; sub: string }[] = [
    { to: '/train/program', index: '01', label: 'Program', sub: 'Your current plan' },
    { to: '/history', index: '02', label: 'History', sub: 'Past sessions' },
    { to: '/analysis', index: '03', label: 'Progress', sub: 'Volume & results' },
  ];

  return (
    <>
      <Screen>
        {/* ── Dateline ── */}
        <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
          <div className="flex items-baseline justify-between">
            <span className="t-label-sm">Today</span>
            <span className="t-label-sm">{format(new Date(), 'EEE · MMM d')}</span>
          </div>
          <h1 className="t-title mt-3 pt-5 border-t border-[var(--color-text)]">{greeting}</h1>
        </motion.header>

        {/* ── Training hero ── */}
        <motion.section
          className="mt-9"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.05 }}
        >
          <TodayHero hero={hero} programName={activeSplit?.name ?? null} />
        </motion.section>

        {/* ── Fuel ── */}
        <motion.section
          className="mt-10 pt-8 border-t border-[var(--color-border)]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.1 }}
        >
          <div className="flex items-baseline justify-between mb-4">
            <span className="t-label">Fuel</span>
            <Link to="/nutrition" className="t-label-sm flex items-center gap-1 hover:text-[var(--color-text)] transition-colors">
              Log <ArrowUpRight className="w-3 h-3" strokeWidth={1.75} />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="shimmer h-12 w-40" />
              <div className="shimmer h-px w-full" />
            </div>
          ) : hasAnyNutrition ? (
            <>
              <div className="mb-7">
                <div className="flex items-baseline gap-2">
                  <RollingNumber value={remainingKcal.toLocaleString()} className="number-hero text-[var(--color-text)]" />
                  <span className="[font-family:var(--font-display)] italic text-lg text-[var(--color-text-dim)]">kcal left</span>
                </div>
                <span className="t-label-sm">Energy remaining today</span>
              </div>
              <div className="space-y-5">
                <FuelRow label="Calories" current={nutritionTotals.calories} target={macroTarget?.calories || 2000} unit=" kcal" />
                <FuelRow label="Protein" current={nutritionTotals.protein} target={macroTarget?.protein || 150} unit=" g" />
              </div>
            </>
          ) : (
            <p className="text-editorial mb-5">Nothing logged today. Targets turn every meal into a decision, not a guess.</p>
          )}

          <div className="mt-7 flex gap-3">
            <Link to="/nutrition" className="flex-1">
              <Button variant="secondary" size="md" className="w-full">
                <Plus className="w-4 h-4" strokeWidth={1.75} />
                Log food
              </Button>
            </Link>
            {!macroTarget && !loading && (
              <Link to="/settings" className="flex-1">
                <Button variant="ghost" size="md" className="w-full">Set targets</Button>
              </Link>
            )}
          </div>
        </motion.section>

        {/* ── Contents / stations ── */}
        <motion.nav
          className="mt-10 pt-8 border-t border-[var(--color-border)]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.smooth, delay: 0.14 }}
        >
          <span className="t-label block mb-3">Contents</span>
          <ul>
            {stations.map((s) => (
              <li key={s.to}>
                <Link
                  to={s.to}
                  onClick={() => tapHaptic()}
                  className="pressable group flex items-center gap-4 py-4 border-t border-[var(--color-border)]"
                >
                  <span className="t-data-sm text-[var(--color-muted)] w-6">{s.index}</span>
                  <span className="flex-1 min-w-0">
                    <span className="t-heading block">{s.label}</span>
                    <span className="t-caption">{s.sub}</span>
                  </span>
                  <ArrowRight className="w-4 h-4 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors" strokeWidth={1.5} />
                </Link>
              </li>
            ))}
          </ul>
        </motion.nav>

        {/* ── One insight, only when it exists ── */}
        {insight && (
          <motion.section
            className="mt-10 pt-8 border-t border-[var(--color-border)]"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.smooth, delay: 0.18 }}
          >
            <Link to="/analysis" className="block group">
              <div className="flex items-baseline justify-between mb-3">
                <span className="t-label">This week</span>
                <ArrowUpRight className="w-4 h-4 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors" strokeWidth={1.5} />
              </div>
              <p className="t-display text-[1.5rem] text-[var(--color-text)] mb-2">{insight.headline}</p>
              <p className="t-caption mb-5 max-w-[34ch]">{insight.detail}</p>
              {insight.landmark && (
                <VolumeRail
                  current={insight.volume.weekly_sets}
                  mev={insight.landmark.mev}
                  mavLow={insight.landmark.mav_low}
                  mavHigh={insight.landmark.mav_high}
                  mrv={insight.landmark.mrv}
                />
              )}
            </Link>
          </motion.section>
        )}
      </Screen>
      <DashboardMonolithIntro />
    </>
  );
}

/* ───────────────────────── hero ───────────────────────── */

function HeroEyebrow({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return <p className={`t-label mb-3 ${accent ? 'text-[var(--color-accent)]' : ''}`}>{children}</p>;
}

function TodayHero({ hero, programName }: { hero: HeroState; programName: string | null }) {
  if (hero.kind === 'loading') {
    return (
      <div>
        <div className="shimmer h-3 w-20 mb-4" />
        <div className="shimmer h-12 w-44 mb-5" />
        <div className="shimmer h-12 w-full" />
      </div>
    );
  }

  if (hero.kind === 'resume') {
    return (
      <div className="border-l-2 border-[var(--color-accent)] pl-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1.5 h-1.5 bg-[var(--color-accent)] animate-breathe" />
          <span className="t-label text-[var(--color-accent)]">{hero.title}</span>
        </div>
        <div className="flex items-baseline gap-2.5 mb-4">
          <span className="number-hero text-[var(--color-text)]">
            <RollingNumber value={String(hero.completedSets)} />
            <span className="text-[var(--color-muted)]">/{hero.totalSets}</span>
          </span>
          <span className="[font-family:var(--font-display)] italic text-lg text-[var(--color-text-dim)]">sets done</span>
        </div>
        <TickStrip total={Math.min(hero.totalSets, 30)} filled={Math.min(hero.completedSets, 30)} tone="amber" size="lg" live className="mb-5" />
        <Link to="/train">
          <Button size="lg" className="w-full">
            <Play className="w-4 h-4" strokeWidth={2} fill="currentColor" />
            Resume session
          </Button>
        </Link>
        <Link to="/train" className="flex items-center justify-between gap-2 mt-4 t-caption">
          <span>{hero.elapsed} elapsed</span>
          <span>{hero.dayName} · {hero.exerciseCount} {hero.exerciseCount === 1 ? 'exercise' : 'exercises'}</span>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'done') {
    return (
      <div>
        <HeroEyebrow>Trained today</HeroEyebrow>
        <p className="t-display text-[2rem] leading-[1.05] text-[var(--color-text)] mb-6">The work is banked.</p>
        <Link to="/history">
          <Button variant="secondary" size="lg" className="w-full">Review session</Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'planned') {
    const exercises = hero.day.exercises ?? [];
    const totalSets = exercises.reduce((sum, ex) => sum + (ex.target_sets || 0), 0);
    return (
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <HeroEyebrow accent>Today · {programName}</HeroEyebrow>
          <span className="t-data-sm text-[var(--color-muted)]">{exercises.length} ex · {totalSets} sets</span>
        </div>
        <h2 className="[font-family:var(--font-display)] text-[2.75rem] leading-[0.95] font-light tracking-[-0.03em] text-[var(--color-text)] mb-5">
          {hero.day.day_name}
        </h2>
        <TickStrip total={Math.min(exercises.length, 12)} filled={0} tone="amber" size="md" className="mb-6" />
        <Link to="/train">
          <Button size="lg" className="w-full">
            <Dumbbell className="w-4 h-4" strokeWidth={1.75} />
            Start workout
          </Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'rest') {
    return (
      <div>
        <HeroEyebrow>Rest day</HeroEyebrow>
        <p className="t-display text-[1.875rem] leading-[1.08] text-[var(--color-text-dim)] mb-5">Growth happens between sessions.</p>
        <Link to="/train">
          <Button variant="ghost" size="sm">Train anyway →</Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'flexible') {
    return (
      <div>
        <HeroEyebrow accent>Flexible mode</HeroEyebrow>
        <p className="t-display text-[2rem] leading-[1.05] text-[var(--color-text)] mb-6">Build today as you go.</p>
        <Link to="/train">
          <Button size="lg" className="w-full">
            <Dumbbell className="w-4 h-4" strokeWidth={1.75} />
            Start session
          </Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'no-schedule') {
    return (
      <div>
        <HeroEyebrow accent>{programName}</HeroEyebrow>
        <p className="t-display text-[2rem] leading-[1.05] text-[var(--color-text)] mb-2">Pick your training days.</p>
        <p className="t-caption mb-6 max-w-[34ch]">Set Day 1 and your weekly rhythm so hyPer can call the next session.</p>
        <Link to="/train">
          <Button size="lg" className="w-full">Set plan start</Button>
        </Link>
      </div>
    );
  }

  // first-run
  return (
    <div>
      <HeroEyebrow accent>Start here</HeroEyebrow>
      <p className="t-display text-[2.25rem] leading-[1.02] text-[var(--color-text)] mb-2">Build your program.</p>
      <p className="t-caption mb-5 max-w-[34ch]">
        Answer five questions and hyPer assembles an evidence-based split around your week.
      </p>
      <div className="flex items-center gap-3 mb-6" aria-hidden>
        <TickStrip total={5} filled={0} tone="stone" size="sm" />
        <span className="t-label-sm">~2 minutes</span>
      </div>
      <Link to="/train/program">
        <Button size="lg" className="w-full">
          Get started
          <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
        </Button>
      </Link>
    </div>
  );
}

/* ───────────────────────── helpers ───────────────────────── */

function FuelRow({ label, current, target, unit }: { label: string; current: number; target: number; unit: string }) {
  const pct = target > 0 ? Math.min(999, Math.round((current / target) * 100)) : 0;
  const over = target > 0 && current > target;
  const maxScale = Math.max(target * 1.18, current);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="t-label-sm">{label}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="number-medium text-[var(--color-text)]">{Math.round(current).toLocaleString()}</span>
          <span className="t-data-sm text-[var(--color-muted)]">/ {Math.round(target).toLocaleString()}{unit}</span>
        </span>
      </div>
      <RailStrip
        value={current / maxScale}
        notch={target / maxScale}
        tone={over ? 'berry' : 'chalk'}
        size="md"
      />
      <span className="sr-only">{pct}% of target</span>
    </div>
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
