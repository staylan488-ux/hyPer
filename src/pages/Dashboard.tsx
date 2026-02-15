import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dumbbell, UtensilsCrossed, TrendingUp, ArrowRight, History } from 'lucide-react';
import { motion } from 'motion/react';
import { Card, CardTitle } from '@/components/shared';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { MacroGauge } from '@/components/dashboard/MacroGauge';
import { VolumeChart } from '@/components/dashboard/VolumeChart';
import { supabase } from '@/lib/supabase';
import { springs } from '@/lib/animations';

interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function Dashboard() {
  const { profile } = useAuthStore();
  const {
    activeSplit,
    currentWorkout,
    macroTarget,
    weeklyVolume,
    fetchMacroTarget,
    fetchVolumeLandmarks,
    calculateWeeklyVolume,
    fetchSplits,
    fetchCurrentWorkout
  } = useAppStore();

  const [nutritionTotals, setNutritionTotals] = useState<NutritionTotals>({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });

  const fetchNutritionTotals = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

      const { data: logs, error: logsError } = await supabase
        .from('nutrition_logs')
        .select('food_id, servings, date, logged_at')
        .eq('user_id', user.id)
        .or(`and(logged_at.gte.${startOfToday},logged_at.lt.${startOfTomorrow}),and(logged_at.is.null,date.eq.${today})`);

      if (logsError || !logs || logs.length === 0) {
        setNutritionTotals({ calories: 0, protein: 0, carbs: 0, fat: 0 });
        return;
      }

      const foodIds = [...new Set(logs.map((log) => log.food_id))];

      const { data: foods } = await supabase
        .from('foods')
        .select('id, calories, protein, carbs, fat')
        .in('id', foodIds);

      if (!foods) return;

      const foodMap = new Map(foods.map((food) => [food.id, food]));

      const totals = logs.reduce((acc, log) => {
        const food = foodMap.get(log.food_id);
        if (!food) return acc;

        return {
          calories: acc.calories + (food.calories || 0) * log.servings,
          protein: acc.protein + (food.protein || 0) * log.servings,
          carbs: acc.carbs + (food.carbs || 0) * log.servings,
          fat: acc.fat + (food.fat || 0) * log.servings,
        };
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      setNutritionTotals(totals);
    } catch (error) {
      console.error('Error fetching nutrition totals:', error);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSplits();
      fetchMacroTarget();
      fetchVolumeLandmarks();
      calculateWeeklyVolume();
      fetchCurrentWorkout();
      fetchNutritionTotals();
    }, 0);

    return () => clearTimeout(timer);
  }, [calculateWeeklyVolume, fetchCurrentWorkout, fetchMacroTarget, fetchNutritionTotals, fetchSplits, fetchVolumeLandmarks]);

  return (
    <motion.div
      className="pb-24 px-5 pt-8"
    >
      {/* Header */}
      <motion.header className="mb-10" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <p className="text-[10px] tracking-[0.25em] uppercase text-[#6B6B6B] mb-1">
          {activeSplit ? activeSplit.name.toUpperCase() : 'NO PROGRAM ACTIVE'}
        </p>
        <h1 className="text-2xl font-display-italic text-[#E8E4DE] tracking-tight">
          {profile?.display_name ? `Welcome, ${profile.display_name}` : 'Welcome Back'}
        </h1>
      </motion.header>

      {/* Quick Actions */}
      <motion.div className="grid grid-cols-2 gap-3 mb-8" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Link to="/workout">
          <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }} transition={springs.snappy}>
            <Card variant="slab" className="flex flex-col items-center justify-center py-6 hover:border-white/10 transition-all cursor-pointer group">
              <motion.div
                className="p-4 rounded-[20px] bg-[#2E2E2E] mb-3 group-hover:bg-[#383838] transition-colors"
                whileHover={{ rotate: -12 }}
                transition={springs.bouncy}
              >
                <Dumbbell className="w-5 h-5 text-[#E8E4DE]" strokeWidth={1.5} />
              </motion.div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">
                {currentWorkout ? 'Continue' : 'Begin'}
              </p>
            </Card>
          </motion.div>
        </Link>

        <Link to="/nutrition">
          <motion.div whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }} transition={springs.snappy}>
            <Card variant="slab" className="flex flex-col items-center justify-center py-6 hover:border-white/10 transition-all cursor-pointer group">
              <motion.div
                className="p-4 rounded-[20px] bg-[#2E2E2E] mb-3 group-hover:bg-[#383838] transition-colors"
                whileHover={{ rotate: 12 }}
                transition={springs.bouncy}
              >
                <UtensilsCrossed className="w-5 h-5 text-[#E8E4DE]" strokeWidth={1.5} />
              </motion.div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">
                Nutrition
              </p>
            </Card>
          </motion.div>
        </Link>

        <Link to="/history" className="col-span-2">
          <motion.div whileHover={{ scale: 1.01, y: -1 }} whileTap={{ scale: 0.99 }} transition={springs.snappy}>
            <Card variant="slab" className="flex items-center justify-center py-4 hover:border-white/10 transition-all cursor-pointer group">
              <div className="p-3 rounded-[16px] bg-[#2E2E2E] mr-3 group-hover:bg-[#383838] transition-colors">
                <History className="w-4 h-4 text-[#E8E4DE]" strokeWidth={1.5} />
              </div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[#9A9A9A]">
                Training History
              </p>
            </Card>
          </motion.div>
        </Link>
      </motion.div>

      {/* Daily Macros */}
      <motion.div className="mb-8" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <div className="flex items-center justify-between mb-4">
          <CardTitle>Today's Intake</CardTitle>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <MacroGauge
            label="KCAL"
            current={nutritionTotals.calories}
            target={macroTarget?.calories || 2000}
            unit=""
            color="default"
          />
          <MacroGauge
            label="PROTEIN"
            current={nutritionTotals.protein}
            target={macroTarget?.protein || 150}
            unit="g"
            color="accent"
          />
          <MacroGauge
            label="CARBS"
            current={nutritionTotals.carbs}
            target={macroTarget?.carbs || 200}
            unit="g"
            color="default"
          />
          <MacroGauge
            label="FAT"
            current={nutritionTotals.fat}
            target={macroTarget?.fat || 65}
            unit="g"
            color="default"
          />
        </div>
      </motion.div>

      {/* Weekly Volume */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab" className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <CardTitle>Weekly Volume</CardTitle>
            <Link
              to="/analysis"
              className="flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase text-[#6B6B6B] hover:text-[#9A9A9A] transition-colors"
            >
              Details
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <VolumeChart volumeData={weeklyVolume} />
        </Card>
      </motion.div>

      {/* Recommendations */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={springs.smooth}>
        <Card variant="slab">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-4 h-4 text-[#C4A484]" strokeWidth={1.5} />
            <CardTitle>Insights</CardTitle>
          </div>

          <div className="space-y-3">
            {weeklyVolume.length === 0 ? (
              <p className="text-xs text-[#6B6B6B] leading-relaxed">
                Complete a workout to receive personalized volume recommendations based on your training landmarks.
              </p>
            ) : (
              weeklyVolume.slice(0, 3).map((mv, index) => (
                <motion.div
                  key={mv.muscle_group}
                  className="flex items-center justify-between py-3 border-b border-white/5 last:border-0"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.08, ...springs.smooth }}
                >
                  <div>
                    <p className="text-xs text-[#E8E4DE] capitalize tracking-wide">
                      {mv.muscle_group.replace('_', ' ')}
                    </p>
                    <p className="text-[10px] text-[#6B6B6B] tabular-nums">
                      {mv.weekly_sets} sets this week
                    </p>
                  </div>
                  <div
                    className="w-2 h-2 rounded-[4px] animate-breathe"
                    style={{ backgroundColor: getVolumeStatusColor(mv.status) }}
                  />
                </motion.div>
              ))
            )}
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}

function getVolumeStatusColor(status: string): string {
  switch (status) {
    case 'below_mev':
      return '#8B6B6B';
    case 'mev_mav':
      return '#A68B6B';
    case 'mav':
      return '#8B9A7D';
    case 'approaching_mrv':
      return '#9A8B7D';
    case 'above_mrv':
      return '#7D6B6B';
    default:
      return '#6B6B6B';
  }
}
