// The home-screen widgets' data. Widgets run with the app closed and cannot
// reach the account, so the app leaves them a small snapshot in the shared App
// Group (modules/hyper-widget-data) whenever today's figures change: Fuel's
// calories and protein against target, and the training plan for today and
// the next two weeks, so the Training widget turns to the right day at
// midnight on its own. The Swift side is targets/widgets/HomeWidgets.swift.
// Signing out clears it.
import { useEffect, useMemo } from 'react';

import { useAppStore } from '@/stores/appStore';

import * as WidgetData from '../../modules/hyper-widget-data';
import { useAccountDay } from './accountData';
import { useFuelStore } from './fuel';
import { useTodayPlan } from './today';
import { buildWidgetSnapshot, widgetPlan } from './widgetPlan';

// What was last handed to the widgets, so an unchanged snapshot is not rewritten.
let written: string | null = null;

/** Mounted once with the tabs: keeps the widgets' snapshot current and clears it on sign-out. */
export function useWidgetSnapshot() {
  const { dayKey, loading } = useAccountDay();
  const plan = useTodayPlan();
  const workoutMode = useAppStore((state) => state.workoutMode);
  const activeSplit = useAppStore((state) => state.activeSplit);
  const target = useAppStore((state) => state.macroTarget);
  const totals = useFuelStore((state) => state.todayTotals);
  const fuelDay = useFuelStore((state) => state.todayKey);

  const days = useMemo(
    () =>
      widgetPlan({
        hero: plan.hero,
        dayKey,
        workoutMode,
        activeSplit,
        schedule: plan.schedule,
        scheduleWorkouts: plan.scheduleWorkouts,
        adaptiveSchedulingEnabled: plan.adaptiveSchedulingEnabled,
      }),
    [plan.hero, dayKey, workoutMode, activeSplit, plan.schedule, plan.scheduleWorkouts, plan.adaptiveSchedulingEnabled],
  );

  const json = useMemo(() => {
    if (loading || !days) return null;
    return JSON.stringify(buildWidgetSnapshot({ fuelDay, target, totals, plan: days }));
  }, [loading, days, fuelDay, target, totals]);

  useEffect(() => {
    if (!json || json === written) return;
    // Settle first: an account load changes several figures in a row.
    const timer = setTimeout(() => {
      written = json;
      void WidgetData.setSnapshot(json).catch(() => {
        written = null;
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [json]);

  // The tabs unmount only on sign-out: the widgets show nothing of the account after it.
  useEffect(
    () => () => {
      written = null;
      void WidgetData.clear().catch(() => {});
    },
    [],
  );
}
