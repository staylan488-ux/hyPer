// The home-screen widgets' data. Widgets run with the app closed and cannot
// reach the account, so the app leaves them a small snapshot in the shared App
// Group (modules/hyper-widget-data) whenever today's figures change: Fuel's
// calories and protein against target, and the training plan for today and
// the next two weeks, so the Training widget turns to the right day at
// midnight on its own. The Swift side is targets/widgets/HomeWidgets.swift.
// Signing out clears it.
import { useEffect, useMemo } from 'react';

import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import * as WidgetData from '../../modules/hyper-widget-data';
import { useAccountDay } from './accountData';
import { useFuelStore } from './fuel';
import { useTodayPlan } from './today';
import { buildWidgetSnapshot, widgetPlan, widgetPlanFromToday, type WidgetPlanDay, type WidgetSnapshot } from './widgetPlan';

// What was last handed to the widgets, so an unchanged snapshot is not rewritten.
let written: string | null = null;
// The plan in it, so Fuel still updates while the days ahead are unknown.
let writtenPlan: { userId: string; plan: WidgetPlanDay[] } | null = null;

/** Mounted once with the tabs: keeps the widgets' snapshot current and clears it on sign-out. */
export function useWidgetSnapshot() {
  const { dayKey, loading } = useAccountDay();
  // Unknown nutrition or training data must not replace a good snapshot with
  // empty defaults. Successful reads of empty data do allow it to be cleared.
  const userId = useAuthStore((state) => state.user?.id);
  const loaded = useAppStore((state) => Boolean(userId) && state.hydratedForUserId === userId);
  const targetsLoaded = useAppStore((state) => Boolean(userId)
    && state.macroTargetLoadedForUserId === userId
    && state.nutritionProfileLoadedForUserId === userId);
  const plan = useTodayPlan();
  const hero = plan.hero;
  const seeded = plan.seeded;
  const workoutMode = useAppStore((state) => state.workoutMode);
  const activeSplit = useAppStore((state) => state.activeSplit);
  const target = useAppStore((state) => state.macroTarget);
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const totals = useFuelStore((state) => state.todayTotals);
  const fuelDay = useFuelStore((state) => state.todayKey);
  const fuelLoaded = useFuelStore((state) => Boolean(userId)
    && state.todayLoadedForUserId === userId
    && state.todayLoadedKey === fuelDay
    && fuelDay === dayKey);

  // A plan shown from the phone's copy never reaches the widgets.
  const days = useMemo(
    () => (plan.seeded ? null : widgetPlan({
      hero: plan.hero,
      dayKey,
      workoutMode,
      activeSplit,
      schedule: plan.schedule,
      scheduleWorkouts: plan.scheduleWorkouts,
      adaptiveSchedulingEnabled: plan.adaptiveSchedulingEnabled,
      aheadKnown: plan.aheadKnown,
    })),
    [plan.seeded, plan.hero, dayKey, workoutMode, activeSplit, plan.schedule, plan.scheduleWorkouts, plan.adaptiveSchedulingEnabled, plan.aheadKnown],
  );

  const json = useMemo(() => {
    if (loading || !loaded || !targetsLoaded || !fuelLoaded) return null;
    // While the plan is unknown (a completions read loading or failed), Fuel
    // still updates beside the plan last written for this account today.
    // Today still follows a known hero (a session just finished); only the
    // days after it are reused. A hero from the phone's copy is not known:
    // the plan last written stands as it was.
    const last = userId && writtenPlan?.userId === userId && writtenPlan.plan[0]?.day === dayKey ? writtenPlan.plan : null;
    const plan = days ?? (last && (seeded ? last : (widgetPlanFromToday(hero, dayKey, last.slice(1)) ?? last)));
    if (!plan) return null;
    return JSON.stringify(buildWidgetSnapshot({ fuelDay, target, totals, goal, plan }));
  }, [loading, loaded, targetsLoaded, fuelLoaded, days, hero, seeded, userId, dayKey, fuelDay, target, totals, goal]);

  useEffect(() => {
    if (!json || json === written || !userId) return;
    // Settle first: an account load changes several figures in a row.
    const timer = setTimeout(() => {
      written = json;
      writtenPlan = { userId, plan: (JSON.parse(json) as WidgetSnapshot).plan };
      void WidgetData.setSnapshot(json).catch(() => {
        written = null;
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [json, userId]);

  // The tabs unmount only on sign-out: the widgets show nothing of the account after it.
  useEffect(
    () => () => {
      written = null;
      writtenPlan = null;
      void WidgetData.clear().catch(() => {});
    },
    [],
  );
}
