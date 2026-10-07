import { useCallback, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BrandWordmark } from '@/components/intro/BrandWordmark';
import {
  ArrowRight,
  ChevronRight,
  CalendarDays,
  Dumbbell,
  History as HistoryIcon,
  Plus,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Button, MetalRing, PageHeader, RollingNumber, Screen, TickStrip, BankedStamp } from '@/components/shared';
import { VolumeMap } from '@/components/coaching/VolumeMap';
import { LandmarkRail } from '@/components/coaching/LandmarkRail';
import { muscleSubject } from '@/lib/muscleCopy';
import { formatWorkoutDuration } from '@/lib/workoutSessions';
import { getWorkoutResumeSet } from '@/components/workout/workoutFocus';
import { tapHaptic } from '@/lib/haptics';
import { getWorkoutWriteSeq, useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useScheduleWorkouts } from '@/hooks/useScheduleWorkouts';
import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { usePlanSchedule } from '@/hooks/usePlanSchedule';
import { useTodayRefresh } from '@/hooks/useTodayRefresh';
import { plannedDayForDate } from '@/lib/planSchedule';
import { EMPTY_TOTALS, readTodayDay, recallTodayDay, rememberTodayDay, type TodayDaySnapshot } from '@/lib/todayDay';
import { DEFAULT_MACRO_TARGET, type MuscleVolume, type SplitDay } from '@/types';

type HeroState =
  | { kind: 'loading' }
  | { kind: 'schedule-error'; retry: () => void }
  | { kind: 'resume'; completedSets: number; totalSets: number; title: string; dayName: string; exerciseCount: number; elapsed: string; nextExercise: string | null; nextSet: number | null }
  | { kind: 'done'; title: string }
  | { kind: 'planned'; day: SplitDay }
  | { kind: 'rest' }
  | { kind: 'no-schedule' }
  | { kind: 'flexible' }
  | { kind: 'first-run' };

export function Dashboard() {
  const { user } = useAuthStore();
  const {
    activeSplit,
    currentWorkout,
    currentWorkoutDayPlan,
    macroTarget,
    weeklyVolume,
    workoutMode,
    hydratedForUserId,
    fetchMacroTarget,
    fetchNutritionProfile,
    refreshAdaptiveTargets,
    calculateWeeklyVolume,
    fetchSplits,
    fetchCurrentWorkout,
    fetchWorkoutMode,
  } = useAppStore();

  const userId = user?.id;
  const activeSplitId = activeSplit?.id;
  const { schedule, loading: scheduleLoading } = usePlanSchedule(userId, activeSplitId);
  const adaptiveSchedulingEnabled = useAdaptiveSplitScheduling();
  const { workouts: scheduleWorkouts, loading: scheduleWorkoutsLoading, error: scheduleError, retry: retrySchedule } = useScheduleWorkouts(userId, activeSplit, schedule, currentWorkout, adaptiveSchedulingEnabled);

  // One load for mount and every foreground refresh, so the two cannot drift.
  const load = useCallback(async (day: string): Promise<TodayDaySnapshot> => {
    // Taken before the read, so a workout write that overlaps it also counts.
    const workoutWriteSeq = getWorkoutWriteSeq();
    const [dayData] = await Promise.all([
      readTodayDay(day),
      fetchSplits(),
      fetchMacroTarget(),
      calculateWeeklyVolume(),
      fetchCurrentWorkout(),
      fetchWorkoutMode(),
      fetchNutritionProfile(),
    ]);

    // Re-learn expenditure at most weekly, after the screen is already up.
    void refreshAdaptiveTargets();

    // Throwing keeps the old day and its numbers on screen and lets the next
    // return retry, instead of showing a new date above numbers never read.
    if (!dayData) throw new Error(`Could not read Today for ${day}`);
    if (userId) rememberTodayDay(userId, day, dayData, activeWorkoutIdOf(useAppStore.getState().currentWorkout), workoutWriteSeq);
    return dayData;
  }, [calculateWeeklyVolume, fetchCurrentWorkout, fetchMacroTarget, fetchNutritionProfile, fetchSplits, fetchWorkoutMode, refreshAdaptiveTargets, userId]);

  // A return to Today shows the store and the last read of this day at once,
  // then refreshes in place. Only this account's data counts: a cold start,
  // another account or a new day shows the placeholders until the load ends.
  const storeReady = Boolean(userId) && hydratedForUserId === userId;
  const seedToday = (day: string) => recallTodayDay(userId, day, activeWorkoutIdOf(currentWorkout), getWorkoutWriteSeq());

  // The day and its data arrive together, so the header, Fuel and hero always
  // describe the same day. A new day also re-reads schedule completions, so
  // adaptive and flex plans stop counting yesterday's session as today's.
  const { loading, dayKey, refreshedAt, data: today } = useTodayRefresh(load, retrySchedule, seedToday);
  const nutritionTotals = today?.nutritionTotals ?? EMPTY_TOTALS;
  const fuelLoading = loading && !today;
  // undefined: not known yet. A failed first load settles it as not done.
  const todayDone = today && today.todayDone !== undefined ? today.todayDone : loading ? undefined : null;
  const heroLoading = loading && !storeReady;

  const hero = useMemo<HeroState>(() => {
    if (heroLoading) return { kind: 'loading' };

    if (currentWorkout && !currentWorkout.completed) {
      const workoutDay = activeSplit?.days.find((day) => day.id === currentWorkout.split_day_id);
      const upcomingSet = getWorkoutResumeSet(currentWorkout, workoutDay, currentWorkoutDayPlan);
      const upcomingName = upcomingSet ? upcomingSet.exercise?.name
        ?? workoutDay?.exercises.find((exercise) => exercise.exercise_id === upcomingSet.exercise_id)?.exercise?.name
        ?? (currentWorkoutDayPlan?.workout_id === currentWorkout.id ? currentWorkoutDayPlan.items.find((item) => item.exercise_id === upcomingSet.exercise_id)?.exercise_name : null)
        ?? 'Next exercise' : null;
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
        nextExercise: upcomingName,
        nextSet: upcomingSet?.set_number ?? null,
        dayName,
        exerciseCount: new Set(currentWorkout.sets.map((s) => s.exercise_id)).size,
        elapsed: currentWorkout.created_at
          ? formatWorkoutDuration(Math.max(0, refreshedAt - new Date(currentWorkout.created_at).getTime()))
          : '—',
      };
    }

    if (todayDone === undefined) return { kind: 'loading' };
    if (todayDone) return { kind: 'done', title: todayDone.title };

    if (workoutMode === 'flexible') return { kind: 'flexible' };

    if (!activeSplit) return { kind: 'first-run' };
    if (scheduleLoading || scheduleWorkoutsLoading) return { kind: 'loading' };
    if (scheduleError) return { kind: 'schedule-error', retry: retrySchedule };
    if (!schedule) return { kind: 'no-schedule' };

    const planned = plannedDayForDate(
      parseISO(dayKey),
      activeSplit.days,
      schedule,
      0,
      scheduleWorkouts,
      adaptiveSchedulingEnabled
    );
    return planned ? { kind: 'planned', day: planned } : { kind: 'rest' };
  }, [heroLoading, currentWorkout, currentWorkoutDayPlan, todayDone, workoutMode, activeSplit, schedule, scheduleLoading, scheduleWorkoutsLoading, scheduleWorkouts, scheduleError, retrySchedule, refreshedAt, dayKey, adaptiveSchedulingEnabled]);

  const targetKcal = macroTarget?.calories || DEFAULT_MACRO_TARGET.calories;
  const targetProtein = macroTarget?.protein || DEFAULT_MACRO_TARGET.protein;
  const remainingKcal = Math.max(0, Math.round(targetKcal - nutritionTotals.calories));
  const hasAnyNutrition = nutritionTotals.calories > 0 || Boolean(macroTarget);
  const insight = useMemo(() => pickInsight(weeklyVolume), [weeklyVolume]);

  const stations: { to: string; index: string; label: string; sub: string; icon: LucideIcon }[] = [
    { to: '/train/program', index: '01', label: 'Program', sub: 'Your current plan', icon: CalendarDays },
    { to: '/history', index: '02', label: 'History', sub: 'Past sessions', icon: HistoryIcon },
    { to: '/analysis', index: '03', label: 'Progress', sub: 'Volume & results', icon: TrendingUp },
  ];

  return (
    <Screen>
      <PageHeader
        leading={<BrandWordmark variant="dashboard" />}
        eyebrow={format(parseISO(dayKey), 'EEEE, MMM d')}
        title="Today"
      />

      <section className="platter mt-4">
        <TodayHero hero={hero} programName={activeSplit?.name ?? null} />
      </section>

      {/* ── Fuel: one figure, one line of macros, one action. The detail
           (ring, macro rails) lives on the Fuel page. ── */}
      <section className="platter mt-4" aria-labelledby="today-fuel-label">
        <div className="flex items-center justify-between gap-3 -mt-3 -mb-1">
          <h2 id="today-fuel-label" className="t-label">Fuel</h2>
          <Link to="/nutrition" className="text-action -mr-2.5" onClick={() => tapHaptic()}>
            <Plus className="w-4 h-4" strokeWidth={1.75} aria-hidden />
            Log food
          </Link>
        </div>

        {fuelLoading ? (
          <div className="space-y-3 mt-3">
            <div className="shimmer h-11 w-40" />
            <div className="shimmer h-3 w-56" />
          </div>
        ) : hasAnyNutrition ? (
          <Link to="/nutrition" className="block mt-2" aria-label={`${remainingKcal.toLocaleString()} kcal left today. Open Fuel`}>
            <span className="flex items-baseline gap-2">
              <RollingNumber value={remainingKcal.toLocaleString()} className="number-hero text-[var(--color-text)]" />
              <span className="t-caption">kcal left</span>
            </span>
            <span className="t-data-sm block mt-2.5 text-[var(--color-text-dim)]">
              {Math.round(nutritionTotals.calories).toLocaleString()} of {targetKcal.toLocaleString()} kcal
              <span aria-hidden> · </span>
              {Math.round(nutritionTotals.protein)} of {targetProtein} g protein
            </span>
          </Link>
        ) : (
          <p className="text-editorial mt-2">Nothing logged today. Targets turn every meal into a decision, not a guess.</p>
        )}

        {!macroTarget && !loading && (
          <Link to="/settings/targets" className="text-action -ml-2.5 mt-2">Set targets</Link>
        )}
      </section>

      {/* ── Explore: the stations behind Today. Row text (and its divider)
           sits on the same 60px column as Program's list. ── */}
      <nav className="mt-7" aria-labelledby="today-explore-label">
        <span id="today-explore-label" className="t-label block mb-[9px]">Explore</span>
        <ul className="platter platter-flush">
          {stations.map((s) => (
            <li key={s.to} className="platter-row" style={{ '--row-inset': '56px' } as CSSProperties}>
              <Link
                to={s.to}
                onClick={() => tapHaptic()}
                className="pressable group flex items-center gap-[18px] py-3.5 px-5"
              >
                <s.icon className="w-[18px] h-[18px] shrink-0 text-[var(--color-text)]" strokeWidth={1.6} aria-hidden />
                <span className="flex-1 min-w-0">
                  <span className="t-heading block">{s.label}</span>
                  <span className="t-caption">{s.sub}</span>
                </span>
                <ChevronRight className="trail-chevron w-4 h-4 shrink-0 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors" strokeWidth={1.75} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* ── One insight, only when it exists ── */}
      {insight && (
        <section className="platter mt-4">
          <Link to="/analysis" className="block group">
            <div className="flex items-center justify-between mb-[23px]">
              <span className="t-label">This week</span>
              <ChevronRight className="trail-chevron w-4 h-4 shrink-0 text-[var(--color-muted)] group-hover:text-[var(--color-text)] transition-colors" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="t-heading mb-2">{insight.headline}</p>
                <p className="t-caption mb-5 max-w-[34ch]">{insight.detail}</p>
              </div>
              <VolumeMap
                variant="compact"
                volume={weeklyVolume}
                focus={insight.volume.muscle_group}
                className="w-[60px] h-[132px] shrink-0 -mt-1"
              />
            </div>
            {insight.landmark && (
              <LandmarkRail
                current={insight.volume.weekly_sets}
                mev={insight.landmark.mev}
                mavLow={insight.landmark.mav_low}
                mavHigh={insight.landmark.mav_high}
                mrv={insight.landmark.mrv}
                over={insight.volume.status === 'above_mrv'}
                reveal={`dash-volume-${insight.volume.muscle_group}`}
              />
            )}
          </Link>
        </section>
      )}
    </Screen>
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

  if (hero.kind === 'schedule-error') {
    return <div><p className="t-caption mb-3">Couldn’t load your workout schedule.</p><Button onClick={hero.retry}>Retry</Button></div>;
  }

  if (hero.kind === 'resume') {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-[5px] h-[5px] bg-[var(--color-accent)]" />
          <span className="t-label">{hero.title}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="t-title text-[28px]!">{hero.dayName}</h2>
            {programName && <p className="t-caption mt-2">{programName}</p>}
            {hero.elapsed !== '—' && <p className="t-caption mt-1">{hero.elapsed} in</p>}
          </div>
          <MetalRing
            progress={hero.totalSets > 0 ? hero.completedSets / hero.totalSets : 0}
            label={`${hero.completedSets} of ${hero.totalSets} sets complete`}
            reveal="dash-session-ring"
          >
            <span className="number-medium text-[20px]! text-[var(--color-text)]">{hero.completedSets}<span className="text-[var(--color-text-dim)]">/{hero.totalSets}</span></span>
            <span className="ring-unit">sets</span>
          </MetalRing>
        </div>
        <div className="py-5">
          <p className="t-caption mb-1">{hero.nextExercise ? `Up next · Set ${hero.nextSet}` : 'All sets logged'}</p>
          <p className="t-body">{hero.nextExercise ?? 'Review and finish your session'}</p>
        </div>
        <Link to="/train">
          <Button size="lg" metal className="w-full justify-between! px-6">Resume session <ArrowRight className="w-4 h-4" strokeWidth={1.5} /></Button>
        </Link>
      </div>
    );
  }

  if (hero.kind === 'done') {
    return (
      <div>
        <div className="flex items-start justify-between gap-4">
          <HeroEyebrow>Trained today</HeroEyebrow>
          <BankedStamp date={format(new Date(), 'MMM d')} className="-mt-1 mr-1" />
        </div>
        <p className="t-title text-[28px]! mb-6">The work is banked.</p>
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
        <h2 className="t-title text-[28px]! mb-5">
          {hero.day.day_name}
        </h2>
        <TickStrip total={Math.min(exercises.length, 12)} filled={0} tone="amber" size="md" className="mb-6" />
        <Link to="/train">
          <Button size="lg" metal className="w-full">
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
        <p className="t-title text-[28px]! mb-5">Growth happens between sessions.</p>
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
        <p className="t-title text-[28px]! mb-6">Build today as you go.</p>
        <Link to="/train">
          <Button size="lg" metal className="w-full">
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
        <p className="t-title text-[28px]! mb-2">Pick your training days.</p>
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
      <p className="t-title text-[28px]! mb-2">Build your program.</p>
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

function activeWorkoutIdOf(workout: { id: string; completed: boolean } | null) {
  return workout && !workout.completed ? workout.id : null;
}

function pickInsight(weeklyVolume: MuscleVolume[]) {
  if (!weeklyVolume || weeklyVolume.length === 0) return null;

  const subject = (mv: MuscleVolume) => muscleSubject(mv.muscle_group);

  const below = weeklyVolume
    .filter((mv) => mv.status === 'below_mev' && mv.landmark)
    .sort((a, b) => a.weekly_sets - b.weekly_sets)[0];
  if (below?.landmark) {
    const gap = Math.max(1, Math.ceil(below.landmark.mev - below.weekly_sets));
    return {
      volume: below,
      landmark: below.landmark,
      headline: `${subject(below).name} ${subject(below).is} under-stimulated`,
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
          ? `${subject(over).name} ${subject(over).is} past recoverable volume`
          : `${subject(over).name} ${subject(over).is} nearing ${subject(over).its} ceiling`,
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
      headline: `${subject(inZone).name} ${subject(inZone).is} in the adaptive zone`,
      detail: `${inZone.weekly_sets} sets this week — right where growth compounds. Hold the line.`,
    };
  }

  return null;
}
