import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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

    // Fetch nutrition logs for the last 7 days
    const { data: nutritionLogs, error: logsError } = await supabase
      .from('nutrition_logs')
      .select('date, servings, food_id')
      .eq('user_id', user.id)
      .gte('date', startDateStr)
      .lte('date', endDateStr);

    if (logsError) throw logsError;

    // Fetch foods for those logs
    let foodsMap = new Map();
    if (nutritionLogs && nutritionLogs.length > 0) {
      const foodIds = [...new Set(nutritionLogs.map(log => log.food_id))];
      const { data: foods, error: foodsError } = await supabase
        .from('foods')
        .select('id, calories, protein')
        .in('id', foodIds);
      
      if (foodsError) throw foodsError;

      if (foods) {
        foodsMap = new Map(foods.map(f => [f.id, f]));
      }
    }

    // Aggregate daily nutrition
    const dailyNutritionMap = new Map<string, DailyNutrition>();
    for (let i = 0; i < 7; i++) {
      const d = format(subDays(today, i), 'yyyy-MM-dd');
      dailyNutritionMap.set(d, { date: d, calories: 0, protein: 0 });
    }

    if (nutritionLogs) {
      nutritionLogs.forEach(log => {
        const food = foodsMap.get(log.food_id);
        if (food) {
          const dayData = dailyNutritionMap.get(log.date);
          if (dayData) {
            dayData.calories += (food.calories || 0) * log.servings;
            dayData.protein += (food.protein || 0) * log.servings;
          }
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

