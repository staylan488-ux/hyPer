import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import { logMacro } from '@/lib/nutritionMacros';
import { subDays, format } from 'date-fns';

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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const today = new Date();
    const sevenDaysAgo = subDays(today, 6);
    const startDateStr = format(sevenDaysAgo, 'yyyy-MM-dd');
    const endDateStr = format(today, 'yyyy-MM-dd');

    // Fetch nutrition logs for the last 7 days, each with its food
    const { data: nutritionLogs, error: logsError } = await fetchNutritionLogsWithFoods<
      { date: string; servings: number; food_id: string },
      { id: string; calories: number; protein: number }
    >(user.id, { from: startDateStr, to: endDateStr }, 'date, servings, food_id', 'id, calories, protein');

    if (logsError) throw logsError;

    // Aggregate daily nutrition
    const dailyNutritionMap = new Map<string, DailyNutrition>();
    for (let i = 0; i < 7; i++) {
      const d = format(subDays(today, i), 'yyyy-MM-dd');
      dailyNutritionMap.set(d, { date: d, calories: 0, protein: 0 });
    }

    if (nutritionLogs) {
      nutritionLogs.forEach(log => {
        const dayData = dailyNutritionMap.get(log.date);
        if (dayData) {
          dayData.calories += logMacro(log, 'calories') ?? 0;
          dayData.protein += logMacro(log, 'protein') ?? 0;
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
