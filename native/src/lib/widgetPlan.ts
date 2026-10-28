// The rules behind the home-screen widgets' snapshot (see lib/widgets.ts):
// today by the same rule as Today's card, the days after it by the program's
// schedule, and Fuel against target. Pure, so tests can check it.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

import type { HeroState } from '@/components/dashboard/todayModel';
import { plannedDayForDate, type PlanSchedule, type ScheduleWorkout } from '@/lib/planSchedule';
import type { Split, SplitDay, WorkoutMode } from '@/types';

export type WidgetPlanKind = 'planned' | 'rest' | 'done' | 'live' | 'flexible' | 'setup';

export type WidgetPlanDay = { day: string; title: string; detail: string | null; kind: WidgetPlanKind };

export type WidgetSnapshot = {
  version: 1;
  /** The local day the Fuel figures belong to (yyyy-MM-dd). */
  day: string;
  fuel: { calories: number; protein: number; calorieTarget: number; proteinTarget: number } | null;
  /** Today, then the days after it. */
  plan: WidgetPlanDay[];
};

/** Days of plan written ahead, so the widget stays right if the app is not opened for a while. */
export const WIDGET_PLAN_DAYS = 14;

const movements = (day: SplitDay) => `${day.exercises.length} ${day.exercises.length === 1 ? 'movement' : 'movements'}`;

export type WidgetPlanInput = {
  hero: HeroState;
  dayKey: string;
  workoutMode: WorkoutMode;
  activeSplit: Split | null;
  schedule: PlanSchedule | null;
  scheduleWorkouts: ScheduleWorkout[];
  adaptiveSchedulingEnabled: boolean;
};

/**
 * Today by the same rule as Today's card (the hero), then each later day by
 * the program's schedule. Null while today is still loading or failed, so a
 * widget keeps its last good plan.
 */
export function widgetPlan(input: WidgetPlanInput): WidgetPlanDay[] | null {
  const { hero, dayKey, workoutMode, activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled } = input;
  const base = parseISO(dayKey);

  let today: WidgetPlanDay;
  switch (hero.kind) {
    case 'loading':
    case 'schedule-error':
      return null;
    case 'resume':
      today = { day: dayKey, title: hero.dayName, detail: 'In progress', kind: 'live' };
      break;
    case 'planned':
      today = { day: dayKey, title: hero.day.day_name, detail: movements(hero.day), kind: 'planned' };
      break;
    case 'rest':
      today = { day: dayKey, title: 'Rest day', detail: null, kind: 'rest' };
      break;
    case 'done':
      today = { day: dayKey, title: 'Trained today', detail: null, kind: 'done' };
      break;
    case 'flexible':
      today = { day: dayKey, title: 'Flexible session', detail: null, kind: 'flexible' };
      break;
    case 'first-run':
      today = { day: dayKey, title: 'No program yet', detail: null, kind: 'setup' };
      break;
    case 'no-schedule':
      today = { day: dayKey, title: 'Choose today’s session', detail: null, kind: 'setup' };
      break;
  }

  const days: WidgetPlanDay[] = [today];
  for (let offset = 1; offset < WIDGET_PLAN_DAYS; offset += 1) {
    const day = format(addDays(base, offset), 'yyyy-MM-dd');
    if (workoutMode === 'flexible') {
      days.push({ day, title: 'Flexible session', detail: null, kind: 'flexible' });
    } else if (activeSplit && schedule) {
      const planned = plannedDayForDate(parseISO(day), activeSplit.days, schedule, 0, scheduleWorkouts, adaptiveSchedulingEnabled);
      days.push(planned ? { day, title: planned.day_name, detail: movements(planned), kind: 'planned' } : { day, title: 'Rest day', detail: null, kind: 'rest' });
    } else {
      break;
    }
  }

  // A day off (or one already trained) names the next session, as Today does.
  return days.map((entry, index) => {
    if (entry.kind !== 'rest' && entry.kind !== 'done') return entry;
    const next = days.slice(index + 1).find((candidate) => candidate.kind === 'planned');
    if (!next) return entry;
    const gap = differenceInCalendarDays(parseISO(next.day), parseISO(entry.day));
    const when = gap === 1 ? 'Tomorrow' : format(parseISO(next.day), 'EEE');
    return { ...entry, detail: `Next: ${when} · ${next.title}` };
  });
}

export function buildWidgetSnapshot(input: {
  fuelDay: string;
  target: { calories: number; protein: number } | null;
  totals: { calories: number; protein: number };
  plan: WidgetPlanDay[];
}): WidgetSnapshot {
  const { fuelDay, target, totals, plan } = input;
  return {
    version: 1,
    day: fuelDay,
    fuel:
      target && target.calories > 0
        ? {
            calories: Math.round(totals.calories),
            protein: Math.round(totals.protein),
            calorieTarget: Math.round(target.calories),
            proteinTarget: Math.round(target.protein),
          }
        : null,
    plan,
  };
}
