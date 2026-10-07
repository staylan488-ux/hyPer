import { useState, useEffect } from 'react';
import { getSessionUserId } from '@/lib/sessionUser';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import { logMacro } from '@/lib/nutritionMacros';
import { differenceInCalendarDays, subDays, format, startOfWeek } from 'date-fns';
import { TRAINING_WEEK } from '@/lib/workoutSessions';

export interface DailyNutrition {
  date: string;
  calories: number;
  protein: number;
}

export interface WeeklyNutritionData {
  weeklyNutrition: DailyNutrition[];
  loading: boolean;
  error: string | null;
}

export function useWeeklyNutrition() {
  const [data, setData] = useState<WeeklyNutritionData>({
    weeklyNutrition: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const result = await fetchWeeklyNutrition();
      if (cancelled) return;
      if (result) {
        setData(result);
      } else {
        setData(prev => ({ ...prev, loading: false, error: "Couldn’t load nutrition totals. Reopen Progress to try again." }));
      }
    };

    run();

    return () => { cancelled = true; };
  }, []);

  return data;
}

async function fetchWeeklyNutrition() {
  try {
    const userId = await getSessionUserId();
    if (!userId) return;

    // Progress's week ("Week of …"), from its first day through today: the
    // days so far, never days that have not happened yet.
    const today = new Date();
    const weekStart = startOfWeek(today, TRAINING_WEEK);
    const daysSoFar = differenceInCalendarDays(today, weekStart) + 1;
    const startDateStr = format(weekStart, 'yyyy-MM-dd');
    const endDateStr = format(today, 'yyyy-MM-dd');

    // Fetch nutrition logs for the week so far, each with its food
    const { data: nutritionLogs, error: logsError } = await fetchNutritionLogsWithFoods<
      { date: string; servings: number; food_id: string },
      { id: string; calories: number; protein: number }
    >(userId, { from: startDateStr, to: endDateStr }, 'date, servings, food_id', 'id, calories, protein');

    if (logsError) throw logsError;

    // Aggregate daily nutrition
    const dailyNutritionMap = new Map<string, DailyNutrition>();
    for (let i = 0; i < daysSoFar; i++) {
      const d = format(subDays(today, i), 'yyyy-MM-dd');
      dailyNutritionMap.set(d, { date: d, calories: 0, protein: 0 });
    }

    // Each entry rounds once, as its row on Fuel reads, before summing: the
    // week's figures then agree with Fuel's and Today's day totals.
    if (nutritionLogs) {
      nutritionLogs.forEach(log => {
        const dayData = dailyNutritionMap.get(log.date);
        if (dayData) {
          dayData.calories += Math.round(logMacro(log, 'calories') ?? 0);
          dayData.protein += Math.round(logMacro(log, 'protein') ?? 0);
        }
      });
    }

    const weeklyNutrition = nutritionLogs?.length
      ? Array.from(dailyNutritionMap.values()).sort((a, b) => a.date.localeCompare(b.date))
      : [];

    return {
      weeklyNutrition,
      loading: false,
      error: null,
    };

  } catch (error) {
    console.error('Error fetching weekly nutrition:', error);
    return null;
  }
}
