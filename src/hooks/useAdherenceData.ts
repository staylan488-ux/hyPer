import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/stores/appStore';
import { subDays, format } from 'date-fns';

export interface DailyNutrition {
  date: string;
  calories: number;
  protein: number;
}

export interface AdherenceData {
  weeklyNutrition: DailyNutrition[];
  streaks: {
    protein: number;
    calories: number;
    workout: number;
  };
  liftReadiness: {
    muscleGroup: string;
    status: 'high' | 'moderate' | 'low';
    label: string;
  }[];
  loading: boolean;
}

export function useAdherenceData() {
  const { macroTarget, weeklyVolume } = useAppStore();
  const [data, setData] = useState<AdherenceData>({
    weeklyNutrition: [],
    streaks: { protein: 0, calories: 0, workout: 0 },
    liftReadiness: [],
    loading: true,
  });

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = new Date();
      const sevenDaysAgo = subDays(today, 6);
      const startDateStr = format(sevenDaysAgo, 'yyyy-MM-dd');
      const endDateStr = format(today, 'yyyy-MM-dd');

      // Fetch nutrition logs for the last 7 days
      const { data: nutritionLogs } = await supabase
        .from('nutrition_logs')
        .select('date, servings, food_id')
        .eq('user_id', user.id)
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      // Fetch foods for those logs
      let foodsMap = new Map();
      if (nutritionLogs && nutritionLogs.length > 0) {
        const foodIds = [...new Set(nutritionLogs.map(log => log.food_id))];
        const { data: foods } = await supabase
          .from('foods')
          .select('id, calories, protein')
          .in('id', foodIds);
        
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

      const weeklyNutrition = Array.from(dailyNutritionMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      // Calculate streaks (consecutive days hitting within 15% of target, looking back from today)
      let proteinStreak = 0;
      let caloriesStreak = 0;
      const pTarget = macroTarget?.protein || 150;
      const cTarget = macroTarget?.calories || 2000;

      for (let i = 0; i < 7; i++) {
        const d = format(subDays(today, i), 'yyyy-MM-dd');
        const dayData = dailyNutritionMap.get(d);
        if (dayData) {
          const pDiff = Math.abs(dayData.protein - pTarget) / pTarget;
          if (pDiff <= 0.15) proteinStreak++; else if (i > 0) break;
        }
      }

      for (let i = 0; i < 7; i++) {
        const d = format(subDays(today, i), 'yyyy-MM-dd');
        const dayData = dailyNutritionMap.get(d);
        if (dayData) {
          const cDiff = Math.abs(dayData.calories - cTarget) / cTarget;
          if (cDiff <= 0.15) caloriesStreak++; else if (i > 0) break;
        }
      }

      // Fetch workouts for streak
      const { data: workouts } = await supabase
        .from('workouts')
        .select('date')
        .eq('user_id', user.id)
        .eq('completed', true)
        .order('date', { ascending: false })
        .limit(30);

      let workoutStreak = 0;
      if (workouts && workouts.length > 0) {
        const hasWorkoutToday = workouts.some(w => w.date === format(today, 'yyyy-MM-dd'));
        const hasWorkoutYesterday = workouts.some(w => w.date === format(subDays(today, 1), 'yyyy-MM-dd'));
        
        if (hasWorkoutToday || hasWorkoutYesterday) {
           let checkDate = hasWorkoutToday ? today : subDays(today, 1);
           while (true) {
             const dStr = format(checkDate, 'yyyy-MM-dd');
             if (workouts.some(w => w.date === dStr)) {
               workoutStreak++;
               checkDate = subDays(checkDate, 1);
             } else {
               break;
             }
           }
        }
      }

      // Derive Lift Readiness from weeklyVolume
      const liftReadiness = weeklyVolume.map(mv => {
        let status: 'high' | 'moderate' | 'low' = 'moderate';
        if (mv.status === 'below_mev' || mv.status === 'mev_mav') status = 'high';
        else if (mv.status === 'mav') status = 'moderate';
        else if (mv.status === 'approaching_mrv' || mv.status === 'above_mrv') status = 'low';

        return {
          muscleGroup: mv.muscle_group,
          status,
          label: mv.muscle_group.replace('_', ' ')
        };
      });

      return {
        weeklyNutrition,
        streaks: { protein: proteinStreak, calories: caloriesStreak, workout: workoutStreak },
        liftReadiness,
        loading: false
      };

    } catch (error) {
      console.error('Error fetching adherence data:', error);
      return null;
    }
  }, [macroTarget, weeklyVolume]);

  useEffect(() => {
    // Avoid re-fetching if deps haven't meaningfully changed
    let cancelled = false;

    const run = async () => {
      const result = await fetchData();
      if (cancelled) return;
      if (result) {
        setData(result);
      } else {
        setData(prev => ({ ...prev, loading: false }));
      }
    };

    run();

    return () => { cancelled = true; };
  }, [fetchData]);

  return data;
}
