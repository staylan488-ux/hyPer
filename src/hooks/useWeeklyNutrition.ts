import { useState, useEffect } from 'react';
import { getSessionUserId } from '@/lib/sessionUser';
import { fetchNutritionLogsWithFoods } from '@/lib/nutritionLogQueries';
import { logMacro } from '@/lib/nutritionMacros';
import { addDays, format, parseISO, subDays } from 'date-fns';

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

/**
 * Calories and protein for each of `days` days (seven unless given), oldest
 * first: the days ending `lastDay` (a 'yyyy-MM-dd' key), or ending today when
 * none is given. Empty when nothing is logged in those days.
 */
export function useWeeklyNutrition(lastDay?: string, days = 7) {
  const [data, setData] = useState<WeeklyNutritionData>({
    weeklyNutrition: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const result = await fetchWeeklyNutrition(lastDay, days);
      if (cancelled) return;
      if (result) {
        setData(result);
      } else {
        setData(prev => ({ ...prev, loading: false, error: "Couldn’t load nutrition totals. Reopen Progress to try again." }));
      }
    };

    run();

    return () => { cancelled = true; };
  }, [lastDay, days]);

  return data;
}

/**
 * The longest stretch read in one request, in days: a request returns at most
 * the server's row limit (1,000), which a month of logging stays well under.
 */
const DAYS_PER_READ = 28;

type DayLog = { date: string; servings: number; food_id: string };
type DayFood = { id: string; calories: number; protein: number };

/** The logs from `first` to `last` (Date), in reads of DAYS_PER_READ days at once. */
async function readLogs(userId: string, first: Date, last: Date) {
  const reads = [];
  for (let from = first; from <= last; from = addDays(from, DAYS_PER_READ)) {
    const to = addDays(from, DAYS_PER_READ - 1);
    reads.push(
      fetchNutritionLogsWithFoods<DayLog, DayFood>(
        userId,
        { from: format(from, 'yyyy-MM-dd'), to: format(to < last ? to : last, 'yyyy-MM-dd') },
        'date, servings, food_id',
        'id, calories, protein',
      ),
    );
  }
  const results = await Promise.all(reads);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  return results.flatMap((result) => result.data ?? []);
}

export async function fetchWeeklyNutrition(lastDay?: string, days = 7) {
  try {
    const userId = await getSessionUserId();
    if (!userId) return;

    const end = lastDay ? parseISO(lastDay) : new Date();
    const count = Math.max(1, Math.round(days));

    // The logs in those days, each with its food.
    const nutritionLogs = await readLogs(userId, subDays(end, count - 1), end);

    // Aggregate daily nutrition
    const dailyNutritionMap = new Map<string, DailyNutrition>();
    for (let i = 0; i < count; i++) {
      const d = format(subDays(end, i), 'yyyy-MM-dd');
      dailyNutritionMap.set(d, { date: d, calories: 0, protein: 0 });
    }

    nutritionLogs.forEach(log => {
      const dayData = dailyNutritionMap.get(log.date);
      if (dayData) {
        dayData.calories += logMacro(log, 'calories') ?? 0;
        dayData.protein += logMacro(log, 'protein') ?? 0;
      }
    });

    const weeklyNutrition = nutritionLogs.length
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

/** The daily average over days with something logged; empty days do not count. */
export function averageLoggedDays(days: DailyNutrition[], key: 'calories' | 'protein'): number {
  const logged = days.filter((day) => day[key] > 0);
  return logged.length ? logged.reduce((sum, day) => sum + day[key], 0) / logged.length : 0;
}

