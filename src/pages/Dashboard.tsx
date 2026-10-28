import { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandWordmark } from '@/components/intro/BrandWordmark';
import { differenceInCalendarWeeks, format, parseISO } from 'date-fns';
import { VolumeRail, SealMark, BankedStamp } from '@/components/shared';
import {
  BigFigure,
  Chevron,
  EntryRow,
  Eyebrow,
  HeroFigure,
  LineButton,
  MetalRail,
  MetalSection,
  MetalTitle,
  useCommandCapsule,
  type CommandCapsuleSpec,
} from '@/components/metal';
import { useTargetSeal } from '@/hooks/useTargetSeal';
import { VolumeMaquette } from '@/components/coaching/VolumeMaquette';
import type { SealMacro } from '@/lib/targetSeal';
import { TRAINING_WEEK } from '@/lib/workoutSessions';
import { getWorkoutWriteSeq, useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useScheduleWorkouts } from '@/hooks/useScheduleWorkouts';
import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { usePlanSchedule } from '@/hooks/usePlanSchedule';
import { useTodayRefresh } from '@/hooks/useTodayRefresh';
import { useWeekSessions } from '@/hooks/useWeekSessions';
import { EMPTY_TOTALS, readTodayDay, recallTodayDay, rememberTodayDay, type TodayDaySnapshot } from '@/lib/todayDay';
import { DEFAULT_MACRO_TARGET } from '@/types';
import {
  nextPlannedSession,
  pickInsight,
  plannedSetCount,
  summarizeWeekVolume,
  todayCapsule,
  todayHero,
  TODAY_ACTION_PATHS,
  weekSessionTarget,
  type HeroState,
} from '@/components/dashboard/todayModel';

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

  const hero = useMemo<HeroState>(() => todayHero({
    heroLoading,
    currentWorkout,
    currentWorkoutDayPlan,
    todayDone,
    workoutMode,
    activeSplit,
    schedule,
    scheduleLoading,
    scheduleWorkoutsLoading,
    scheduleWorkouts,
    scheduleError,
    retrySchedule,
    refreshedAt,
    dayKey,
    adaptiveSchedulingEnabled,
  }), [heroLoading, currentWorkout, currentWorkoutDayPlan, todayDone, workoutMode, activeSplit, schedule, scheduleLoading, scheduleWorkoutsLoading, scheduleWorkouts, scheduleError, retrySchedule, refreshedAt, dayKey, adaptiveSchedulingEnabled]);

  const remainingKcal = Math.max(0, Math.round((macroTarget?.calories || DEFAULT_MACRO_TARGET.calories) - nutritionTotals.calories));
  const hasAnyNutrition = nutritionTotals.calories > 0 || Boolean(macroTarget);
  const insight = useMemo(() => pickInsight(weeklyVolume), [weeklyVolume]);
  const weekSummary = useMemo(() => summarizeWeekVolume(weeklyVolume), [weeklyVolume]);

  // Completed sessions this training week; refreshed with Today and whenever
  // the live session starts or completes.
  const weekSessions = useWeekSessions(userId, dayKey, `${refreshedAt}:${currentWorkout?.id ?? ''}:${currentWorkout?.completed ?? ''}`);
  const weekDone = weekSessions.dates?.length ?? null;
  // Flexible mode has no weekly plan to count against.
  const weekTarget = weekSessionTarget(workoutMode, schedule, activeSplit);

  const programWeek = useMemo(() => {
    if (!schedule) return null;
    const week = differenceInCalendarWeeks(parseISO(dayKey), parseISO(schedule.startDate), TRAINING_WEEK) + 1;
    return week >= 1 ? week : null;
  }, [schedule, dayKey]);

  // On a rest day, the next planned session by the same schedule rules.
  const nextSession = useMemo(() => (
    hero.kind === 'rest'
      ? nextPlannedSession({ activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey })
      : null
  ), [hero.kind, activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey]);

  // Today's one primary action rides the command capsule, with main's
  // destinations: Start/Resume → Train, Log food → Fuel, Review → History.
  const navigate = useNavigate();
  const capsule = todayCapsule(hero, { kcalLeft: hasAnyNutrition ? remainingKcal : null });
  const capsuleSpec: CommandCapsuleSpec | null = capsule ? {
    key: capsule.key,
    label: capsule.label,
    sublabel: capsule.sublabel,
    alert: capsule.alert,
    glyph: capsule.glyph,
    progress: capsule.progress,
    dock: 'tabbar',
    onPress: () => {
      if (capsule.action === 'retry') {
        if (hero.kind === 'schedule-error') hero.retry();
        return;
      }
      navigate(TODAY_ACTION_PATHS[capsule.action]);
    },
  } : null;
  useCommandCapsule(capsuleSpec);

  const dateLabel = format(parseISO(dayKey), 'EEEE, MMM d');
  const showWeekRight = weekDone !== null && hero.kind !== 'rest' && hero.kind !== 'done';
  const showSetTargets = !macroTarget && !loading;

  return (
    <div className="metal-page metal-today pb-nav">
      <header>
        <div className="metal-today-head">
          <Eyebrow live={hero.kind === 'resume'}>
            {hero.kind === 'resume' ? 'Session in progress' : hero.kind === 'first-run' ? 'Start here' : dateLabel}
          </Eyebrow>
          <BrandWordmark variant="dashboard" />
        </div>
        <TodayTitle hero={hero} programName={activeSplit?.name ?? null} programWeek={programWeek} />
      </header>

      <section aria-label="Today">
        <TodayHero
          hero={hero}
          weekDone={weekDone}
          weekFailed={weekSessions.failed}
          weekTarget={weekTarget}
        />
        {hero.kind === 'rest' && (
          <div className="metal-next">
            <div className="min-w-0">
              {nextSession && <p className="metal-next-label">Next session</p>}
              <p className="metal-next-what">{nextSession ?? 'Growth happens between sessions.'}</p>
            </div>
            <Link to="/train" className="metal-text-btn">Train anyway</Link>
          </div>
        )}
      </section>

      {/* ── Fuel ── */}
      <MetalSection
        label="Fuel"
        right={(showSetTargets || hero.kind !== 'rest') ? (
          <>
            {showSetTargets && <LineButton to="/settings">Set targets</LineButton>}
            {hero.kind !== 'rest' && <LineButton to="/nutrition" plus>Log food</LineButton>}
          </>
        ) : undefined}
      >
        {fuelLoading ? (
          <div className="mt-2 space-y-4">
            <div className="shimmer h-12 w-40" />
            <div className="shimmer h-px w-full" />
          </div>
        ) : hasAnyNutrition ? (
          <>
            <BigFigure unit="kcal left">{remainingKcal.toLocaleString()}</BigFigure>
            <div className="metal-rails">
              <FuelRail label="Eaten" sealLabel="Calories" current={nutritionTotals.calories} target={macroTarget?.calories || DEFAULT_MACRO_TARGET.calories} seal="calories" dayKey={dayKey} />
              <FuelRail label="Protein" sealLabel="Protein" current={nutritionTotals.protein} target={macroTarget?.protein || DEFAULT_MACRO_TARGET.protein} unit=" g" seal="protein" dayKey={dayKey} />
            </div>
          </>
        ) : (
          <p className="metal-note">Nothing logged today. Targets turn every meal into a decision, not a guess.</p>
        )}
      </MetalSection>

      {/* ── This week ── */}
      <MetalSection
        label="This week"
        right={showWeekRight ? (
          <>
            {weekTarget ? (
              <span className="metal-dots" aria-hidden>
                {Array.from({ length: Math.min(weekTarget, 7) }, (_, index) => <span key={index} className={index < (weekDone ?? 0) ? 'is-on' : undefined} />)}
              </span>
            ) : null}
            <span>
              <b>{weekDone}</b>{weekTarget ? ` of ${weekTarget}` : ''} {(weekTarget ?? weekDone) === 1 ? 'session' : 'sessions'}
            </span>
          </>
        ) : undefined}
      >
        {weekSummary.trained > 0 ? (
          <p className="metal-line">
            {weekSummary.trained} {weekSummary.trained === 1 ? 'muscle' : 'muscles'} trained
            <span className="metal-sep" aria-hidden>·</span>{weekSummary.inRange} in range
            <span className="metal-sep" aria-hidden>·</span>{weekSummary.under} under
            {weekSummary.over > 0 && <><span className="metal-sep" aria-hidden>·</span>{weekSummary.over} over</>}
          </p>
        ) : (
          <p className="metal-line text-[var(--metal-ink-2)]">No sets logged yet this week.</p>
        )}
        {insight && insight.tone !== 'zone' && (
          <p className="metal-flag"><span><b>{insight.muscle}</b> {insight.flag}</span></p>
        )}
        <EntryRow
          label="Contents"
          items={[
            { label: 'Progress', to: '/analysis' },
            { label: 'Program', to: '/train/program' },
            { label: 'History', to: '/history' },
          ]}
        />
      </MetalSection>

      {/* ── Main's weekly insight, kept below in the quiet style ── */}
      {insight && (
        <section className="metal-section">
          <Link to="/analysis" className="block group">
            <div className="metal-section-head">
              <Eyebrow>Volume</Eyebrow>
              <span className="metal-section-head-right">Details <Chevron className="metal-row-chevron" /></span>
            </div>
            <div className="flex items-start gap-3 mt-1">
              <div className="flex-1 min-w-0">
                <p className="metal-row-title">{insight.headline}</p>
                <p className="metal-note mt-1">{insight.detail}</p>
              </div>
              <VolumeMaquette
                variant="compact"
                volume={weeklyVolume}
                focus={insight.volume.muscle_group}
                className="w-[76px] h-[132px] shrink-0 -mt-3 -mr-1"
              />
            </div>
            <VolumeRail
              current={insight.volume.weekly_sets}
              mev={insight.landmark.mev}
              mavLow={insight.landmark.mav_low}
              mavHigh={insight.landmark.mav_high}
              mrv={insight.landmark.mrv}
              reveal={`dash-volume-${insight.volume.muscle_group}`}
            />
          </Link>
        </section>
      )}
    </div>
  );
}

/* ───────────────────────── title & hero ───────────────────────── */

function TodayTitle({ hero, programName, programWeek }: { hero: HeroState; programName: string | null; programWeek: number | null }) {
  switch (hero.kind) {
    case 'loading':
      return <div className="shimmer h-8 w-44 mt-2" aria-hidden />;
    case 'schedule-error':
      return <MetalTitle note="Couldn’t load your workout schedule.">Today</MetalTitle>;
    case 'resume':
      return <MetalTitle note={hero.elapsed !== '—' ? hero.elapsed : undefined}>{hero.dayName}</MetalTitle>;
    case 'planned': {
      const note = [programName, programWeek ? `week ${programWeek}` : null].filter(Boolean).join(' · ');
      return <MetalTitle note={note || undefined}>{hero.day.day_name}</MetalTitle>;
    }
    case 'rest':
      return <MetalTitle note={<span className="metal-quote">Growth happens between sessions.</span>}>Rest day</MetalTitle>;
    case 'done':
      return <MetalTitle note="The work is banked.">Trained today</MetalTitle>;
    case 'flexible':
      return <MetalTitle note="Build today as you go.">Flexible mode</MetalTitle>;
    case 'no-schedule':
      return <MetalTitle note={programName ?? undefined}>Pick your training days</MetalTitle>;
    case 'first-run':
      return <MetalTitle>Build your program</MetalTitle>;
  }
}

function TodayHero({ hero, weekDone, weekFailed, weekTarget }: {
  hero: HeroState;
  weekDone: number | null;
  weekFailed: boolean;
  weekTarget: number | null;
}) {
  if (hero.kind === 'loading') {
    return (
      <div aria-hidden>
        <div className="shimmer h-[90px] w-36 mt-5" />
        <div className="shimmer h-[2px] w-full mt-[18px]" />
      </div>
    );
  }

  if (hero.kind === 'planned') {
    const totalSets = plannedSetCount(hero.day);
    const exercises = hero.day.exercises?.length ?? 0;
    return (
      <HeroFigure
        value={totalSets}
        caption={`${totalSets === 1 ? 'set' : 'sets'} · ${exercises} ${exercises === 1 ? 'exercise' : 'exercises'}`}
        segments={{ total: Math.max(1, totalSets), on: 0, label: `${totalSets} sets planned` }}
      />
    );
  }

  if (hero.kind === 'resume') {
    const live = hero.completedSets < hero.totalSets ? hero.completedSets : undefined;
    return (
      <HeroFigure
        value={hero.completedSets}
        of={hero.totalSets}
        caption="sets done"
        segments={{ total: Math.max(1, hero.totalSets), on: hero.completedSets, now: live, label: `${hero.completedSets} of ${hero.totalSets} sets done` }}
      />
    );
  }

  if (hero.kind === 'rest' || hero.kind === 'done' || hero.kind === 'flexible') {
    if (weekDone === null && weekFailed) {
      // The week read failed: leave the figure out rather than wait on it.
      return hero.kind === 'done'
        ? <div className="relative h-[90px] mt-5"><BankedStamp date={format(new Date(), 'MMM d')} className="absolute right-3 top-0" /></div>
        : null;
    }
    if (weekDone === null) {
      return (
        <div aria-hidden>
          <div className="shimmer h-[90px] w-36 mt-5" />
          <div className="shimmer h-[2px] w-full mt-[18px]" />
        </div>
      );
    }
    const target = hero.kind === 'flexible' ? null : weekTarget;
    return (
      <div className="relative">
        <HeroFigure
          value={weekDone}
          of={target ?? undefined}
          caption={`${(target ?? weekDone) === 1 ? 'session' : 'sessions'} this week`}
          segments={target ? { total: target, on: Math.min(weekDone, target), wide: true, label: `${weekDone} of ${target} sessions this week` } : undefined}
        />
        {hero.kind === 'done' && <BankedStamp date={format(new Date(), 'MMM d')} className="absolute right-3 top-6" />}
      </div>
    );
  }

  if (hero.kind === 'no-schedule') {
    return <p className="metal-note">Set Day 1 and your weekly rhythm so hyPer can call the next session.</p>;
  }

  if (hero.kind === 'first-run') {
    return (
      <>
        <HeroFigure value={5} caption="questions · about 2 minutes" segments={{ total: 5, on: 0, wide: true, label: 'Five questions' }} />
        <p className="metal-note">Answer five questions and hyPer assembles an evidence-based split around your week.</p>
      </>
    );
  }

  // schedule-error: the capsule carries Retry.
  return null;
}

/* ───────────────────────── helpers ───────────────────────── */

function activeWorkoutIdOf(workout: { id: string; completed: boolean } | null) {
  return workout && !workout.completed ? workout.id : null;
}

function FuelRail({ label, sealLabel, current, target, unit = '', seal, dayKey }: { label: string; sealLabel: string; current: number; target: number; unit?: string; seal: SealMacro; dayKey: string }) {
  const { met, anchorRef } = useTargetSeal({ macro: seal, current, target, dayKey, live: true });
  return (
    <MetalRail
      label={label}
      value={current}
      target={target}
      unit={unit}
      extra={<SealMark show={met} label={`${sealLabel} target met`} anchorRef={anchorRef} />}
    />
  );
}
