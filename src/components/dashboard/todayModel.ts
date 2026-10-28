import { addDays, format, parseISO } from 'date-fns';
import { getWorkoutResumeSet } from '@/components/workout/workoutFocus';
import type { CapsuleGlyph } from '@/lib/commandCapsule';
import { plannedDayForDate, type PlanSchedule, type ScheduleWorkout } from '@/lib/planSchedule';
import { formatWorkoutDuration } from '@/lib/workoutSessions';
import {
  MUSCLE_GROUP_LABELS,
  type MuscleVolume,
  type Split,
  type SplitDay,
  type Workout,
  type WorkoutDayPlan,
  type WorkoutMode,
} from '@/types';

/** What Today's hero describes. Built by Dashboard from the stores and the day read. */
export type HeroState =
  | { kind: 'loading' }
  | { kind: 'schedule-error'; retry: () => void }
  | {
    kind: 'resume';
    completedSets: number;
    totalSets: number;
    title: string;
    dayName: string;
    exerciseCount: number;
    elapsed: string;
    nextExercise: string | null;
    nextSet: number | null;
    /** The next set's saved values, when it already has them. */
    nextWeight?: number | null;
    nextReps?: number | null;
  }
  | { kind: 'done'; title: string }
  | { kind: 'planned'; day: SplitDay }
  | { kind: 'rest' }
  | { kind: 'no-schedule' }
  | { kind: 'flexible' }
  | { kind: 'first-run' };

/** Where Today's command capsule leads: the same destinations main's buttons use. */
export type TodayAction = 'train' | 'history' | 'nutrition' | 'program' | 'retry';

export const TODAY_ACTION_PATHS: Record<Exclude<TodayAction, 'retry'>, string> = {
  train: '/train',
  history: '/history',
  nutrition: '/nutrition',
  program: '/train/program',
};

export interface TodayCapsuleModel {
  key: string;
  label: string;
  sublabel?: string;
  alert?: boolean;
  glyph: CapsuleGlyph;
  action: TodayAction;
  /** 0–1, the live session's logged share. */
  progress?: number;
}

export interface TodayCapsuleContext {
  /** Calories left today, or null when nothing is logged and no target is set. */
  kcalLeft: number | null;
}

/** Planned sets in a split day: the same sum main's hero showed. */
export function plannedSetCount(day: SplitDay): number {
  return (day.exercises ?? []).reduce((sum, exercise) => sum + (exercise.target_sets || 0), 0);
}

/** The first movement by its saved order. */
export function firstExerciseName(day: SplitDay): string | null {
  const first = [...(day.exercises ?? [])].sort((a, b) => a.exercise_order - b.exercise_order)[0];
  return first?.exercise?.name ?? null;
}

/**
 * Today's one primary action. Each state keeps main's destination and verb;
 * only where it sits changes (the capsule instead of a filled button).
 */
export function todayCapsule(hero: HeroState, context: TodayCapsuleContext): TodayCapsuleModel | null {
  switch (hero.kind) {
    case 'loading':
      return null;
    case 'schedule-error':
      return { key: 'retry', label: 'Retry', sublabel: 'Couldn’t load your workout schedule', alert: true, glyph: 'arrow', action: 'retry' };
    case 'planned': {
      const sets = plannedSetCount(hero.day);
      const first = firstExerciseName(hero.day);
      const parts = [`${sets} ${sets === 1 ? 'set' : 'sets'}`];
      if (first) parts.push(`${first} first`);
      return { key: `planned:${hero.day.id}`, label: `Start ${hero.day.day_name}`, sublabel: parts.join(' · '), glyph: 'arrow', action: 'train' };
    }
    case 'resume': {
      let sublabel = 'All sets logged · review and finish';
      if (hero.nextExercise) {
        sublabel = hero.nextSet ? `${hero.nextExercise}, set ${hero.nextSet}` : hero.nextExercise;
        if (hero.nextWeight != null && hero.nextReps != null) sublabel += ` · ${formatWeight(hero.nextWeight)} × ${hero.nextReps}`;
      }
      return {
        key: 'resume',
        label: 'Resume',
        sublabel,
        glyph: 'arrow',
        action: 'train',
        progress: hero.totalSets > 0 ? hero.completedSets / hero.totalSets : 0,
      };
    }
    case 'rest':
      return {
        key: 'rest',
        label: 'Log food',
        sublabel: context.kcalLeft != null ? `${context.kcalLeft.toLocaleString('en-US')} kcal left` : 'Nothing logged yet today',
        glyph: 'plus',
        action: 'nutrition',
      };
    case 'done':
      return { key: 'done', label: 'Review session', sublabel: 'The work is banked', glyph: 'arrow', action: 'history' };
    case 'flexible':
      return { key: 'flexible', label: 'Start session', sublabel: 'Build today as you go', glyph: 'arrow', action: 'train' };
    case 'no-schedule':
      return { key: 'no-schedule', label: 'Set plan start', sublabel: 'Pick your training days', glyph: 'arrow', action: 'train' };
    case 'first-run':
      return { key: 'first-run', label: 'Get started', sublabel: 'Build your program · about 2 minutes', glyph: 'arrow', action: 'program' };
  }
}

function formatWeight(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

export interface WeekVolumeSummary {
  trained: number;
  inRange: number;
  under: number;
  over: number;
}

/** Muscles trained this week and where they sit against their landmarks. */
export function summarizeWeekVolume(weeklyVolume: MuscleVolume[]): WeekVolumeSummary {
  const trained = (weeklyVolume ?? []).filter((volume) => volume.weekly_sets > 0);
  return {
    trained: trained.length,
    under: trained.filter((volume) => volume.status === 'below_mev').length,
    over: trained.filter((volume) => volume.status === 'above_mrv').length,
    inRange: trained.filter((volume) => volume.status === 'mev_mav' || volume.status === 'mav' || volume.status === 'approaching_mrv').length,
  };
}

export interface VolumeInsight {
  volume: MuscleVolume;
  landmark: NonNullable<MuscleVolume['landmark']>;
  tone: 'under' | 'over' | 'zone';
  muscle: string;
  headline: string;
  detail: string;
  /** The short flag line under the week summary. */
  flag: string;
}

/** Main's one weekly insight (unchanged rules), plus a short flag line. */
export function pickInsight(weeklyVolume: MuscleVolume[]): VolumeInsight | null {
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
      tone: 'under',
      muscle: labeled(below),
      headline: `${labeled(below)} is under-stimulated`,
      detail: `${below.weekly_sets} sets this week — about ${gap} more to clear your minimum effective volume.`,
      flag: `under · add ~${gap} ${gap === 1 ? 'set' : 'sets'} this week`,
    };
  }

  const over = weeklyVolume
    .filter((mv) => (mv.status === 'above_mrv' || mv.status === 'approaching_mrv') && mv.landmark)
    .sort((a, b) => b.weekly_sets - a.weekly_sets)[0];
  if (over?.landmark) {
    const past = over.status === 'above_mrv';
    return {
      volume: over,
      landmark: over.landmark,
      tone: 'over',
      muscle: labeled(over),
      headline: past ? `${labeled(over)} is past recoverable volume` : `${labeled(over)} is nearing its ceiling`,
      detail: past
        ? `${over.weekly_sets} sets this week — pull back or plan a deload.`
        : `${over.weekly_sets} sets this week — hold here rather than adding more.`,
      flag: past ? 'past recoverable volume · pull back' : 'nearing its ceiling · hold here',
    };
  }

  const inZone = weeklyVolume.filter((mv) => mv.status === 'mav' && mv.landmark)[0];
  if (inZone?.landmark) {
    return {
      volume: inZone,
      landmark: inZone.landmark,
      tone: 'zone',
      muscle: labeled(inZone),
      headline: `${labeled(inZone)} is in the adaptive zone`,
      detail: `${inZone.weekly_sets} sets this week — right where growth compounds. Hold the line.`,
      flag: 'in the adaptive zone · hold the line',
    };
  }

  return null;
}

/** Everything Today's hero depends on, from the stores, the day read and the schedule. */
export interface TodayHeroInput {
  /** The stores are not loaded for this account yet. */
  heroLoading: boolean;
  currentWorkout: Workout | null;
  currentWorkoutDayPlan: WorkoutDayPlan | null;
  /** undefined: not known yet; null: no session completed today. */
  todayDone: { title: string } | null | undefined;
  workoutMode: WorkoutMode;
  activeSplit: Split | null;
  schedule: PlanSchedule | null;
  scheduleLoading: boolean;
  scheduleWorkoutsLoading: boolean;
  scheduleWorkouts: ScheduleWorkout[];
  scheduleError: boolean;
  retrySchedule: () => void;
  /** When the day was read; times the live session. */
  refreshedAt: number;
  /** Local day (yyyy-MM-dd). */
  dayKey: string;
  adaptiveSchedulingEnabled: boolean;
}

/** What Today's hero shows. Shared by the web and native Today screens. */
export function todayHero(input: TodayHeroInput): HeroState {
  const {
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
  } = input;
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
      nextWeight: upcomingSet?.weight ?? null,
      nextReps: upcomingSet?.reps ?? null,
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
}

/** On a rest day, the next planned session by the same schedule rules, as "Tomorrow · Lower". */
export function nextPlannedSession(input: {
  activeSplit: Split | null;
  schedule: PlanSchedule | null;
  scheduleWorkouts: ScheduleWorkout[];
  adaptiveSchedulingEnabled: boolean;
  dayKey: string;
}): string | null {
  const { activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey } = input;
  if (!activeSplit || !schedule) return null;
  const base = parseISO(dayKey);
  for (let offset = 1; offset <= 14; offset += 1) {
    const date = addDays(base, offset);
    const day = plannedDayForDate(date, activeSplit.days, schedule, 0, scheduleWorkouts, adaptiveSchedulingEnabled);
    if (day) return `${offset === 1 ? 'Tomorrow' : format(date, 'EEE')} · ${day.day_name}`;
  }
  return null;
}

/** Sessions planned this training week; flexible mode has no weekly plan to count against. */
export function weekSessionTarget(
  workoutMode: WorkoutMode,
  schedule: PlanSchedule | null,
  activeSplit: Split | null,
): number | null {
  return workoutMode === 'flexible' ? null
    : schedule?.mode === 'fixed' && schedule.weekdays.length > 0 ? schedule.weekdays.length
      : activeSplit?.days_per_week ?? null;
}
